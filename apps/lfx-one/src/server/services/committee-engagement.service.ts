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
import { resolveCommitteeV2UidsToV1Ids } from '../helpers/committee-v1-mapping.helper';
import { resolveMemberV2UidsToV1Ids } from '../helpers/member-v1-mapping.helper';
import { committeeEngagementTable } from '../helpers/snowflake-schema.helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { NatsService } from './nats.service';
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
 *
 * The live path resolves the route's v2 committee UUID to the model's v1 committee SFID via
 * `resolveCommitteeV2UidsToV1Ids` before querying (`queryEngagementRows`) — the model is keyed on
 * the v1 SFID (the platform-collaboration source predates v2), confirmed with Jordan Evans, data
 * owner, LFXV2-2968. See that method's doc comment for the mapping details. The model is *also*
 * keyed on a v1 member id at the row level — `getCommitteeEngagement` resolves the roster's v2
 * member uids via `resolveMemberV2UidsToV1Ids` (a cached NATS bridge, LFXV2-1705) before
 * `buildResponse` joins rows to the roster; see that method's and `buildResponse`'s doc comments.
 * TODO(LFXV2-2973): both bridges are temporary — remove once the model carries v2 keys directly
 * (LFXV2-2968).
 */
export class CommitteeEngagementService {
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly committeeService = new CommitteeService();
  private readonly natsService = new NatsService();

