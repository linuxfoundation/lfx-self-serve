// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CommitteeEngagementQueryResult,
  CommitteeEngagementResponse,
  CommitteeEngagementWarehouseRow,
  CommitteeEngagementWindow,
  CommitteeMember,
} from '@lfx-one/shared/interfaces';
import { classifyCommitteeEngagement, computeCommitteeEngagementRate, isCommitteeMemberAtRisk } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Reads the per-committee-member meeting-attendance rollup (LFXV2-1705) from the (not-yet-deployed)
 * committee-engagement warehouse model and joins it against the committee roster. Table/column
 * names are a placeholder pending the real dbt model.
 */
export class CommitteeEngagementService {
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly committeeService = new CommitteeService();

  /**
   * Two independent reads run in parallel — one query-service call for the roster, one Snowflake
   * call for engagement rows — and are joined in memory. No per-member Snowflake call, so this
   * stays N+1-free regardless of committee size.
   */
  public async getCommitteeEngagement(req: Request, committeeUid: string, window: CommitteeEngagementWindow): Promise<CommitteeEngagementResponse> {
    const [members, queryResult] = await Promise.all([
      this.committeeService.getCommitteeMembers(req, committeeUid),
      this.queryEngagementRows(req, committeeUid, window),
    ]);

    return this.buildResponse(req, committeeUid, members, queryResult);
  }

  private async queryEngagementRows(req: Request, committeeUid: string, window: CommitteeEngagementWindow): Promise<CommitteeEngagementQueryResult> {
    const sql = `
      SELECT MEMBER_EMAIL, ATTENDED_COUNT, INVITED_COUNT, COMPUTED_AT
      FROM ${this.engagementTable()}
      WHERE COMMITTEE_UID = ? AND TIME_RANGE_TYPE = ?
      ORDER BY MEMBER_EMAIL
    `;
    logger.debug(req, 'get_committee_engagement', 'Querying engagement rows', { committee_uid: committeeUid, window });
    try {
      const result = await this.snowflakeService.execute<CommitteeEngagementWarehouseRow>(sql, [committeeUid, window], { expectMissingObject: true });
      logger.debug(req, 'get_committee_engagement', 'Fetched engagement rows', { committee_uid: committeeUid, window, row_count: result.rows.length });
      return { rows: result.rows, dataAvailable: true };
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
      return { rows: [], dataAvailable: false };
    }
  }

