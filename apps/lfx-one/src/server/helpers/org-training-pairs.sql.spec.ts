// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTrainingStatsQuery } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

// The helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; only the range utils are needed.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));

import { buildOrgTrainingPairsCte } from './org-training-pairs.sql';

const QUERY: OrgTrainingStatsQuery = { range: '730d', foundation: null, project: null, course: null, level: null, format: null };

describe('buildOrgTrainingPairsCte', () => {
  it('resolves every pair attribute from all its in-range rows, with the latest non-null format', () => {
    const { cte } = buildOrgTrainingPairsCte('acct', QUERY);

    expect(cte).toMatch(/MAX\(PRODUCT_TYPE\)\s+AS PRODUCT_TYPE/);
    expect(cte).toMatch(/MAX\(FOUNDATION_ID\)\s+AS FOUNDATION_ID/);
    expect(cte).toMatch(/MAX_BY\(FOUNDATION_NAME, FOUNDATION_ID\)\s+AS FOUNDATION_NAME/);
    expect(cte).toMatch(/MAX\(PROJECT_ID\)\s+AS PROJECT_ID/);
    expect(cte).toMatch(/MAX_BY\(PROJECT_NAME, PROJECT_ID\)\s+AS PROJECT_NAME/);
    expect(cte).toMatch(/MAX\(COURSE_NAME\)\s+AS COURSE_NAME/);
    expect(cte).toMatch(/MAX\(COURSE_LEVEL\)\s+AS COURSE_LEVEL/);
    expect(cte).toContain('MAX_BY(COURSE_FORMAT, IFF(COURSE_FORMAT IS NOT NULL, ACTIVITY_TS, NULL)) AS COURSE_FORMAT');
  });

  it('reads the course name, level and format space-trimmed, capped and blank as NULL, so a pair, its filter, group key and option are one string', () => {
    const { cte } = buildOrgTrainingPairsCte('acct', QUERY);

    const rowsInRange = cte.slice(cte.indexOf('rows_in_range AS'), cte.indexOf('pairs AS'));
    expect(rowsInRange).toMatch(/NULLIF\(TRIM\(LEFT\(TRIM\(COURSE_NAME\), 200\)\), ''\)\s+AS COURSE_NAME/);
    expect(rowsInRange).toMatch(/NULLIF\(TRIM\(LEFT\(TRIM\(COURSE_LEVEL\), 200\)\), ''\)\s+AS COURSE_LEVEL/);
    expect(rowsInRange).toMatch(/NULLIF\(TRIM\(LEFT\(TRIM\(COURSE_FORMAT\), 200\)\), ''\)\s+AS COURSE_FORMAT/);
    // The activity window still reads the raw timestamp, and no filter value is trimmed in SQL: it arrives trimmed.
    expect(rowsInRange).toContain('AND ACTIVITY_TS IS NOT NULL');
    expect(cte).not.toContain('TRIM(?)');
  });

  it('filters only after the pairs are resolved, never in the rows read', () => {
    const { cte, binds } = buildOrgTrainingPairsCte('acct', { ...QUERY, level: 'Beginner', format: 'E-Learning' });

    const rowsInRange = cte.slice(cte.indexOf('rows_in_range AS'), cte.indexOf('pairs AS'));
    const filtered = cte.slice(cte.indexOf('f AS'));
    expect(rowsInRange).not.toContain('COURSE_LEVEL = ?');
    expect(rowsInRange).not.toContain('COURSE_FORMAT = ?');
    expect(filtered).toContain('AND COURSE_LEVEL = ?');
    expect(filtered).toContain('AND COURSE_FORMAT = ?');
    expect(binds).toEqual(['acct', 'Beginner', 'E-Learning']);
  });
});
