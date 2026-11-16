// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ContributorCountColumn, OrgCommitFilters, OrgLensTimeRange, OrgProjectScope, OrgScopeFilter } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils';

import { orgScopeColumn, orgScopeRowPredicate } from './org-scope.helper';

/**
 * The one window rule for ORG_PEOPLE_CONTRIBUTORS_DAILY reads — People -> Contributors and the Overview's Active
 * Contributors headline: activity on or after N days before today (today included); empty for `all`, the full history
 * the dbt model keeps. Inline, not bound — the day count comes from the allow-listed range — so the planner can fold it.
 */
export function orgContributorsActivityPredicate(range: OrgLensTimeRange): string {
  return range === 'all' ? '' : `AND activity_date >= DATEADD(day, -${orgLensTimeRangeDays(range)}, CURRENT_DATE())`;
}

/**
 * The ORG_PEOPLE_CONTRIBUTORS_DAILY count columns a project scope and organization scope sum. A commit can be authored
 * on an LF and a non-LF project (a mirror): `daily_commits` credits it once across all projects, `daily_scope_commits`
 * once within the row's own scope, so a scoped read sums the scope columns and the per-scope count matches the Code
 * page's distinct commits for that scope. Under `insights` each is its `insights_` twin (lfx-self-serve-ops#1219).
 */
export function orgContributorsCommitColumns(
  projectScope: OrgProjectScope,
  orgScope: OrgScopeFilter = 'all'
): { commits: string; mergedCommits: string; codeActivities: string } {
  const columns =
    projectScope === 'all'
      ? { commits: 'daily_commits', mergedCommits: 'daily_merged_commits' }
      : { commits: 'daily_scope_commits', mergedCommits: 'daily_scope_merged_commits' };
  return {
    commits: orgScopeColumn(orgScope, columns.commits),
    mergedCommits: orgScopeColumn(orgScope, columns.mergedCommits),
    codeActivities: orgScopeColumn(orgScope, 'daily_code_activities'),
  };
}

/** Under `insights`, keeps only ORG_PEOPLE_CONTRIBUTORS_DAILY rows with Insights-scoped code (the model's insights gate); empty under `all`. */
export function orgContributorsScopePredicate(orgScope: OrgScopeFilter): string {
  return orgScopeRowPredicate(orgScope, 'insights_daily_code_activities');
}

/** The contributor row count the commit filters show: code contributions, else main-branch or all authored commits. */
export function orgContributorCountColumn(filters: OrgCommitFilters): ContributorCountColumn {
  if (filters.metric === 'code') {
    return 'CODE_ACTIVITIES';
  }
  return filters.commitScope === 'merged' ? 'MERGED_COMMITS' : 'COMMITS';
}
