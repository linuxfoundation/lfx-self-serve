// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeEngagementResponse, CommitteeEngagementWarehouseRow, CommitteeEngagementWindow, CommitteeMember } from '@lfx-one/shared/interfaces';
import { classifyCommitteeEngagement, computeCommitteeEngagementRate } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

interface EngagementQueryResult {
  rows: CommitteeEngagementWarehouseRow[];
  /** `false` when the warehouse table doesn't exist yet — distinct from a real query returning zero rows. */
  dataAvailable: boolean;
}

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

  private async queryEngagementRows(req: Request, committeeUid: string, window: CommitteeEngagementWindow): Promise<EngagementQueryResult> {
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
      if (!SnowflakeService.isMissingObjectError(error)) throw error;
      logger.warning(req, 'get_committee_engagement', 'Engagement table not deployed yet; returning empty response', {
        committee_uid: committeeUid,
        window,
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
  private buildResponse(req: Request, committeeUid: string, members: CommitteeMember[], queryResult: EngagementQueryResult): CommitteeEngagementResponse {
    const { rows, dataAvailable } = queryResult;

    const rowsByEmail = new Map<string, CommitteeEngagementWarehouseRow>();
    for (const row of rows) {
      const email = this.normalizeEmail(row.MEMBER_EMAIL);
      if (email) rowsByEmail.set(email, row);
    }

    // Computed independently of the roster join below: a warehouse row with no roster match
    // (or an empty roster) must still surface the model's freshness timestamp.
    const computedAt = this.toIsoTimestamp(rows.find((row) => row.COMPUTED_AT)?.COMPUTED_AT ?? null);

    let totalAttended = 0;
    let totalInvited = 0;
    let activeCount = 0;
    let atRiskCount = 0;
    let matchedCount = 0;

    const memberEngagements = members.map((member) => {
      const row = rowsByEmail.get(this.normalizeEmail(member.email));
      if (row) matchedCount++;
      const attended = this.toCount(row?.ATTENDED_COUNT);
      const invited = this.toCount(row?.INVITED_COUNT);
      totalAttended += attended;
      totalInvited += invited;

      const classification = classifyCommitteeEngagement(attended, invited);
      if (classification === 'High' || classification === 'Medium') activeCount++;
      // A member invited but who attended nothing is at risk even though the per-member badge
      // reads 'Inactive' (same tier as "never invited", which has no signal to act on).
      if (classification === 'Low' || (classification === 'Inactive' && invited > 0)) atRiskCount++;

      return { uid: member.uid, attended, invited, rate: computeCommitteeEngagementRate(attended, invited), classification };
    });

    if (rows.length > 0 && matchedCount === 0) {
      logger.warning(req, 'get_committee_engagement', 'Engagement rows returned but none matched the committee roster by email — join key mismatch?', {
        committee_uid: committeeUid,
        row_count: rows.length,
        roster_size: members.length,
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
