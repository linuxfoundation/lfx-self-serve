// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTrainingStatsQuery } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

// The helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; only the range utils are needed.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));

import { buildOrgTrainingPairsCte, ORG_TRAINING_PAIRS_TABLE, orgTrainingTabPredicate } from './org-training-pairs.sql';

const QUERY: OrgTrainingStatsQuery = { range: '730d', foundation: null, project: null, course: null, level: null, format: null };

describe('buildOrgTrainingPairsCte', () => {
  it('reads the warehouse-resolved pairs of the account, range and people list, and resolves nothing itself', () => {
    const { cte, binds } = buildOrgTrainingPairsCte('acct', QUERY);

    expect(cte).toContain(`FROM ${ORG_TRAINING_PAIRS_TABLE}`);
    expect(cte).toMatch(/WHERE ACCOUNT_ID = \?\s+AND TIME_RANGE = \?\s+AND IS_ON_PEOPLE_LIST/);
    expect(binds).toEqual(['acct', '730d']);
    for (const resolution of ['GROUP BY', 'BOOLOR_AGG', 'MAX(', 'MAX_BY(', 'TRIM(', 'DATEADD', 'PRODUCT_TYPE', 'ORG_PEOPLE_TRAINING ']) {
      expect(cte).not.toContain(resolution);
    }
  });

  it('binds every set filter on the modeled attribute, in a fixed order, never inlined', () => {
    const hostile = "x' OR 1=1 --";
    const { cte, binds } = buildOrgTrainingPairsCte('acct', { ...QUERY, foundation: 'f-1', course: hostile, format: 'E-Learning' });

    expect(cte).toContain('AND FOUNDATION_ID = ?');
    expect(cte).toContain('AND COURSE_NAME = ?');
    expect(cte).toContain('AND COURSE_FORMAT = ?');
    expect(cte).not.toContain('AND PROJECT_ID = ?');
    expect(cte).not.toContain(hostile);
    expect(binds).toEqual(['acct', '730d', 'f-1', hostile, 'E-Learning']);
  });
});

describe('orgTrainingTabPredicate', () => {
  it('splits the tabs on the modeled tab column, so stats and group totals classify a pair alike', () => {
    expect(orgTrainingTabPredicate('certifications')).toBe("TRAINING_TAB = 'certifications'");
    expect(orgTrainingTabPredicate('trainings')).toBe("TRAINING_TAB = 'trainings'");
  });
});
