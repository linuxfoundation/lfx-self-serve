// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { OrgLensOrgScope, OrgScopeFilter } from '@lfx-one/shared/interfaces';
import { effectiveOrgScope } from '@lfx-one/shared/utils';

import type { SnowflakeService } from '../services/snowflake.service';
import { withOrgCache } from '../services/valkey.service';

/** Raw `ORG_LENS_ORG_SCOPE` row — one per account (lfx-self-serve-ops#1219). */
interface OrgLensOrgScopeRow {
  INSIGHTS_ORG_ID: string | null;
  INSIGHTS_ORG_NAME: string | null;
  RELATED_ORG_COUNT: number | null;
  HAS_INSIGHTS_ORG: boolean | null;
}

/**
 * The account's organization scope: its LFX Insights organization (the page org, with lf-dbt's override seed) and how
 * many organizations have code activity on it. An account with no row offers only All related organizations. Cached
 * once per account: it does not depend on the range or any filter.
 */
export async function readOrgLensOrgScope(snowflakeService: SnowflakeService, accountId: string): Promise<OrgLensOrgScope> {
  return withOrgCache<OrgLensOrgScope>(
    accountId,
    'org-scope:v1',
    VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
    async () => {
      const query = `
        SELECT INSIGHTS_ORG_ID, INSIGHTS_ORG_NAME, RELATED_ORG_COUNT, HAS_INSIGHTS_ORG
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_ORG_SCOPE
        WHERE ACCOUNT_ID = ?
        LIMIT 1
      `;
      const row = (await snowflakeService.execute<OrgLensOrgScopeRow>(query, [accountId])).rows[0];
      return {
        accountId,
        hasInsightsOrg: row?.HAS_INSIGHTS_ORG === true && !!row.INSIGHTS_ORG_ID,
        insightsOrgId: row?.INSIGHTS_ORG_ID ?? null,
        insightsOrgName: row?.INSIGHTS_ORG_NAME ?? null,
        relatedOrgCount: Number(row?.RELATED_ORG_COUNT ?? 0),
      };
    },
    isOrgLensOrgScope
  );
}

/**
 * The scope a read serves for the `orgScope` pick: `all` as asked, and `insights` only for an account with an Insights
 * organization — otherwise `all`, the only option such an account offers. Callers key their cache on the result.
 */
export async function resolveOrgScope(snowflakeService: SnowflakeService, accountId: string, scope: OrgScopeFilter): Promise<OrgScopeFilter> {
  if (scope === 'all') return 'all';
  return effectiveOrgScope(scope, await readOrgLensOrgScope(snowflakeService, accountId));
}

/**
 * The column a count reads under the scope (lfx-self-serve-ops#1219): the model's all-organizations column under `all`,
 * exactly as before, and its `insights_` twin under `insights` (`INSIGHTS_` for an upper-case column, so the SQL, logs
 * and missing-column matching read one case) — lf-dbt adds the Insights-scoped counts as parallel
 * columns on the same rows, recomputed over the Insights organization's activity in repositories LFX Insights counts.
 */
export function orgScopeColumn(scope: OrgScopeFilter, column: string): string {
  if (scope !== 'insights') return column;
  return column === column.toUpperCase() ? `INSIGHTS_${column}` : `insights_${column}`;
}

/**
 * The SQL predicate keeping only rows with Insights-scoped activity under `insights` (empty under `all`): an
 * Insights-scoped count `column` above zero, so a row that exists only for other organizations' code drops out.
 */
export function orgScopeRowPredicate(scope: OrgScopeFilter, column: string): string {
  return scope === 'insights' ? `AND ${column} > 0` : '';
}

/** For row-grain models (one row per commit or activity): `is_insights_scope` keeps the Insights-scoped rows under `insights`. */
export function orgScopeFlagPredicate(scope: OrgScopeFilter, column = 'is_insights_scope'): string {
  return scope === 'insights' ? `AND COALESCE(${column}, FALSE)` : '';
}

function isOrgLensOrgScope(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Partial<OrgLensOrgScope>;
  return typeof scope.accountId === 'string' && typeof scope.hasInsightsOrg === 'boolean' && typeof scope.relatedOrgCount === 'number';
}
