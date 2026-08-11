// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY, VALKEY_CACHE } from '@lfx-one/shared/constants';
import { CommitteeEngagementWarehouseRow, GroupsEngagementStats } from '@lfx-one/shared/interfaces';
import { isCommitteeMemberActive, isJoinedWithinWindow } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { resolveCommitteeV2UidsToV1Ids } from '../helpers/committee-v1-mapping.helper';
import { committeeEngagementTable } from '../helpers/snowflake-schema.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { NatsService } from './nats.service';
import { SnowflakeService } from './snowflake.service';
import { withUserCache } from './valkey.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_MEMBER_WINDOW_DAYS = 30;
// Matches committee.service.ts's getCommitteesByIds precedent — keeps both the bind count and the
// per-query row volume bounded for a caller who belongs to many committees (e.g. LF staff).
const COMMITTEE_UID_CHUNK_SIZE = 100;

type ActiveMemberRow = Pick<
  CommitteeEngagementWarehouseRow,
  'MEMBER_USER_ID' | 'MEMBER_JOINED_AT' | 'MEMBER_VOTING_STATUS' | 'MEMBER_ROLE' | 'INVITED_COUNT_30D' | 'ATTENDED_COUNT_30D'
> & { COMMITTEE_ID: string };

/**
 * `expectedSource` must match the backend resolved for *this* request — not just any valid
 * `source` value — so a cached entry from a since-changed `ENGAGEMENT_BACKEND`/`NODE_ENV`
 * config is treated as a miss and recomputed immediately, rather than being served as a false
 * hit for up to `GROUPS_ENGAGEMENT_TTL_SECONDS`. Without this, a stray `mock` entry cached
 * before a switch to `live`/production would keep answering "Sample data" for up to 60s after
 * the switch, undermining the production hard-block's guarantee.
 *
 * The same reasoning generalizes beyond `source`: this validator is also this response shape's
 * version check. A field a newer service version always sets (like `coverage`, added in
 * LFXV2-2978) must be checked here too, so a cache entry written by a pre-upgrade instance —
 * which never had that field — reads as a miss and recomputes immediately instead of being served
 * to a client expecting the newer shape for up to `GROUPS_ENGAGEMENT_TTL_SECONDS` after deploy.
 */
