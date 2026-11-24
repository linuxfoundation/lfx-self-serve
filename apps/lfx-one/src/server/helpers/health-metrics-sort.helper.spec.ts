// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_SORT_TRIM_CODE_POINTS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { buildHealthMetricsSortOrderBy, healthMetricsTierRankSql } from './health-metrics-sort.helper';

import type { HealthMetricsSqlSortColumn } from '@lfx-one/shared/interfaces';

const COLUMNS: Record<'company' | 'registrations' | 'tier', HealthMetricsSqlSortColumn> = {
  company: { expression: 'account_name', kind: 'text' },
  registrations: { expression: 'registrations_ytd', kind: 'number' },
  tier: { expression: 'membership_tier', kind: 'tier' },
};
const DEFAULT_ORDER = 'sort_rank_ytd ASC, account_id';
const TRIM_CHARACTERS = HEALTH_METRICS_SORT_TRIM_CODE_POINTS.map((code) => `\\u${code.toString(16).padStart(4, '0')}`).join('');

describe('buildHealthMetricsSortOrderBy', () => {
  it('keeps the default order with no sort', () => {
    expect(buildHealthMetricsSortOrderBy(null, COLUMNS, DEFAULT_ORDER)).toBe(DEFAULT_ORDER);
  });

  it('leads with the sorted column, empty values last either way, then the default order', () => {
    expect(buildHealthMetricsSortOrderBy({ key: 'registrations', direction: 'desc' }, COLUMNS, DEFAULT_ORDER)).toBe(
      `registrations_ytd DESC NULLS LAST, ${DEFAULT_ORDER}`
    );
    expect(buildHealthMetricsSortOrderBy({ key: 'company', direction: 'asc' }, COLUMNS, DEFAULT_ORDER)).toBe(
      `COLLATE(NULLIF(NULLIF(TRIM(account_name, '${TRIM_CHARACTERS}'), ''), '—'), 'en-ci-ai') ASC NULLS LAST, ${DEFAULT_ORDER}`
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
    const trimmed = `TRIM(t.tier, '${TRIM_CHARACTERS}')`;
    const name = `REGEXP_REPLACE(LOWER(${trimmed}), '[^a-z]', '')`;

    expect(sql.startsWith(`CASE WHEN ${trimmed} IS NULL OR ${trimmed} IN ('', '—') THEN NULL `)).toBe(true);
    expect(sql).toContain(`WHEN ${name} IN ('diamond', 'diamondmembership', 'diamondmember') THEN 7`);
    expect(sql).toContain(`WHEN ${name} IN ('endusersupporter', 'endusersupportermembership', 'endusersupportermember') THEN 2`);
    expect(sql).toContain(`WHEN ${name} IN ('nonmember') THEN 0`);
    expect(sql.endsWith('ELSE 1 END')).toBe(true);
  });
});

describe('the SQL trim set', () => {
  it("covers every character JavaScript's trim() removes, including the non-breaking space, as ASCII escapes", () => {
    const sql = buildHealthMetricsSortOrderBy({ key: 'company', direction: 'asc' }, COLUMNS, DEFAULT_ORDER);

    expect(sql).toContain('\\u00a0');
    expect(sql).toContain('\\u3000');
    expect(/^[\x20-\x7e—]*$/.test(sql)).toBe(true);
    // The set is exactly what the client trims: every code point in it is whitespace there, and none is missing.
    expect(
      HEALTH_METRICS_SORT_TRIM_CODE_POINTS.map((code) => String.fromCodePoint(code))
        .join('')
        .trim()
    ).toBe('');
    const trimmedByClient = Array.from({ length: 0x10000 }, (_, code) => code).filter((code) => String.fromCharCode(code).trim() === '');
    expect(trimmedByClient).toEqual([...HEALTH_METRICS_SORT_TRIM_CODE_POINTS].sort((a, b) => a - b));
    expect('\u00a0—\u00a0'.trim()).toBe('—');
  });
});
