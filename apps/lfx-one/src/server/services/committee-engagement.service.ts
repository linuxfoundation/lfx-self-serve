// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CommitteeEngagementDataSource,
  CommitteeEngagementQueryResult,
  CommitteeEngagementResponse,
  CommitteeEngagementWarehouseRow,
  CommitteeEngagementWindow,
  CommitteeMember,
  LegacyEngagementPlaceholderRow,
} from '@lfx-one/shared/interfaces';
import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import { classifyCommitteeEngagement, computeCommitteeEngagementRate, isCommitteeMemberActive, isCommitteeMemberAtRisk } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { isEngagementMockBackend } from '../helpers/committee-engagement-backend.helper';
import { generateMockEngagementRows } from '../helpers/committee-engagement-mock.helper';
import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { buildCommitteeCacheKey, valkeyService } from './valkey.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads the per-committee-member meeting-attendance rollup (LFXV2-1705), gated between a
 * deterministic mock generator and the real (not-yet-deployed) warehouse read by
 * `ENGAGEMENT_BACKEND` (see `isEngagementMockBackend`), and joins whichever source produced rows
 * against the committee roster via `buildResponse`. Only the mock generator actually produces
 * `CommitteeEngagementWarehouseRow`-shaped rows today — the live SQL in `queryEngagementRows`
 * still targets the original placeholder columns (see that method's TODO) and resolves to an
 * empty row set rather than ever handing `buildResponse` a mismatched shape — including on a
 * cache hit, since `COMMITTEE_ENGAGEMENT_NAMESPACE`'s version segment is bumped whenever the
 * cached row shape changes, so no entry written under a prior shape can be read back as this one.
 * `buildResponse` itself doesn't branch on which path ran; the live SQL still needs a rewrite to
 * genuinely produce this shape once the real read surface is decided.
 */
export class CommitteeEngagementService {
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly committeeService = new CommitteeService();

  /**
   * Mock mode fetches the roster live (so mock rows can anchor to real uids) and generates rows
   * synchronously in-memory — no Snowflake call, no cache, nothing to await beyond the roster read.
   * Live mode races the roster and Snowflake reads via `Promise.all`; `queryEngagementRows` owns
   * its own caching and missing-object degrade independently of this method.
   */
  public async getCommitteeEngagement(req: Request, committeeUid: string, window: CommitteeEngagementWindow): Promise<CommitteeEngagementResponse> {
    if (isEngagementMockBackend()) {
      const members = await this.committeeService.getCommitteeMembers(req, committeeUid);
      const rows = generateMockEngagementRows(committeeUid, members);
      // The ops-side signal that a response is fabricated — `data_source: 'mock'` on the response
      // body (below) is the in-band one any consumer must check; this is the log-side counterpart
      // for anyone watching production logs rather than inspecting individual responses.
      logger.warning(req, 'get_committee_engagement', 'ENGAGEMENT_BACKEND is not live; returning deterministic mock rows', {
        committee_uid: committeeUid,
        window,
        roster_size: members.length,
      });
      return this.buildResponse(req, committeeUid, members, { rows, dataAvailable: true }, window, 'mock');
    }

    const [members, queryResult] = await Promise.all([
      this.committeeService.getCommitteeMembers(req, committeeUid),
      this.queryEngagementRows(req, committeeUid, window),
    ]);

    return this.buildResponse(req, committeeUid, members, queryResult, window, 'live');
  }

  /**
   * Cached per `(committeeUid, window)` for an hour, matching the sibling Snowflake-backed
   * analytics pattern in `org-lens-project-detail.service.ts`'s roster block — including its
   * `degradedMissingObject` guard: the missing-object degrade is deliberately never written to the
   * cache, or "no data yet" would keep being served for up to an hour after the real dbt model
   * lands (and, per the comment below, a transient GRANT regression would get an hour of false
   * "no data" too). The caller's `auditor` grant is already verified by `assertCommitteeRead` in
   * the controller before this runs, so a cache hit can't bypass it.
   *
   * TODO(LFXV2-1705 follow-up): this SQL still targets the original placeholder shape
   * (`MEMBER_EMAIL`/`ATTENDED_COUNT`/`INVITED_COUNT`/`COMPUTED_AT`), not the finalized
   * `platinum_lfx_one_committee_meeting_attendance` model's real columns. Typed against
   * `LegacyEngagementPlaceholderRow` — not `CommitteeEngagementWarehouseRow` — since the two
   * shapes share no fields and there's no honest mapping between them; a successful query (which
   * would only happen if a table under the old placeholder name/columns exists, not the real
   * model) degrades the same way a missing table does rather than silently type-casting an old row
   * into the new shape and producing `undefined`/`NaN` throughout the response. Needs a full
   * rewrite once the live read surface (query-service vs. direct Snowflake) is decided.
   */
  private async queryEngagementRows(req: Request, committeeUid: string, window: CommitteeEngagementWindow): Promise<CommitteeEngagementQueryResult> {
    const key = buildCommitteeCacheKey(committeeUid, `engagement-rows:${window}`);
    if (key !== null) {
      const cached = await valkeyService.getJson<CommitteeEngagementWarehouseRow[]>(key, Array.isArray);
      if (cached !== null) return { rows: cached, dataAvailable: true };
    }

    const sql = `
      SELECT MEMBER_EMAIL, ATTENDED_COUNT, INVITED_COUNT, COMPUTED_AT
      FROM ${this.engagementTable()}
      WHERE COMMITTEE_UID = ? AND TIME_RANGE_TYPE = ?
      ORDER BY MEMBER_EMAIL
    `;
    logger.debug(req, 'get_committee_engagement', 'Querying engagement rows', { committee_uid: committeeUid, window });

    const rows: CommitteeEngagementWarehouseRow[] = [];
    let dataAvailable = false;
    try {
      const result = await this.snowflakeService.execute<LegacyEngagementPlaceholderRow>(sql, [committeeUid, window], { expectMissingObject: true });
      if (result.rows.length > 0) {
        // A table under the placeholder name/columns exists and returned rows — can't happen once
        // the real model deploys under its own name, but if it ever does, this is not a shape this
        // service can map, so it degrades rather than fabricating MEMBER_USER_ID/etc. from columns
        // that don't have that information.
        logger.warning(
          req,
          'get_committee_engagement',
          'Live engagement query returned rows in the pre-finalization placeholder shape; cannot map to the current model, returning empty response',
          {
            committee_uid: committeeUid,
            window,
            row_count: result.rows.length,
          }
        );
      } else {
        dataAvailable = true;
        logger.debug(req, 'get_committee_engagement', 'Fetched engagement rows', { committee_uid: committeeUid, window, row_count: 0 });
      }
    } catch (error) {
      // Pre-dbt-deploy the engagement table is absent; degrade to the empty response the
      // members table expects instead of 5xx per committee page load. `dataAvailable: false`
      // lets the response tell the UI this is "no data yet", not "zero engagement".
      //
      // isMissingObjectError's regex ("does not exist or not authorized") also matches a missing
      // GRANT, not just a missing table — once the model is deployed, a role/permissions
      // misconfiguration will degrade identically to the pre-deploy state. The message and
      // attached `err` below are worded to not assert which case this is; check `err` first.
      if (!SnowflakeService.isMissingObjectError(error)) throw error;
      logger.warning(req, 'get_committee_engagement', 'Engagement query hit a missing-object/not-authorized error; returning empty response', {
        committee_uid: committeeUid,
        window,
        err: error,
      });
    }

    if (key !== null && dataAvailable) {
      await valkeyService.setJson(key, rows, VALKEY_CACHE.COMMITTEE_ENGAGEMENT_TTL_SECONDS);
    }

    return { rows, dataAvailable };
  }

  /**
   * Joins on `MEMBER_USER_ID` = `CommitteeMember.uid`, per the finalized dbt model's documented
   * grain (`committee_id, member_user_id` — see `committee-engagement.internal.interface.ts`); an
   * exact key needing no blank/duplicate-email data-quality layer. This assumes `member_user_id`
   * resolves to the same identity as `CommitteeMember.uid` — worth re-confirming against the real
   * model once the live read is wired up, since it's untestable before then. A minimal
   * duplicate-uid guard remains (last-write-wins, logged) in case a future live implementation has
   * a grain bug; the model's own dbt tests already enforce uniqueness on this grain, so this is a
   * defensive backstop, not an expected occurrence.
   *
   * Every roster member appears in the response even without a matching row, so `total_count`
   * always reflects the full committee; an unmatched member (today, only the live-degrade case —
   * mock mode's rows are roster-anchored 1:1) defaults to `invited=0, attended=0`,
   * not-joined-within-window — but `role`/`voting_status` still come from the roster itself (see
   * below), so a roster-Emeritus member still classifies `Emeritus`; everyone else classifies
   * `Inactive`.
   */
  private buildResponse(
    req: Request,
    committeeUid: string,
    members: CommitteeMember[],
    queryResult: CommitteeEngagementQueryResult,
    window: CommitteeEngagementWindow,
    dataSource: CommitteeEngagementDataSource
  ): CommitteeEngagementResponse {
    const { rows, dataAvailable } = queryResult;

    const rowsByUid = new Map<string, CommitteeEngagementWarehouseRow>();
    let duplicateUidRowCount = 0;
    for (const row of rows) {
      if (rowsByUid.has(row.MEMBER_USER_ID)) duplicateUidRowCount++;
      rowsByUid.set(row.MEMBER_USER_ID, row);
    }
    if (duplicateUidRowCount > 0) {
      logger.warning(req, 'get_committee_engagement', 'Multiple warehouse rows shared the same member uid; the last one won', {
        committee_uid: committeeUid,
        duplicate_uid_row_count: duplicateUidRowCount,
        row_count: rows.length,
      });
    }

    const windowStart = this.windowStartDate(window);

    let totalAttended = 0;
    let totalInvited = 0;
    let activeCount = 0;
    let atRiskCount = 0;
    let matchedCount = 0;

    const memberEngagements = members.map((member) => {
      const row = rowsByUid.get(member.uid);
      if (row) matchedCount++;

      const counts = row ? this.countsForWindow(row, window) : { invited: 0, attended: 0, committeeMeetings: 0 };
      // Clamped to `invited`: the finalized model's own dbt tests are expected to enforce
      // `attended <= invited` as a grain invariant, but this defends against that guarantee being
      // violated in practice (a mismatched grain assumption, a future live-read bug) rather than
      // assuming it's already broken — an unclamped value here would produce a >100% rate.
      const attended = Math.min(counts.attended, counts.invited);
      // Falls back to the roster's own role/voting-status (already in hand, not warehouse-sourced)
      // rather than defaulting straight to 'None' when there's no matching row — otherwise a real,
      // known Emeritus member would silently lose that short-circuit and classify Inactive on every
      // unmatched/degraded response, even though the roster already knows better. `||`, not `??`,
      // so a blank passthrough falls through too; both fields' real enum values ('None' included)
      // are always non-empty strings. Last-resort default matches the mock generator's own
      // no-real-data default, so "None" (not "") is what a consumer sees either way.
      const votingStatus = row?.MEMBER_VOTING_STATUS || member.voting?.status || CommitteeMemberVotingStatus.NONE;
      const role = row?.MEMBER_ROLE || member.role?.name || CommitteeMemberRole.NONE;
      const joinedWithinWindow = row ? this.isJoinedWithinWindow(row.MEMBER_JOINED_AT, windowStart) : false;

      const classificationInput = { attended, invited: counts.invited, votingStatus, joinedWithinWindow };
      totalAttended += attended;
      totalInvited += counts.invited;

      const classification = classifyCommitteeEngagement(classificationInput);
      if (isCommitteeMemberActive(classificationInput)) activeCount++;
      if (isCommitteeMemberAtRisk(classificationInput)) atRiskCount++;

      return {
        uid: member.uid,
        attended,
        invited: counts.invited,
        rate: computeCommitteeEngagementRate(attended, counts.invited),
        classification,
        role,
        voting_status: votingStatus,
        committee_meetings: counts.committeeMeetings,
      };
    });

    if (rows.length > 0 && members.length > 0 && matchedCount === 0) {
      logger.warning(req, 'get_committee_engagement', 'Engagement rows returned but none matched the committee roster by uid — join key mismatch?', {
        committee_uid: committeeUid,
        row_count: rows.length,
        roster_size: members.length,
      });
    }

    logger.debug(req, 'get_committee_engagement', 'Joined engagement rows to the roster', {
      committee_uid: committeeUid,
      roster_size: members.length,
      matched_count: matchedCount,
      data_available: dataAvailable,
    });

    return {
      members: memberEngagements,
      summary: {
        attendance_rate: computeCommitteeEngagementRate(totalAttended, totalInvited),
        active_count: activeCount,
        total_count: members.length,
        at_risk_count: atRiskCount,
      },
      // Always null: the real model doesn't expose a freshness column yet (a separate follow-up).
      // `formatCommitteeEngagementFreshness` gives the UI a "Updated daily" label for this case.
      computed_at: null,
      data_available: dataAvailable,
      data_source: dataSource,
    };
  }

  private countsForWindow(
    row: CommitteeEngagementWarehouseRow,
    window: CommitteeEngagementWindow
  ): { invited: number; attended: number; committeeMeetings: number } {
    if (window === '30d') return { invited: row.INVITED_COUNT_30D, attended: row.ATTENDED_COUNT_30D, committeeMeetings: row.COMMITTEE_MEETINGS_30D };
    if (window === '90d') return { invited: row.INVITED_COUNT_90D, attended: row.ATTENDED_COUNT_90D, committeeMeetings: row.COMMITTEE_MEETINGS_90D };
    return { invited: row.INVITED_COUNT_YTD, attended: row.ATTENDED_COUNT_YTD, committeeMeetings: row.COMMITTEE_MEETINGS_YTD };
  }

  /** Start of the requested window, for tenure clipping — `ytd` is calendar-year-to-date, `30d`/`90d` are rolling. */
  private windowStartDate(window: CommitteeEngagementWindow): Date {
    const now = new Date();
    if (window === '30d') return new Date(now.getTime() - 30 * DAY_MS);
    if (window === '90d') return new Date(now.getTime() - 90 * DAY_MS);
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }

  /** `false` (fail-safe: no tenure protection) for a missing or unparseable join date, matching the "unmatched member" default. */
  private isJoinedWithinWindow(joinedAt: string | Date | null, windowStart: Date): boolean {
    if (!joinedAt) return false;
    const joined = joinedAt instanceof Date ? joinedAt : new Date(joinedAt);
    return !Number.isNaN(joined.getTime()) && joined.getTime() > windowStart.getTime();
  }

  /**
   * TODO(LFXV2-1705 follow-up): placeholder table/column names for the live path — see
   * `queryEngagementRows`'s doc comment for why this doesn't need reconciling with the finalized
   * model's real schema until the live read surface is decided.
   */
  private engagementTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.COMMITTEE_MEMBER_MEETING_ATTENDANCE`;
  }
}
