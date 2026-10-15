// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ENGAGEMENT_TIERS, PRIORITIES } from '../constants/member-360.constants';
import type { Member360RankingFilters, Member360RankingRow } from '../interfaces/member-360.interface';

/** One ordering/filter policy for the ranking view and its exported workbook. */
export function rankMember360Rows(
  rows: readonly Member360RankingRow[],
  filters: Member360RankingFilters = { tier: '', owner: '', search: '' },
  key: keyof Member360RankingRow = 'engagement_score',
  direction: 'ascending' | 'descending' = 'descending'
): Member360RankingRow[] {
  return rows
    .filter(
      (row) =>
        (!filters.tier || row.engagement_tier === filters.tier) &&
        (!filters.owner || row.action_owner === filters.owner) &&
        row.member_organization.toLowerCase().includes(filters.search.toLowerCase())
    )
    .sort((a, b) => {
      const left = a[key];
      const right = b[key];
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      let result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
      if (key === 'priority') result = PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
      if (key === 'engagement_tier') result = ENGAGEMENT_TIERS.indexOf(a.engagement_tier) - ENGAGEMENT_TIERS.indexOf(b.engagement_tier);
      return direction === 'ascending' ? result : -result;
    });
}
