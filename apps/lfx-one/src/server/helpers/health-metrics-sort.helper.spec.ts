// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildHealthMetricsSortOrderBy, healthMetricsTierRankSql } from './health-metrics-sort.helper';

import type { HealthMetricsSqlSortColumn } from '@lfx-one/shared/interfaces';

const COLUMNS: Record<'company' | 'registrations' | 'tier', HealthMetricsSqlSortColumn> = {
  company: { expression: 'account_name', kind: 'text' },
  registrations: { expression: 'registrations_ytd', kind: 'number' },
  tier: { expression: 'membership_tier', kind: 'tier' },
};
const DEFAULT_ORDER = 'sort_rank_ytd ASC, account_id';

describe('buildHealthMetricsSortOrderBy', () => {
  it('keeps the default order with no sort', () => {
    expect(buildHealthMetricsSortOrderBy(null, COLUMNS, DEFAULT_ORDER)).toBe(DEFAULT_ORDER);
  });

  it('leads with the sorted column, empty values last either way, then the default order', () => {
    expect(buildHealthMetricsSortOrderBy({ key: 'registrations', direction: 'desc' }, COLUMNS, DEFAULT_ORDER)).toBe(
      `registrations_ytd DESC NULLS LAST, ${DEFAULT_ORDER}`
    );
    expect(buildHealthMetricsSortOrderBy({ key: 'company', direction: 'asc' }, COLUMNS, DEFAULT_ORDER)).toBe(
      `COLLATE(NULLIF(NULLIF(TRIM(account_name, ' \\t\\n\\r'), ''), '—'), 'en-ci-ai') ASC NULLS LAST, ${DEFAULT_ORDER}`
    );
  });

  it('sorts a tier column by its rank', () => {
    expect(buildHealthMetricsSortOrderBy({ key: 'tier', direction: 'desc' }, COLUMNS, DEFAULT_ORDER)).toBe(
      `${healthMetricsTierRankSql('membership_tier')} DESC NULLS LAST, ${DEFAULT_ORDER}`
    );
  });

  it('falls back to the default for a key the table does not list, including inherited ones', () => {
    expect(buildHealthMetricsSortOrderBy({ key: 'toString' as 'company', direction: 'asc' }, COLUMNS, DEFAULT_ORDER)).toBe(DEFAULT_ORDER);
  });
});

describe('healthMetricsTierRankSql', () => {
  it('ranks the named tiers and their "Membership" forms as the client does, an unknown tier 1 and no tier NULL', () => {
    const sql = healthMetricsTierRankSql('t.tier');
    const trimmed = "TRIM(t.tier, ' \\t\\n\\r')";
    const name = `REGEXP_REPLACE(LOWER(${trimmed}), '[^a-z]', '')`;

    expect(sql.startsWith(`CASE WHEN ${trimmed} IS NULL OR ${trimmed} IN ('', '—') THEN NULL `)).toBe(true);
    expect(sql).toContain(`WHEN ${name} IN ('diamond', 'diamondmembership', 'diamondmember') THEN 7`);
    expect(sql).toContain(`WHEN ${name} IN ('endusersupporter', 'endusersupportermembership', 'endusersupportermember') THEN 2`);
    expect(sql).toContain(`WHEN ${name} IN ('nonmember') THEN 0`);
    expect(sql.endsWith('ELSE 1 END')).toBe(true);
  });
});
