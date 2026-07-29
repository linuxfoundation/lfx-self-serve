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
    try {
      const result = await this.snowflakeService.execute<CommitteeEngagementWarehouseRow>(sql, [committeeUid, window], { expectMissingObject: true });
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
    let clampedCount = 0;

    const memberEngagements = members.map((member) => {
      const row = rowsByEmail.get(this.normalizeEmail(member.email));
      if (row) matchedCount++;
      const invited = this.toCount(row?.INVITED_COUNT);
      const rawAttended = this.toCount(row?.ATTENDED_COUNT);
      // Clamped to `invited`: nothing upstream guarantees ATTENDED_COUNT <= INVITED_COUNT, and an
      // unclamped value here would produce a >100% rate and a response where `attended` exceeds
      // `invited` for the same member. Counted below and logged once per request (not per member)
      // since this signals a data-quality problem worth surfacing, not a one-off.
      const attended = Math.min(rawAttended, invited);
      if (attended < rawAttended) clampedCount++;
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

    if (clampedCount > 0) {
      logger.warning(req, 'get_committee_engagement', 'Warehouse rows had ATTENDED_COUNT greater than INVITED_COUNT; clamped to invited', {
        committee_uid: committeeUid,
        clamped_count: clampedCount,
        row_count: rows.length,
      });
    }

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

  private toIsoTimestamp(value: string | Date | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  /** Placeholder table/column names — real names TBD once the dbt model (owned separately) lands. */
  private engagementTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.COMMITTEE_MEMBER_MEETING_ATTENDANCE`;
  }
}
