// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { CommitteeEngagementWarehouseRow, GroupsEngagementStats } from '@lfx-one/shared/interfaces';
import { isCommitteeMemberActive, isJoinedWithinWindow } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { committeeEngagementTable } from '../helpers/snowflake-schema.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withUserCache } from './valkey.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_MEMBER_WINDOW_DAYS = 30;
// Matches committee.service.ts's getCommitteesByIds precedent — keeps both the bind count and the
// per-query row volume bounded for a caller who belongs to many committees (e.g. LF staff).
const COMMITTEE_UID_CHUNK_SIZE = 100;
// Caps how many chunk queries run concurrently against the Snowflake pool (SNOWFLAKE_CONFIG's
// MAX_CONNECTIONS is shared across every consumer in the process) — a caller with hundreds of
// visible committees shouldn't be able to borrow a large fraction of the pool in one request.
const CHUNK_CONCURRENCY = 3;

type ActiveMemberRow = Pick<
  CommitteeEngagementWarehouseRow,
  'MEMBER_USER_ID' | 'MEMBER_JOINED_AT' | 'MEMBER_VOTING_STATUS' | 'INVITED_COUNT_30D' | 'ATTENDED_COUNT_30D'
>;

/**
 * `expectedSource` must match the backend resolved for *this* request — not just any valid
 * `source` value — so a cached entry from a since-changed `ENGAGEMENT_BACKEND`/`NODE_ENV`
 * config is treated as a miss and recomputed immediately, rather than being served as a false
 * hit for up to `GROUPS_ENGAGEMENT_TTL_SECONDS`. Without this, a stray `mock` entry cached
 * before a switch to `live`/production would keep answering "Sample data" for up to 60s after
 * the switch, undermining the production hard-block's guarantee.
 */
function isGroupsEngagementStats(value: unknown, expectedSource: 'mock' | 'live'): boolean {
  const v = value as Partial<GroupsEngagementStats>;
  return (
    !!value &&
    typeof value === 'object' &&
    (v.active_members === null || typeof v.active_members === 'number') &&
    (v.meetings_this_month === null || typeof v.meetings_this_month === 'number') &&
    typeof v.computed_at === 'string' &&
    v.source === expectedSource
  );
}

/** Mock is opt-in and additionally hard-blocked in production, so a stray `ENGAGEMENT_BACKEND=mock`
 * left in a prod-like environment's config can't silently serve fabricated numbers as real data.
 * Resolved once per request, before the cache lookup, so the cache-key validator above can reject
 * a cached entry from a different backend instead of serving it stale.
 */
function resolveBackend(): 'mock' | 'live' {
  return process.env['ENGAGEMENT_BACKEND'] === 'mock' && process.env['NODE_ENV'] !== 'production' ? 'mock' : 'live';
}

/**
 * Groups dashboard engagement rollup (Active Members, Meetings This Month) for the caller's visible
 * set only — mine semantics, no scope param (LFXV2-1711). `active_members` reads live from the same
 * `platinum_lfx_one_committee_meeting_attendance` dbt model as LFXV2-1705, applying the identical
 * `isCommitteeMemberActive`/`isJoinedWithinWindow` predicate and tenure-clipping rule so the two
 * surfaces can't disagree on *that* logic — but this rollup is warehouse-row-anchored only (no live
 * roster join per visible committee, which would reintroduce the N+1 fetch this endpoint exists to
 * avoid), so it can still diverge from the per-committee detail page for a roster member the model
 * hasn't picked up yet (a very recent join) or a blank `MEMBER_VOTING_STATUS` the detail page would
 * otherwise resolve via the roster's own `voting.status`. `meetings_this_month` stays `null` in live
 * mode — the model exposes only rolling 30d/90d/YTD meeting counts, not a calendar-month grain, so
 * there's no honest source for it yet (LFXV2-2961 tracks adding one). Defaults to `live` (never
 * fabricated numbers) unless `ENGAGEMENT_BACKEND=mock` is explicitly set, and `mock` is additionally
 * hard-blocked when `NODE_ENV=production`.
 */
export class GroupsEngagementStatsService {
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly committeeService = new CommitteeService();

