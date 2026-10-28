// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { OrgEmploymentFilter, OrgLensTimeRange, OrgPersonEmploymentKeys, OrgPersonEmploymentRow, OrgProjectScope } from '@lfx-one/shared/interfaces';

import type { SnowflakeService } from '../services/snowflake.service';
import { withOrgCache } from '../services/valkey.service';

/**
 * Person keys a People tab's Employment pick keeps (lfx-self-serve#4627), or `null` for `all`, which reads nothing.
 * Each person is classified by their ORG_PEOPLE_ALL_RANGES row for the range and project scope — the All Employees
 * roster, so every tab agrees on who is current and who left: `IS_FORMER = FALSE` is current, `TRUE` is former, and
 * someone with no row is neither, listed only under `all`. The classification is cached once per (range, scope) and
 * shared by every tab and pick, as the person keys of each class (`v2`; `v1` stored one named-field row per person).
 * Measured 2026-10-28 against prod ANALYTICS.PLATINUM_LFX_ONE: the largest entry (all time, every project) is about
 * 0.48 MiB (17,526 people), under the 1 MiB default cap; the named-field `v1` rows exceeded it on that account.
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
  const keys = await withOrgCache(
    accountId,
    `people-employment:v2:${range}:${projectScope}`,
    VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
    async () => {
      const query = `
        SELECT DISTINCT PERSON_KEY, IFF(IS_FORMER, 'former', 'current') AS EMPLOYMENT
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
        WHERE ACCOUNT_ID = ? AND TIME_RANGE = ? AND PROJECT_SCOPE = ?
      `;
      const { rows } = await snowflakeService.execute<OrgPersonEmploymentRow>(query, [accountId, range, projectScope]);
      const classified: OrgPersonEmploymentKeys = { current: [], former: [] };
      for (const row of rows) classified[row.EMPLOYMENT].push(row.PERSON_KEY);
      return classified;
    },
    isEmploymentKeys
  );
  return new Set(keys[employment]);
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
    isStringList
  );
}

/** A stored classification holds both classes, each a list of person keys; anything else is a miss. */
function isEmploymentKeys(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'current' in value && 'former' in value && isStringList(value.current) && isStringList(value.former);
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