function isGroupsEngagementStats(value: unknown, expectedSource: 'mock' | 'live'): boolean {
  const v = value as Partial<GroupsEngagementStats>;
  return (
    !!value &&
    typeof value === 'object' &&
    (v.active_members === null || typeof v.active_members === 'number') &&
    (v.meetings_this_month === null || typeof v.meetings_this_month === 'number') &&
    typeof v.computed_at === 'string' &&
    v.source === expectedSource &&
    typeof v.coverage === 'object' &&
    v.coverage !== null &&
    typeof v.coverage.covered === 'number' &&
    typeof v.coverage.total === 'number'
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
 * avoid), so it can still diverge from the per-committee detail page for: a roster member the model
 * hasn't picked up yet (a very recent join); a blank `MEMBER_VOTING_STATUS` the detail page would
 * otherwise resolve via the roster's own `voting.status`; or a blank/unparseable `MEMBER_JOINED_AT`
 * the detail page would still resolve via the roster's own `created_at` (`buildResponse` ORs both
 * sources when the roster join has at least one match for that committee; this rollup only has the
 * warehouse row, never a roster fallback); or an `LF Staff` seat whose role changed on the live
 * roster more recently than the dbt model's last refresh (LFXV2-3101) — `MEMBER_ROLE` (unlike the
 * roster fallbacks above) IS a column on this same `platinum_lfx_one_committee_meeting_attendance`
 * table `ActiveMemberRow` already reads, so selecting it and passing `role: row.MEMBER_ROLE` into
 * `classificationInput` costs nothing extra (no roster join, no N+1) and closes the gap for the
 * common case — but this rollup has no live roster at all to prefer, unlike the detail page's
 * roster-first precedence (`committee-engagement.service.ts`'s `role` resolution, LFXV2-3101 review
 * fix: `member.role?.name || row?.MEMBER_ROLE`). So a role promoted onto (or demoted off) the live
 * roster lands on the detail page immediately but only reaches this rollup at the model's next
 * refresh — a real, if narrow, divergence window, same family as the other three above.
 *
 * A larger case in the same family, deliberately NOT wired the same way: this rollup dedupes purely
 * on the warehouse's own `MEMBER_USER_ID` with no roster join at all, so a committee whose
 * `MEMBER_USER_ID` values don't key to any roster member still contributes its warehouse-classified
 * members to this count, while `committee-engagement.service.ts`'s detail page — which now resolves
 * member ids via `resolveMemberV2UidsToV1Ids` (a `committee_member.uid.<v2MemberUid>` NATS key on
 * `lfx.lookup_v1_mapping`, LFXV2-1705) — reports `data_available: false` and every non-Emeritus
 * member `Inactive` for that same committee. This is a real, currently-live divergence between the
 * two surfaces, not just a theoretical one. It's intentionally not closed here: this rollup's count
 * only needs distinct warehouse ids, not v2 identity, so it's already correct regardless of id
 * space — resolving member ids here would require a roster fetch per visible committee, reintroducing
 * the exact N+1 this endpoint exists to avoid. (Whether `member_sfid`, the resolved value on the
 * detail-page side, actually shares an identity space with `MEMBER_USER_ID` is itself still pending
 * live-validation confirmation, not a settled fact.) Visible committee uids are v2 committee-service
 * UUIDs; the model is keyed on the v1 committee SFID, so every uid is resolved via
 * `resolveCommitteeV2UidsToV1Ids` before querying (confirmed with Jordan Evans, data owner,
 * LFXV2-2968). Live validation showed nearly every real caller has at least one visible committee
 * that's unresolved or not yet synced, so as of LFXV2-2978 `active_members` counts over the
 * *covered* subset only and reports `coverage: { covered, total }` alongside it, rather than
 * degrading to `null` on any single gap — see `computeActiveMembers`'s doc comment for exactly what
 * "covered" means. `meetings_this_month` stays `null` in live mode — the model exposes only rolling
 * 30d/90d/YTD meeting counts, not a calendar-month grain, so there's no honest source for it yet
 * (LFXV2-2961 tracks adding one). Defaults to `live` (never fabricated numbers) unless
 * `ENGAGEMENT_BACKEND=mock` is explicitly set, and `mock` is additionally hard-blocked when
 * `NODE_ENV=production`.
 */