  /**
   * Returns the caller's engagement rollup, cached ~60s per user (see `withUserCache`) to absorb
   * repeated dashboard refreshes. Never throws — `live` mode degrades to null fields (missing
   * committee set, missing-object Snowflake error, or any other unexpected failure) rather than
   * failing the request, matching the graceful-degradation precedent used elsewhere for
   * not-yet-available data (LFXV2-2874).
   */
  public async getEngagementStats(req: Request): Promise<GroupsEngagementStats> {
    const username = getEffectiveUsername(req) ?? '';
    const backend = resolveBackend();

    return withUserCache(
      VALKEY_CACHE.GROUPS_ENGAGEMENT_NAMESPACE,
      username,
      VALKEY_CACHE.GROUPS_ENGAGEMENT_TTL_SECONDS,
      () => this.computeEngagementStats(req, username, backend),
      (value) => isGroupsEngagementStats(value, backend)
    );
  }

  private async computeEngagementStats(req: Request, username: string, backend: 'mock' | 'live'): Promise<GroupsEngagementStats> {
    const computedAt = new Date().toISOString();

    if (backend === 'live') {
      const activeMembers = await this.computeActiveMembers(req);
      // meetings_this_month: no calendar-month grain exists in the model (only rolling
      // 30d/90d/YTD) — left null rather than mislabeling a rolling window as "this month".
      // LFXV2-2961 tracks adding a calendar-month data source.
      return { active_members: activeMembers, meetings_this_month: null, computed_at: computedAt, source: 'live' };
    }

    // WARN, not DEBUG, on every call: unlike the live branch above, mock should essentially never
    // run in a real deployment, so each occurrence is worth surfacing — an on-call engineer needs
    // this the moment someone reports the dashboard numbers look wrong.
    logger.warning(req, 'get_groups_engagement_stats', 'ENGAGEMENT_BACKEND=mock — serving fixture engagement stats, not real data');
    return { ...deterministicMockStats(username), computed_at: computedAt, source: 'mock' };
  }

