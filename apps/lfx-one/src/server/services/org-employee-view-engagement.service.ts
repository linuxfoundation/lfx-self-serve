// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Epic #5845 — "most recent engagement" per company for one person, used once to choose between two present
 * employers (never to grant or revoke access on its own).
 *
 * Wired source today: code activity (`ORG_PEOPLE_CONTRIBUTORS_DAILY` joined to the roster's LF username in
 * `ORG_PEOPLE_ALL`). Events and meetings are NOT yet read here; a person whose only recent engagement is there ties at
 * "no data" and falls back to the most recent work-history start date. Fail-soft by design: an unavailable warehouse
 * yields no engagement, never a rejection, because the fallback is a defined rule rather than a guess.
 */
export class OrgEmployeeViewEngagementService {
  private readonly snowflake: SnowflakeService;

  public constructor(snowflake?: SnowflakeService) {
    this.snowflake = snowflake ?? SnowflakeService.getInstance();
  }

  /** Latest activity time (ms) per account id for the person; accounts with no activity are absent. */
  public async getLastActivityByAccount(req: Request, username: string, accountIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (accountIds.length === 0) return result;
    try {
      const placeholders = accountIds.map(() => '?').join(', ');
      const query = `
        SELECT c.account_id AS ACCOUNT_ID, MAX(c.activity_date) AS LAST_ACTIVITY
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY c
        JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL p
          ON p.ACCOUNT_ID = c.account_id AND p.PERSON_KEY = c.person_key
        WHERE LOWER(TRIM(p.LF_USERNAME)) = ? AND c.account_id IN (${placeholders})
        GROUP BY c.account_id
      `;
      const rows = await this.snowflake.execute<{ ACCOUNT_ID: string; LAST_ACTIVITY: Date | string | null }>(query, [username.toLowerCase(), ...accountIds]);
      for (const row of rows.rows) {
        const time = row.LAST_ACTIVITY ? new Date(row.LAST_ACTIVITY).getTime() : NaN;
        if (row.ACCOUNT_ID && Number.isFinite(time)) result.set(row.ACCOUNT_ID, time);
      }
    } catch (error) {
      logger.warning(req, 'employee_view_engagement', 'Engagement lookup failed; choosing the employer by start date', { err: error });
    }
    return result;
  }
}