export class GroupsEngagementStatsService {
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly committeeService = new CommitteeService();
  private readonly natsService = new NatsService();

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
      const { activeMembers, coverage } = await this.computeActiveMembers(req);
      // meetings_this_month: no calendar-month grain exists in the model (only rolling
      // 30d/90d/YTD) — left null rather than mislabeling a rolling window as "this month".
      // LFXV2-2961 tracks adding a calendar-month data source.
      return { active_members: activeMembers, meetings_this_month: null, computed_at: computedAt, source: 'live', coverage };
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
   * the *covered* subset of committees the caller can see (`getMyCommitteeUids` — "mine" semantics,
   * no scope param, per LFXV2-1711). A member is counted once even if active on multiple covered
   * committees — the model's grain is one row per `(committee_id, member_user_id)`, so a member on
   * N committees produces N rows; deduping by `MEMBER_USER_ID` is what makes this a *member* count
   * rather than a row count. `getMyCommitteeUids` returns v2 committee-service UUIDs; the model is
   * keyed on the v1 committee SFID (confirmed with Jordan Evans, data owner, LFXV2-2968), so every
   * visible uid is resolved via `resolveCommitteeV2UidsToV1Ids` (the platform's
   * `lfx.lookup_v1_mapping` NATS bridge) before querying — see that helper's doc comment for the
   * v1/v2 split. The (resolved) committee-uid list is chunked (`COMMITTEE_UID_CHUNK_SIZE`) so a
   * caller who belongs to many committees (e.g. LF staff) doesn't produce an unbounded bind list or
   * row volume in one query, and chunks run at most `GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY` at a time
   * so that same caller can't monopolize a large fraction of the shared Snowflake connection pool in
   * one request.
   *
   * A committee is "covered" when its v2 uid resolved to a v1 id AND the model has at least one row
   * for that v1 id — checked per originally-requested v2 committee, forward through `v2ToV1Map` (not
   * via a v1->v2 inversion, which would be lossy if two v2 committees ever resolved to the same v1
   * id — see the coverage-loop comment below). `activeMembers` is computed over the covered subset
   * only (LFXV2-2978 — a caller with 10 visible committees where 9 are covered gets a real count
   * over those 9, plus `coverage: { covered: 9, total: 10 }`, rather than a blanket `null` for the
   * whole caller). Result shapes:
   * - `{ activeMembers: 0, coverage: { covered: 0, total: 0 } }`: the caller genuinely has no
   *   visible committees — a real answer, no query even runs.
   * - `{ activeMembers: N, coverage: { covered, total } }` (`covered` possibly `< total`): a real,
   *   computed count over whichever committees are covered — `covered === total` means it's
   *   complete; `covered < total` means it's a real but partial count the client should disclose.
   *   `N` can itself be `0` (a real, fully- or partially-covered zero — nobody active in the covered
   *   subset), which is why this shape is distinguished from the null cases by `active_members`
   *   being non-null, not by it being nonzero.
   * - `{ activeMembers: null, coverage: { covered: 0, total } }`: nothing could be counted, for
   *   either of two reasons that deliberately alias to the same wire shape — every visible committee
   *   is uncovered (none resolved to a v1 id, or none have model rows yet), or the computation
   *   failed after the committee set was already known (a Snowflake missing-object/not-authorized
   *   error, or any chunk failing). Both degrade the client identically ("Unavailable"), so the two
   *   aren't distinguished in the payload — the WARN log below is what tells them apart operationally.
   *   `total` is `0` only when the failure happened before the committee count was ever established
   *   (e.g. the committee-set lookup itself failing) — see the catch block.
   */
  private async computeActiveMembers(req: Request): Promise<{ activeMembers: number | null; coverage: { covered: number; total: number } }> {
    // Tracked outside the try block (not just a `const` inside it) so the catch block can still
    // report an accurate `total` in its `coverage` if the failure happens after the committee set
    // was fetched but before the count could be computed (e.g. a chunk query failure).
    let visibleCount = 0;
    try {
      const committeeUids = [...(await this.committeeService.getMyCommitteeUids(req))];
      visibleCount = committeeUids.length;
      if (committeeUids.length === 0) return { activeMembers: 0, coverage: { covered: 0, total: 0 } };

      const v2ToV1Map = await resolveCommitteeV2UidsToV1Ids(req, this.natsService, committeeUids);
      // Deduped (not just [...values()]): two visible v2 committees could in principle resolve to
      // the same v1 id, and an inverted v1->v2 map would then silently drop one of them — checking
      // coverage forward (per v2 uid, via v2ToV1Map.get) below instead of through an inversion means
      // that never needs to be a 1:1 assumption. Only resolved uids appear in this map at all
      // (`resolveCommitteeV2UidsToV1Ids`'s contract), so this already queries the covered subset
      // only — an unresolved v2 uid simply contributes nothing to `v1Ids` rather than blocking the
      // rest of the caller's covered committees from being counted.
      const v1Ids = [...new Set(v2ToV1Map.values())];

      const chunks: string[][] = [];
      for (let i = 0; i < v1Ids.length; i += COMMITTEE_UID_CHUNK_SIZE) {
        chunks.push(v1Ids.slice(i, i + COMMITTEE_UID_CHUNK_SIZE));
      }

      // Promise.all per batch (not allSettled): a partial-chunk failure means the count can no
      // longer be trusted as complete, so the whole computation degrades to null via the catch
      // below rather than silently returning an undercount from only the chunks that succeeded.
      // Batched at GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY rather than firing every chunk at once, so
      // this one request can't borrow an unbounded share of the Snowflake connection pool.
      const chunkResults: { rows: ActiveMemberRow[] }[] = [];
      for (let i = 0; i < chunks.length; i += GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY) {
        const batch = chunks.slice(i, i + GROUPS_ENGAGEMENT_CHUNK_CONCURRENCY);
        const batchResults = await Promise.all(batch.map((chunk) => this.queryActiveMemberChunk(chunk)));
        chunkResults.push(...batchResults);
      }

      const windowStart = new Date(Date.now() - ACTIVE_MEMBER_WINDOW_DAYS * DAY_MS);
      const activeUids = new Set<string>();
      const coveredV1Ids = new Set<string>();
      let rowCount = 0;

      for (const result of chunkResults) {
        rowCount += result.rows.length;
        for (const row of result.rows) {
          coveredV1Ids.add(row.COMMITTEE_ID);
          // Floor then clamp to `invited`, matching committee-engagement.service.ts's
          // `countsForWindow`/`buildResponse` posture — defense-in-depth against the model's own
          // `>= 0` and `attended <= invited` dbt invariants ever being violated, not a sign either
          // is known to be unenforced.
          const invited = Math.max(row.INVITED_COUNT_30D, 0);
          const classificationInput = {
            attended: Math.min(Math.max(row.ATTENDED_COUNT_30D, 0), invited),
            invited, // unused by isCommitteeMemberActive; kept only for the clamp above
            votingStatus: row.MEMBER_VOTING_STATUS,
            role: row.MEMBER_ROLE,
            joinedWithinWindow: isJoinedWithinWindow(row.MEMBER_JOINED_AT, windowStart),
          };
          if (isCommitteeMemberActive(classificationInput)) activeUids.add(row.MEMBER_USER_ID);
        }
      }

      // Coverage is checked per originally-requested v2 committee, forward through v2ToV1Map (not
      // via a v1->v2 inversion, which would be lossy if two v2 committees ever resolved to the same
      // v1 id) — a v2 uid that never resolved to a v1 id at all, or whose resolved v1 id has no
      // covered row, both count as uncovered. See the doc comment above.
      const uncoveredCount = committeeUids.filter((uid) => {
        const v1Id = v2ToV1Map.get(uid);
        return !v1Id || !coveredV1Ids.has(v1Id);
      }).length;
      const coveredCount = committeeUids.length - uncoveredCount;
      const coverage = { covered: coveredCount, total: committeeUids.length };
      // Computed before logging so the logged active_members always matches what's actually
      // returned. `activeUids` is already scoped to covered committees (rows only exist for
      // committees present in the query result), so this is a true "count over the covered subset,"
      // not a filter applied after the fact.
      const activeMembers = coveredCount > 0 ? activeUids.size : null;

      if (coveredCount === 0) {
        // WARN, not DEBUG: this is the one in-band path that fully degrades `active_members` to
        // `null` without throwing — the same "recoverable error, returning null" case
        // `.claude/rules/logging-patterns.md` reserves WARN for, and the only thing that
        // distinguishes this from the catch block's post-fetch-failure WARNs in production logs
        // (both produce the identical `{ activeMembers: null, coverage: { covered: 0, total } }`
        // wire shape — see the doc comment above). `resolved_v1_count`/`chunk_count` distinguish
        // the two sub-causes on-call would otherwise have to guess between: 0 resolved ids means no
        // visible uid mapped at all (an `lfx.lookup_v1_mapping` problem), while resolved ids > 0
        // means uids mapped but the model has no rows for them yet (a dbt/sync problem).
        logger.warning(req, 'get_groups_engagement_stats', 'No visible committee is covered by the engagement model; returning null active_members', {
          committee_count: committeeUids.length,
          resolved_v1_count: v1Ids.length,
          chunk_count: chunks.length,
        });
      } else {
        // DEBUG, not WARNING: live validation showed nearly every real caller has at least one
        // uncovered visible committee (see the class doc comment above), so partial coverage
        // (`0 < coveredCount < committeeUids.length`) is now the expected steady state on most
        // cache misses, not a degraded/recoverable-error condition — a WARN here would fire on
        // nearly every request and bury the genuine WARN above. Full coverage logs at the same
        // level since it's the same "trace what got computed" concern, not a degrade at all.
        logger.debug(req, 'get_groups_engagement_stats', 'Computed active members', {
          committee_count: committeeUids.length,
          chunk_count: chunks.length,
          row_count: rowCount,
          active_members: activeMembers,
          covered: coveredCount,
          uncovered_committee_count: uncoveredCount,
        });
      }

      return { activeMembers, coverage };
    } catch (error) {
      // `total: visibleCount` rather than a hardcoded 0 — if `getMyCommitteeUids` succeeded and the
      // failure happened later (e.g. a chunk query), the visible-committee count is still known and
      // more honest than reporting 0. It stays 0 only when the failure happened before that count
      // was ever established.
      const coverage = { covered: 0, total: visibleCount };
      if (!SnowflakeService.isMissingObjectError(error)) {
        // A non-Snowflake failure (e.g. the visible-committee-set lookup, or a chunk query error
        // other than missing-object) is unexpected — surface it distinctly from the expected
        // pre-sync/missing-GRANT case below, but still degrade to null rather than failing the
        // whole dashboard stats request.
        logger.warning(req, 'get_groups_engagement_stats', 'Failed to compute active members; returning null', { err: error });
        return { activeMembers: null, coverage };
      }
      logger.warning(req, 'get_groups_engagement_stats', 'Active-members query hit a missing-object/not-authorized error; returning null', { err: error });
      return { activeMembers: null, coverage };
    }
  }