  /**
   * Mock mode fetches the roster live (so mock rows can anchor to real uids) and generates rows
   * synchronously in-memory — no Snowflake call, no cache, nothing to await beyond the roster read.
   * `generateMockEngagementRows` already keys every row on the real `CommitteeMember.uid`, so mock
   * mode passes `buildResponse` an identity map (`uid -> uid`) rather than calling the real NATS/cache
   * bridge — `buildResponse` itself doesn't need to know it's mock mode, it just always joins through
   * whichever `memberV1Map` it's given.
   *
   * Live mode races the roster and Snowflake reads via `Promise.all` (`queryEngagementRows` owns its
   * own caching and missing-object degrade independently of this method) — both promises are handed
   * to the same `Promise.all` call synchronously so neither can ever be an unhandled rejection, even
   * if one settles while the other is still pending. The member-ID bridge (LFXV2-1705,
   * TODO(LFXV2-2973): temporary, remove once the model carries v2 keys directly per LFXV2-2968) then
   * runs only when the query actually returned rows — a committee with zero rows (not yet synced, or
   * a missing-object degrade) has nothing to join against regardless of whether member ids resolve,
   * so skipping it avoids paying the bridge's worst-case NATS exposure (concurrency-batched, but still
   * many seconds under a slow/down responder) on every request for a committee this data can't help.
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
      const identityMemberV1Map = new Map(members.map((member) => [member.uid, member.uid]));
      return this.buildResponse(req, committeeUid, members, { rows, dataAvailable: true }, window, 'mock', identityMemberV1Map);
    }

    const [members, queryResult] = await Promise.all([
      this.committeeService.getCommitteeMembers(req, committeeUid),
      this.queryEngagementRows(req, committeeUid),
    ]);

    const memberV1Map =
      queryResult.rows.length > 0
        ? await resolveMemberV2UidsToV1Ids(
            req,
            this.natsService,
            members.map((member) => member.uid)
          )
        : new Map<string, string>();

    return this.buildResponse(req, committeeUid, members, queryResult, window, 'live', memberV1Map);
  }

  /**
   * Cached per `committeeUid`, matching the sibling Snowflake-backed analytics pattern in
   * `org-lens-project-detail.service.ts`'s roster block — including its `degradedMissingObject`
   * guard: a hard query error (missing table, or a missing GRANT — indistinguishable from each
   * other) is never cached, so a transient regression can't get masked for even a short TTL. The
   * caller's `auditor` grant is already verified by `assertCommitteeRead` in the controller before
   * this runs, so a cache hit can't bypass it.
   *
   * A *successful* query is always cached, including a genuinely empty (`dataAvailable: false`)
   * result — otherwise a committee the model doesn't cover yet costs a fresh Snowflake round trip
   * on every page load until it syncs. The empty case gets a much shorter TTL
   * (`COMMITTEE_ENGAGEMENT_DEGRADE_TTL_SECONDS`) than a populated one
   * (`COMMITTEE_ENGAGEMENT_TTL_SECONDS`) so "no data yet" can't outlive the sync by up to an hour.
   * A cache hit derives `dataAvailable` from the cached array's length rather than assuming `true`,
   * since both outcomes are now cached under the same key.
   *
   * One fetch covers all three windows (30d/90d/ytd are columns on the same row, not a
   * `TIME_RANGE_TYPE` filter) — `buildResponse`'s `countsForWindow` picks the right columns per
   * request, so there's no need to cache or query per-window.
   *
   * `committeeUid` is the v2 committee-service UUID (the route param); the model is keyed on the
   * v1 committee SFID — two different, both-correct ID spaces for the same committee (confirmed
   * with Jordan Evans, data owner, LFXV2-2968). Resolved via `resolveCommitteeV2UidsToV1Ids` (the
   * platform's `lfx.lookup_v1_mapping` NATS bridge, the same one `meeting.controller.ts` already
   * uses for the identical split) before querying — the cache-hit fast path above runs first,
   * still keyed on the v2 uid (the request identity), so a cache hit never needs the NATS round trip.
   */
  private async queryEngagementRows(req: Request, committeeUid: string): Promise<CommitteeEngagementQueryResult> {
    const key = buildCommitteeCacheKey(committeeUid, 'engagement-rows');
    if (key !== null) {
      const cached = await valkeyService.getJson<CommitteeEngagementWarehouseRow[]>(key, Array.isArray);
      if (cached !== null) return { rows: cached, dataAvailable: cached.length > 0 };
    }

    const v2ToV1Map = await resolveCommitteeV2UidsToV1Ids(req, this.natsService, [committeeUid]);
    const warehouseCommitteeId = v2ToV1Map.get(committeeUid);
    if (!warehouseCommitteeId) {
      // No v1 mapping for this committee (not yet migrated, or the NATS lookup failed) — degrade
      // the same honest way as a missing-object Snowflake error, and don't cache it: a transient
      // NATS hiccup shouldn't get masked as "no data" for even the short degrade TTL.
      logger.warning(req, 'get_committee_engagement', 'Could not resolve committee v2 uid to a v1 id; returning empty response', {
        committee_uid: committeeUid,
      });
      return { rows: [], dataAvailable: false };
    }

    const sql = `
      SELECT MEMBER_USER_ID, MEMBER_JOINED_AT, MEMBER_ROLE, MEMBER_VOTING_STATUS,
             INVITED_COUNT_30D, ATTENDED_COUNT_30D, COMMITTEE_MEETINGS_30D,
             INVITED_COUNT_90D, ATTENDED_COUNT_90D, COMMITTEE_MEETINGS_90D,
             INVITED_COUNT_YTD, ATTENDED_COUNT_YTD, COMMITTEE_MEETINGS_YTD
      FROM ${committeeEngagementTable()}
      WHERE COMMITTEE_ID = ?
    `;
    logger.debug(req, 'get_committee_engagement', 'Querying engagement rows', { committee_uid: committeeUid, warehouse_committee_id: warehouseCommitteeId });

    let rows: CommitteeEngagementWarehouseRow[] = [];
    let queriedSuccessfully = false;
    try {
      const result = await this.snowflakeService.execute<CommitteeEngagementWarehouseRow>(sql, [warehouseCommitteeId], { expectMissingObject: true });
      rows = result.rows;
      queriedSuccessfully = true;
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

    // The model is roster-anchored with zero-activity members retained, so a currently-populated
    // committee should always yield >=1 row per current roster member. Zero rows most likely means
    // this committee isn't synced/covered by the model yet, not that engagement is genuinely zero
    // for everyone — `dataAvailable: false` is the more honest "no data yet" signal.
    const dataAvailable = rows.length > 0;

    if (key !== null && queriedSuccessfully) {
      await valkeyService.setJson(
        key,
        rows,
        dataAvailable ? VALKEY_CACHE.COMMITTEE_ENGAGEMENT_TTL_SECONDS : VALKEY_CACHE.COMMITTEE_ENGAGEMENT_DEGRADE_TTL_SECONDS
      );
    }

    return { rows, dataAvailable };
  }

  /**
   * Joins on `MEMBER_USER_ID` = the roster member's *resolved v1 id* (`memberV1Map.get(member.uid)`,
   * LFXV2-1705's member-ID bridge — see this class's and `member-v1-mapping.helper.ts`'s doc
   * comments), not `CommitteeMember.uid` directly: the finalized dbt model's documented grain
   * (`committee_id, member_user_id` — see `committee-engagement.internal.interface.ts`) is native to
   * the legacy platform-collaboration source, which predates v2 and never carried v2 identifiers. A
   * minimal duplicate-uid guard remains (last-write-wins, logged) in case the live read ever surfaces
   * a grain bug; the model's own dbt tests already enforce uniqueness on this grain, so this is a
   * defensive backstop, not an expected occurrence.
   *
   * Every roster member appears in the response even without a matching row, so `total_count`
   * always reflects the full committee; a member with no matching row — the whole-committee
   * `dataAvailable: false` case, or (on an otherwise fully successful, `dataAvailable: true` live
   * read) a roster member added since the model's last daily refresh — defaults to `invited=0,
   * attended=0`, but `role`/`voting_status`/join-date fall back to the roster's own values (see
   * below) whenever the row is absent or its own value for that field is missing — these three are
   * roster attributes the warehouse row also mirrors, not warehouse-computed metrics, so the roster
   * is an equally authoritative source when the row can't supply them. A roster-Emeritus member
   * still classifies `Emeritus` regardless of `dataAvailable` (a seat-type fact, not a computed
   * metric). The roster `created_at` tenure-grace fallback, though, only fires when `dataAvailable`
   * is true AND at least one roster member matched a warehouse row for this committee
   * (`anyRowMatched`) — a genuinely joined-within-window member gets `High` instead of `Inactive`
   * when their committee has real (if individually unmatched) data, but not when the whole
   * committee returned zero rows, nor when the committee has rows but none of them key to this
   * roster at all (a total join-key mismatch, e.g. `MEMBER_USER_ID` values that don't correspond to
   * any `CommitteeMember.uid`): in both cases there's zero real data to correlate against for
   * *any* member, so `created_at` isn't a trustworthy tenure signal for one unmatched member,
   * let alone the whole roster — tenure-grace `High` on literal 0/0 counts across every member
   * would contradict the honest "no usable join for this committee" state rather than degrade to
   * `Inactive`. For the same reason, the response's own `data_available` field reports
   * `usableData` (`dataAvailable && anyRowMatched`), not the raw query-level `dataAvailable` — a
   * total join-key mismatch degrades the same way a genuinely empty read does, from the caller's
   * point of view, rather than reporting `true` alongside a fully zeroed/`Inactive` roster.
   *
   * `MEMBER_USER_ID` is warehouse-native v1-space (a legacy LFID/Salesforce-SFID), not
   * `CommitteeMember.uid` directly — `memberV1Map` (built by the caller via
   * `resolveMemberV2UidsToV1Ids`, or an identity map in mock mode where rows are already keyed on
   * the real uid) resolves each roster member's v2 uid to that v1 id before the lookup below. A
   * member whose id never resolved (no mapping, a NATS failure, or the lookup's wall-clock budget
   * cutting it off) is indistinguishable here from one who resolved but had no matching warehouse
   * row — both simply produce no `row`, and fall through the existing zero-counts/tenure-grace
   * path unchanged. TODO(LFXV2-2973): this member-ID bridge is temporary — remove once the model
   * carries v2 keys directly (LFXV2-2968).
   */
  private buildResponse(
    req: Request,
    committeeUid: string,
    members: CommitteeMember[],
    queryResult: CommitteeEngagementQueryResult,
    window: CommitteeEngagementWindow,
    dataSource: CommitteeEngagementDataSource,
    memberV1Map: Map<string, string>
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

    // A total join-key mismatch (rows exist, but none key to any roster member) is operationally
    // indistinguishable from a genuinely empty read: neither leaves any trustworthy per-member data
    // to report. `usableData` — not the raw `dataAvailable` — is what both the roster `created_at`
    // tenure-grace fallback below and the response's own `data_available` field key off, so a
    // committee whose warehouse rows exist but don't join to this roster reports honestly as
    // `data_available: false` rather than `true` with every member falsely zeroed/graced.
    const anyRowMatched = members.some((member) => {
      const v1MemberId = memberV1Map.get(member.uid);
      return v1MemberId ? rowsByUid.has(v1MemberId) : false;
    });
    const usableData = dataAvailable && anyRowMatched;

    const windowStart = this.windowStartDate(window);

    let totalAttended = 0;
    let totalInvited = 0;
    let activeCount = 0;
    let atRiskCount = 0;
    let matchedCount = 0;

    const memberEngagements = members.map((member) => {
      const v1MemberId = memberV1Map.get(member.uid);
      const row = v1MemberId ? rowsByUid.get(v1MemberId) : undefined;
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
      //
      // The roster `created_at` fallback is gated on `usableData` (`dataAvailable && anyRowMatched`),
      // though — it only makes sense when the committee genuinely HAS warehouse data AND at least
      // one roster member's row is matched, i.e. this one member's row is individually missing (e.g.
      // added since the model's last refresh) from an otherwise-working join. When the data isn't
      // usable — the whole committee returned zero rows, or rows exist but none key to this roster
      // (a total join-key mismatch) — there is no trustworthy engagement data to correlate tenure
      // against for *any* member; treating every recent roster joiner as tenure-graced `High` in
      // either state produces an internally inconsistent payload — `data_available:false` (which
      // this method now also reports for the broken-join case, see `usableData` above) alongside a
      // nonzero `active_count` and `High` classifications on literal 0/0 counts. `row?.` is
      // unaffected by this gate: a matched row can only exist when `anyRowMatched` is already true.
      const joinedWithinWindow =
        isJoinedWithinWindow(row?.MEMBER_JOINED_AT ?? null, windowStart) || (usableData && isJoinedWithinWindow(member.created_at, windowStart));

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
      // Named distinctly: `data_available` here would collide with the *response* field of that
      // name (which now reports `usableData`, not this raw query-level flag) while carrying a
      // different value in exactly the broken-join case this field exists to help diagnose.
      query_data_available: dataAvailable,
      data_available: usableData,
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
      data_available: usableData,
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
