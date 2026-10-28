// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { OrgEmploymentFilter, OrgLensTimeRange, OrgPersonEmploymentRow, OrgProjectScope } from '@lfx-one/shared/interfaces';

import type { SnowflakeService } from '../services/snowflake.service';
import { withOrgCache } from '../services/valkey.service';

/**
 * Person keys a People tab's Employment pick keeps (lfx-self-serve#4627), or `null` for `all`, which reads nothing.
 * Each person is classified by their ORG_PEOPLE_ALL_RANGES row for the range and project scope — the All Employees
 * roster, so every tab agrees on who is current and who left: `IS_FORMER = FALSE` is current, `TRUE` is former, and
 * someone with no row is neither, listed only under `all`. The classification is cached once per (range, scope) and
 * shared by every tab and pick.
 */
export async function readOrgEmploymentPersonKeys(
  snowflakeService: SnowflakeService,
  accountId: string,
  range: OrgLensTimeRange,
  projectScope: OrgProjectScope,
  employment: OrgEmploymentFilter
): Promise<ReadonlySet<string> | null> {
  if (employment === 'all') {
    return null;
  }
  const rows = await withOrgCache(
    accountId,
    `people-employment:v1:${range}:${projectScope}`,
    VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
    async () => {
      const query = `
        SELECT DISTINCT PERSON_KEY, IFF(IS_FORMER, 'former', 'current') AS EMPLOYMENT
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
        WHERE ACCOUNT_ID = ? AND TIME_RANGE = ? AND PROJECT_SCOPE = ?
      `;
      return (await snowflakeService.execute<OrgPersonEmploymentRow>(query, [accountId, range, projectScope])).rows;
    },
    isEmploymentRows
  );
  return new Set(rows.filter((row) => row.EMPLOYMENT === employment).map((row) => row.PERSON_KEY));
}

/**
 * Lowercased LF usernames of the account's former employees (the widest former population: `TIME_RANGE = 'all'`,
 * `PROJECT_SCOPE = 'all'`), cached per account. A warehouse error rejects, so callers decide how to degrade.
 */
export async function readOrgFormerUsernames(snowflakeService: SnowflakeService, accountId: string): Promise<string[]> {
  return withOrgCache(
    accountId,
    'people-former-usernames:v1',
    VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
    async () => {
      const query = `
        SELECT DISTINCT LOWER(TRIM(LF_USERNAME)) AS LF_USERNAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
        WHERE ACCOUNT_ID = ? AND TIME_RANGE = 'all' AND PROJECT_SCOPE = 'all' AND IS_FORMER = TRUE
          AND NULLIF(TRIM(LF_USERNAME), '') IS NOT NULL
      `;
      return (await snowflakeService.execute<{ LF_USERNAME: string }>(query, [accountId])).rows.map((row) => row.LF_USERNAME);
    },
    (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/** A stored classification is an array of person-key rows classified current or former; anything else is a miss. */
function isEmploymentRows(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (row: Partial<OrgPersonEmploymentRow> | null) => typeof row?.PERSON_KEY === 'string' && (row.EMPLOYMENT === 'current' || row.EMPLOYMENT === 'former')
    )
  );
}