  private queryActiveMemberChunk(warehouseCommitteeIds: string[]): Promise<{ rows: ActiveMemberRow[] }> {
    const placeholders = warehouseCommitteeIds.map(() => '?').join(', ');
    const sql = `
      SELECT COMMITTEE_ID, MEMBER_USER_ID, MEMBER_JOINED_AT, MEMBER_VOTING_STATUS, MEMBER_ROLE, INVITED_COUNT_30D, ATTENDED_COUNT_30D
      FROM ${committeeEngagementTable()}
      WHERE COMMITTEE_ID IN (${placeholders})
    `;
    return this.snowflakeService.execute<ActiveMemberRow>(sql, warehouseCommitteeIds, { expectMissingObject: true });
  }
}

/**
 * Deterministic fixture keyed off the caller's identity — same user always sees the same numbers
 * across requests/instances (no randomness), so the mock behaves predictably in manual testing and
 * screenshots without needing a backing store. `coverage` is always full (`covered === total`) —
 * mock never fabricates a partial-coverage state, since the whole point of mock mode is exercising
 * the UI with plausible-looking values, not a degraded one the live path already covers via its own
 * partial/zero-coverage tests.
 */
function deterministicMockStats(username: string): Pick<GroupsEngagementStats, 'active_members' | 'meetings_this_month' | 'coverage'> {
  const hash = hashString(username || 'anonymous');
  const visibleGroups = 1 + (hash % 6);
  return {
    active_members: 1 + (hash % 50),
    meetings_this_month: hash % 8,
    coverage: { covered: visibleGroups, total: visibleGroups },
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
