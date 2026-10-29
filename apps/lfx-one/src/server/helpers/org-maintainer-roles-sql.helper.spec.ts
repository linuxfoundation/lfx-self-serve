// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

// The utils barrel pulls Angular into this plain-Node run; the real range helpers are what run here.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
}));
import { orgMaintainerRoleOverlap } from './org-maintainer-roles-sql.helper';

describe('orgMaintainerRoleOverlap', () => {
  it('counts a role that has started and has not ended before the range starts, binding the range length', () => {
    expect(orgMaintainerRoleOverlap('730d')).toEqual({
      sql: 'ROLE_START_DATE <= CURRENT_DATE() AND (ROLE_END_DATE IS NULL OR ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE()))',
      binds: [730],
    });
  });

  it.each([
    ['30d', 30],
    ['90d', 90],
    ['365d', 365],
  ] as const)('binds %s as %i days', (range, days) => {
    expect(orgMaintainerRoleOverlap(range).binds).toEqual([days]);
  });

  it('keeps every started role for all time, with nothing to bind', () => {
    expect(orgMaintainerRoleOverlap('all')).toEqual({ sql: 'ROLE_START_DATE <= CURRENT_DATE()', binds: [] });
  });

  it('qualifies the columns with an alias', () => {
    const { sql } = orgMaintainerRoleOverlap('365d', 'r');
    expect(sql).toBe('r.ROLE_START_DATE <= CURRENT_DATE() AND (r.ROLE_END_DATE IS NULL OR r.ROLE_END_DATE >= DATEADD(day, 0 - ?, CURRENT_DATE()))');
  });

  it('throws for a range outside the allow-list instead of building SQL', () => {
    expect(() => orgMaintainerRoleOverlap('12mo' as OrgLensTimeRange)).toThrow('Unknown bounded Org Lens time range: 12mo');
  });
});