  /**
   * Joins on email (`CommitteeMember.email` is required per `member.interface.ts`) since no shared
   * identifier between query-service and the warehouse is confirmed yet — an assumption to revisit
   * once the real dbt model's schema is known. Every roster member appears in the response even
   * without a matching warehouse row, so `total_count` always reflects the full committee.
   */
  private buildResponse(
    req: Request,
    committeeUid: string,
    members: CommitteeMember[],
    queryResult: CommitteeEngagementQueryResult
  ): CommitteeEngagementResponse {
    const { rows, dataAvailable } = queryResult;

    const rowsByEmail = new Map<string, CommitteeEngagementWarehouseRow>();
    for (const row of rows) {
      const email = this.normalizeEmail(row.MEMBER_EMAIL);
      if (email) rowsByEmail.set(email, row);
    }

    // Named "over-attended", not "clamped": this counts every deduped row where ATTENDED_COUNT
    // exceeds INVITED_COUNT, including rows with no roster match — those are dropped entirely in
    // the map below, never actually clamped. Counted over rows, not roster members, so a grain
    // mismatch affecting only former-member rows (the normal case, not an edge case — see the
    // join-mismatch warning below) isn't invisible.
    const overAttendedRowCount = [...rowsByEmail.values()].filter((row) => this.toCount(row.ATTENDED_COUNT) > this.toCount(row.INVITED_COUNT)).length;

    // Computed independently of the roster join below (a warehouse row with no roster match, or
    // an empty roster, must still surface the model's freshness timestamp) and as the latest of
    // all parseable values, not the first in `ORDER BY MEMBER_EMAIL` order — a partial refresh
    // could otherwise report an arbitrarily stale alphabetically-first row as "as of".
    const computedAt = rows
      .map((row) => this.toIsoTimestamp(row.COMPUTED_AT))
      .filter((iso): iso is string => iso !== null)
      .reduce((latest: string | null, iso) => (!latest || iso > latest ? iso : latest), null);

    let totalAttended = 0;
    let totalInvited = 0;
    let activeCount = 0;
    let atRiskCount = 0;
    let matchedCount = 0;

    const memberEngagements = members.map((member) => {
      const row = rowsByEmail.get(this.normalizeEmail(member.email));
      if (row) matchedCount++;
      const invited = this.toCount(row?.INVITED_COUNT);
      // Clamped to `invited`: nothing upstream guarantees ATTENDED_COUNT <= INVITED_COUNT, and an
      // unclamped value here would produce a >100% rate and a response where `attended` exceeds
      // `invited` for the same member. Detection is logged once per request via
      // `overAttendedRowCount` above, not per member.
      const attended = Math.min(this.toCount(row?.ATTENDED_COUNT), invited);
      totalAttended += attended;
      totalInvited += invited;

      const classification = classifyCommitteeEngagement(attended, invited);
      if (classification === 'High' || classification === 'Medium') activeCount++;
      if (isCommitteeMemberAtRisk(attended, invited)) atRiskCount++;

      return { uid: member.uid, attended, invited, rate: computeCommitteeEngagementRate(attended, invited), classification };
    });

    if (rows.length > 0 && members.length > 0 && matchedCount === 0) {
      logger.warning(req, 'get_committee_engagement', 'Engagement rows returned but none matched the committee roster by email — join key mismatch?', {
        committee_uid: committeeUid,
        row_count: rows.length,
        roster_size: members.length,
      });
    }

    if (overAttendedRowCount > 0) {
      logger.warning(
        req,
        'get_committee_engagement',
        'Warehouse rows had ATTENDED_COUNT greater than INVITED_COUNT; clamped to invited where joined to the roster',
        {
          committee_uid: committeeUid,
          over_attended_row_count: overAttendedRowCount,
          // Deduped by email, like over_attended_row_count, so the two counts describe the same
          // population — the join-mismatch warning above intentionally uses the raw `rows.length`
          // instead, since it's asking a different question ("did anything match at all").
          deduped_row_count: rowsByEmail.size,
        }
      );
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
      computed_at: computedAt,
      data_available: dataAvailable,
    };
  }

  private normalizeEmail(email: string | null | undefined): string {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  private toCount(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  /**
   * `Date` instances convert via `toISOString()`. Strings are validated (rejecting garbage like
   * `'N/A'`) but never converted through `new Date(value).toISOString()` for the *returned* value —
   * a zone-less `TIMESTAMP_NTZ` string would parse as local time in V8 and silently shift by the
   * server's UTC offset, the same trap `OrgLensProjectsService.latestTimestamp` avoids by never
   * re-parsing string warehouse values. The validation `new Date(value)` call below is discarded
   * (only its validity is used), so it can't introduce that shift into what's returned.
   *
   * Warehouse timestamps are assumed UTC by construction (no per-committee timezone concept
   * exists), so a bare `YYYY-MM-DD HH:MM:SS[.sss]` with no zone designator is normalized to a real
   * `...Z` ISO string instead of shipping a value the response contract calls "ISO timestamp" but
   * that technically isn't one.
   */
  private toIsoTimestamp(value: string | Date | null | undefined): string | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value !== 'string' || value.length === 0 || Number.isNaN(new Date(value).getTime())) return null;
    const hasZoneDesignator = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value);
    return hasZoneDesignator ? value : `${value.replace(' ', 'T')}Z`;
  }

  /** Placeholder table/column names — real names TBD once the dbt model (owned separately) lands. */
  private engagementTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.COMMITTEE_MEMBER_MEETING_ATTENDANCE`;
  }
}
