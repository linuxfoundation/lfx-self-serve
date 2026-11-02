// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ContributorCountColumn, OrgCommitFilters, OrgLensTimeRange, OrgProjectScope } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils';

/**
 * The one window rule for ORG_PEOPLE_CONTRIBUTORS_DAILY reads — People -> Contributors and the Overview's Active
 * Contributors headline: activity on or after N days before today (today included); empty for `all`, the full history
 * the dbt model keeps. Inline, not bound — the day count comes from the allow-listed range — so the planner can fold it.
 */
export function orgContributorsActivityPredicate(range: OrgLensTimeRange): string {
  return range === 'all' ? '' : `AND activity_date >= DATEADD(day, -${orgLensTimeRangeDays(range)}, CURRENT_DATE())`;
}

/**
 * The ORG_PEOPLE_CONTRIBUTORS_DAILY commit-credit columns a project scope sums. A commit can be authored on an LF and a
 * non-LF project (a mirror): `daily_commits` credits it once across all projects, `daily_scope_commits` once within the
 * row's own scope, so a scoped read sums the scope columns and the per-scope count matches the Code page's distinct
 * commits for that scope.
 */
export function orgContributorsCommitColumns(projectScope: OrgProjectScope): { commits: string; mergedCommits: string } {
  return projectScope === 'all'
    ? { commits: 'daily_commits', mergedCommits: 'daily_merged_commits' }
    : { commits: 'daily_scope_commits', mergedCommits: 'daily_scope_merged_commits' };
}

/** The contributor row count the commit filters show: code contributions, else main-branch or all authored commits. */
export function orgContributorCountColumn(filters: OrgCommitFilters): ContributorCountColumn {
  if (filters.metric === 'code') {
    return 'CODE_ACTIVITIES';
  }
  return filters.commitScope === 'merged' ? 'MERGED_COMMITS' : 'COMMITS';
}
