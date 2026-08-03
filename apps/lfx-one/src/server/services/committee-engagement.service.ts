// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CommitteeEngagementDataSource,
  CommitteeEngagementQueryResult,
  CommitteeEngagementResponse,
  CommitteeEngagementWarehouseRow,
  CommitteeEngagementWindow,
  CommitteeMember,
} from '@lfx-one/shared/interfaces';
import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '@lfx-one/shared/enums';
import {
  classifyCommitteeEngagement,
  computeCommitteeEngagementRate,
  isCommitteeMemberActive,
  isCommitteeMemberAtRisk,
  isJoinedWithinWindow,
} from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { isEngagementMockBackend } from '../helpers/committee-engagement-backend.helper';
import { generateMockEngagementRows } from '../helpers/committee-engagement-mock.helper';
import { committeeEngagementTable } from '../helpers/snowflake-schema.helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { buildCommitteeCacheKey, valkeyService } from './valkey.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads the per-committee-member meeting-attendance rollup (LFXV2-1705), gated between a
 * deterministic mock generator and the real live warehouse read by `ENGAGEMENT_BACKEND` (see
 * `isEngagementMockBackend`), and joins whichever source produced rows against the committee
 * roster via `buildResponse`. Both paths produce `CommitteeEngagementWarehouseRow`-shaped rows —
 * mock synchronously in-memory, live via a direct Snowflake read against the finalized
 * `platinum_lfx_one_committee_meeting_attendance` dbt model (`lf-dbt#2694`), materialized as
 * `COMMITTEE_MEETING_ATTENDANCE` under the `PLATINUM_LFX_ONE` schema. `buildResponse` doesn't
 * branch on which path ran.
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
      // for anyone watching production logs rather than inspecting individual responses. INFO, not
      // WARN: mock mode is a deliberate, explicit opt-in (ENGAGEMENT_BACKEND=mock, additionally
      // hard-blocked in production) rather than a degradation or fallback — logging-patterns.md
      // reserves WARN for those, and INFO for significant business operations worth surfacing in
      // production. WARN-per-request here would also compete for attention with genuine
      // degradation warnings (e.g. the missing-object case below) in the same log stream.
      logger.info(req, 'get_committee_engagement', 'ENGAGEMENT_BACKEND=mock — returning deterministic mock rows, not real data', {
        committee_uid: committeeUid,
        window,
        roster_size: members.length,
      });
      return this.buildResponse(req, committeeUid, members, { rows, dataAvailable: true }, window, 'mock');
    }

    const [members, queryResult] = await Promise.all([
      this.committeeService.getCommitteeMembers(req, committeeUid),
      this.queryEngagementRows(req, committeeUid),
    ]);

    return this.buildResponse(req, committeeUid, members, queryResult, window, 'live');
  }

  /**
   * Cached per `committeeUid` for an hour, matching the sibling Snowflake-backed analytics pattern
   * in `org-lens-project-detail.service.ts`'s roster block — including its `degradedMissingObject`
   * guard: the missing-object degrade is deliberately never written to the cache, or "no data yet"
   * would keep being served for up to an hour after a transient GRANT regression clears. The
   * caller's `auditor` grant is already verified by `assertCommitteeRead` in the controller before
   * this runs, so a cache hit can't bypass it.
   *
   * One fetch covers all three windows (30d/90d/ytd are columns on the same row, not a
   * `TIME_RANGE_TYPE` filter) — `buildResponse`'s `countsForWindow` picks the right columns per
   * request, so there's no need to cache or query per-window.
   */
  private async queryEngagementRows(req: Request, committeeUid: string): Promise<CommitteeEngagementQueryResult> {
    const key = buildCommitteeCacheKey(committeeUid, 'engagement-rows');
    if (key !== null) {
      const cached = await valkeyService.getJson<CommitteeEngagementWarehouseRow[]>(key, Array.isArray);
      if (cached !== null) return { rows: cached, dataAvailable: true };
    }

    const sql = `
      SELECT MEMBER_USER_ID, MEMBER_JOINED_AT, MEMBER_ROLE, MEMBER_VOTING_STATUS,
             INVITED_COUNT_30D, ATTENDED_COUNT_30D, COMMITTEE_MEETINGS_30D,
             INVITED_COUNT_90D, ATTENDED_COUNT_90D, COMMITTEE_MEETINGS_90D,
             INVITED_COUNT_YTD, ATTENDED_COUNT_YTD, COMMITTEE_MEETINGS_YTD
      FROM ${committeeEngagementTable()}
      WHERE COMMITTEE_ID = ?
    `;
    logger.debug(req, 'get_committee_engagement', 'Querying engagement rows', { committee_uid: committeeUid });

    let rows: CommitteeEngagementWarehouseRow[] = [];
    let dataAvailable = false;
    try {
      const result = await this.snowflakeService.execute<CommitteeEngagementWarehouseRow>(sql, [committeeUid], { expectMissingObject: true });
      rows = result.rows;
      // The model is roster-anchored with zero-activity members retained, so a currently-populated
      // committee should always yield >=1 row per current roster member. Zero rows most likely
      // means this committee isn't synced/covered by the model yet, not that engagement is
      // genuinely zero for everyone — `dataAvailable: false` is the more honest "no data yet"
      // signal, consistent with the missing-object degrade below.
      dataAvailable = rows.length > 0;
      logger.debug(req, 'get_committee_engagement', 'Fetched engagement rows', { committee_uid: committeeUid, row_count: rows.length });
    } catch (error) {
      // Pre-sync (or a missing GRANT) the engagement table/row is absent; degrade to the empty
      // response the members table expects instead of 5xx per committee page load. `dataAvailable:
      // false` lets the response tell the UI this is "no data yet", not "zero engagement".
      //
      // isMissingObjectError's regex ("does not exist or not authorized") also matches a missing
      // GRANT, not just a missing table — a role/permissions misconfiguration degrades identically
      // to the pre-sync state. The message and attached `err` below are worded to not assert which
      // case this is; check `err` first.
      if (!SnowflakeService.isMissingObjectError(error)) throw error;
      logger.warning(req, 'get_committee_engagement', 'Engagement query hit a missing-object/not-authorized error; returning empty response', {
        committee_uid: committeeUid,
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
   * exact key needing no blank/duplicate-email data-quality layer. A minimal duplicate-uid guard
   * remains (last-write-wins, logged) in case the live read ever surfaces a grain bug; the model's
   * own dbt tests already enforce uniqueness on this grain, so this is a defensive backstop, not an
   * expected occurrence.
   *
   * Every roster member appears in the response even without a matching row, so `total_count`
   * always reflects the full committee; a member with no matching row (today, only the live-degrade
   * case — mock mode's rows are roster-anchored 1:1) defaults to `invited=0, attended=0`, but
   * `role`/`voting_status`/join-date fall back to the roster's own values (see below) whenever the
   * row is absent or its own value for that field is missing — these three are roster attributes
   * the warehouse row also mirrors, not warehouse-computed metrics, so the roster is an equally
   * authoritative source when the row can't supply them. A roster-Emeritus member still classifies
   * `Emeritus`; a member who genuinely joined within the window still gets the tenure-grace `High`
   * instead of `Inactive`; everyone else classifies `Inactive`.
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
      // are always non-empty strings. Last-resort default is the documented `None` sentinel rather
      // than '' — matching the mock generator's own role default
      // (`member.role?.name ?? CommitteeMemberRole.NONE`); its voting-status default differs
      // (`organicVotingStatus()` hash-derives a rep status, never `None`), but that's mock mode's
      // own no-real-data-fabrication concern, not a contract this live/degraded path needs to match.
      const votingStatus = row?.MEMBER_VOTING_STATUS || member.voting?.status || CommitteeMemberVotingStatus.NONE;
      const role = row?.MEMBER_ROLE || member.role?.name || CommitteeMemberRole.NONE;
      // Same roster-fallback reasoning as role/voting-status above, but checked independently
      // rather than value-selected: a value-selection fallback (`row value || roster value`) would
      // pick a present-but-unparseable row date over a perfectly good roster one, since both are
      // truthy — `isJoinedWithinWindow` can't tell "unparseable" from "valid but outside the
      // window" from the inside. Checking both and taking either `true` sidesteps that: `created_at`
      // is a required roster field, so it's always available to fall back to, and discarding it here
      // would cost a recently-joined member their tenure grace (case 2 of the classifier's decision
      // order) whenever the row's own date is missing, blank, or unparseable.
      const joinedWithinWindow = isJoinedWithinWindow(row?.MEMBER_JOINED_AT ?? null, windowStart) || isJoinedWithinWindow(member.created_at, windowStart);

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

  /**
   * Clamps every field to non-negative — `attended` is separately clamped to `[0, invited]` by
   * the caller, but `invited`/`committeeMeetings` themselves had no floor, so a warehouse
   * data-quality issue (e.g. a negative `INVITED_COUNT`) could otherwise flow unclamped into
   * `computeCommitteeEngagementRate` and the response. Defense-in-depth, matching the same clamp's
   * posture one line up in `buildResponse` — the model's own dbt tests already enforce a `>= 0`
   * bound on every count column, so this is a backstop, not an expected occurrence.
   */
  private countsForWindow(
    row: CommitteeEngagementWarehouseRow,
    window: CommitteeEngagementWindow
  ): { invited: number; attended: number; committeeMeetings: number } {
    const clamp = (value: number): number => Math.max(value, 0);
    if (window === '30d')
      return { invited: clamp(row.INVITED_COUNT_30D), attended: clamp(row.ATTENDED_COUNT_30D), committeeMeetings: clamp(row.COMMITTEE_MEETINGS_30D) };
    if (window === '90d')
      return { invited: clamp(row.INVITED_COUNT_90D), attended: clamp(row.ATTENDED_COUNT_90D), committeeMeetings: clamp(row.COMMITTEE_MEETINGS_90D) };
    return { invited: clamp(row.INVITED_COUNT_YTD), attended: clamp(row.ATTENDED_COUNT_YTD), committeeMeetings: clamp(row.COMMITTEE_MEETINGS_YTD) };
  }

  /** Start of the requested window, for tenure clipping — `ytd` is calendar-year-to-date, `30d`/`90d` are rolling. */
  private windowStartDate(window: CommitteeEngagementWindow): Date {
    const now = new Date();
    if (window === '30d') return new Date(now.getTime() - 30 * DAY_MS);
    if (window === '90d') return new Date(now.getTime() - 90 * DAY_MS);
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
}