  /**
   * Counts distinct active members (attended >=1 meeting in the trailing 30 days, or joined within
   * it, excluding Emeritus — `isCommitteeMemberActive`, the same function LFXV2-1705 uses) across
   * every committee the caller can see (`getMyCommitteeUids` — "mine" semantics, no scope param, per
   * LFXV2-1711). A member is counted once even if active on multiple visible committees — the model's
   * grain is one row per `(committee_id, member_user_id)`, so a member on N committees produces N
   * rows; deduping by `MEMBER_USER_ID` is what makes this a *member* count rather than a row count.
   * The committee-uid list is chunked (`COMMITTEE_UID_CHUNK_SIZE`) so a caller who belongs to many
   * committees (e.g. LF staff) doesn't produce an unbounded bind list or row volume in one query, and
   * chunks run at most `CHUNK_CONCURRENCY` at a time so that same caller can't monopolize a large
   * fraction of the shared Snowflake connection pool in one request.
   *
   * Three distinct "nothing to report" cases stay distinguishable:
   * - `0`: the caller genuinely has no visible committees — a real answer, no query even runs.
   * - `null` (no rows at all): the caller has visible committees, but every chunk query returned
   *   zero rows — mirrors `committee-engagement.service.ts`'s zero-row `dataAvailable: false`
   *   reading (the model is roster-anchored with zero-activity members retained, so real coverage
   *   should yield >=1 row per committee; zero across the board most likely means none of the
   *   caller's committees are synced yet, not that literally nobody is active).
   * - `0` (rows present, none active): a real, computed zero — the caller's committees are covered
   *   by the model and nobody in them happens to be active this window.
   * - `null` (error): the count couldn't be computed at all (missing committee-set lookup, a
   *   Snowflake missing-object/not-authorized error, or any chunk failing) — never thrown, so a
   *   stats failure never blocks the rest of the groups dashboard.
   */
  private async computeActiveMembers(req: Request): Promise<number | null> {
    try {
      const committeeUids = [...(await this.committeeService.getMyCommitteeUids(req))];
      if (committeeUids.length === 0) return 0;

      const chunks: string[][] = [];
      for (let i = 0; i < committeeUids.length; i += COMMITTEE_UID_CHUNK_SIZE) {
        chunks.push(committeeUids.slice(i, i + COMMITTEE_UID_CHUNK_SIZE));
      }

      // Promise.all per batch (not allSettled): a partial-chunk failure means the count can no
      // longer be trusted as complete, so the whole computation degrades to null via the catch
      // below rather than silently returning an undercount from only the chunks that succeeded.
      // Batched at CHUNK_CONCURRENCY rather than firing every chunk at once, so this one request
      // can't borrow an unbounded share of the Snowflake connection pool.
      const chunkResults: { rows: ActiveMemberRow[] }[] = [];
      for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
        const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
        const batchResults = await Promise.all(batch.map((chunk) => this.queryActiveMemberChunk(chunk)));
        chunkResults.push(...batchResults);
      }

      const windowStart = new Date(Date.now() - ACTIVE_MEMBER_WINDOW_DAYS * DAY_MS);
      const activeUids = new Set<string>();
      let rowCount = 0;

      for (const result of chunkResults) {
        rowCount += result.rows.length;
        for (const row of result.rows) {
          const classificationInput = {
            // Clamped to `invited`, matching committee-engagement.service.ts's `buildResponse` —
            // defense-in-depth against the model's own `attended <= invited` dbt invariant ever
            // being violated, not a sign it's known to be unenforced.
            attended: Math.min(row.ATTENDED_COUNT_30D, row.INVITED_COUNT_30D),
            invited: row.INVITED_COUNT_30D, // unused by isCommitteeMemberActive; kept only for the clamp above
            votingStatus: row.MEMBER_VOTING_STATUS,
            joinedWithinWindow: isJoinedWithinWindow(row.MEMBER_JOINED_AT, windowStart),
          };
          if (isCommitteeMemberActive(classificationInput)) activeUids.add(row.MEMBER_USER_ID);
        }
      }

      logger.debug(req, 'get_groups_engagement_stats', 'Computed active members', {
        committee_count: committeeUids.length,
        chunk_count: chunks.length,
        row_count: rowCount,
        active_members: activeUids.size,
      });

      // See the doc comment above: zero rows across every visible committee reads as "not synced
      // yet" (null), distinct from rows being present but nobody active (a real 0).
      return rowCount > 0 ? activeUids.size : null;
    } catch (error) {
      if (!SnowflakeService.isMissingObjectError(error)) {
        // A non-Snowflake failure (e.g. the visible-committee-set lookup, or a chunk query error
        // other than missing-object) is unexpected — surface it distinctly from the expected
        // pre-sync/missing-GRANT case below, but still degrade to null rather than failing the
        // whole dashboard stats request.
        logger.warning(req, 'get_groups_engagement_stats', 'Failed to compute active members; returning null', { err: error });
        return null;
      }
      logger.warning(req, 'get_groups_engagement_stats', 'Active-members query hit a missing-object/not-authorized error; returning null', { err: error });
      return null;
    }
  }

  private queryActiveMemberChunk(committeeUids: string[]): Promise<{ rows: ActiveMemberRow[] }> {
    const placeholders = committeeUids.map(() => '?').join(', ');
    const sql = `
      SELECT MEMBER_USER_ID, MEMBER_JOINED_AT, MEMBER_VOTING_STATUS, INVITED_COUNT_30D, ATTENDED_COUNT_30D
      FROM ${committeeEngagementTable()}
      WHERE COMMITTEE_ID IN (${placeholders})
    `;
    return this.snowflakeService.execute<ActiveMemberRow>(sql, committeeUids, { expectMissingObject: true });
  }
}

/**
 * Deterministic fixture keyed off the caller's identity — same user always sees the same numbers
 * across requests/instances (no randomness), so the mock behaves predictably in manual testing and
 * screenshots without needing a backing store.
 */
function deterministicMockStats(username: string): Pick<GroupsEngagementStats, 'active_members' | 'meetings_this_month'> {
  const hash = hashString(username || 'anonymous');
  return {
    active_members: 1 + (hash % 50),
    meetings_this_month: hash % 8,
  };
}

/** Simple, stable string hash (djb2 variant) — not cryptographic, only needs to be deterministic. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}
