// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgCodeMeasure,
  OrgCodeMeasureOption,
  OrgCodeMetric,
  OrgCodeMetricOption,
  OrgCommitFilters,
  OrgCommitScopeOption,
  OrgProjectScopeOption,
  OrgCountUnit,
} from '../interfaces';

/**
 * Project-type dropdown options, default first (lfx-self-serve#4322, #4160, #4559). Also the BFF's allow-list for
 * `projectScope`. LF projects is the default, so every Org Lens view counts the same projects as the Overview; LF and
 * non-LF projects is what LFX Insights counts, the option to pick when comparing with it.
 */
export const ORG_PROJECT_SCOPE_OPTIONS: readonly OrgProjectScopeOption[] = [
  { label: 'LF projects', value: 'lf' },
  { label: 'LF and non-LF projects', value: 'all' },
  { label: 'Non-LF projects', value: 'non_lf' },
] as const;

/** Accessible name of the project-type dropdown on Code Contributions, People → Contributors and People → All Employees (lfx-self-serve#4559). */
export const ORG_PROJECT_SCOPE_LABEL = 'Project type';

/** Empty choice of the Foundation dropdown on Code Contributions and the People tabs. */
export const ORG_ALL_FOUNDATIONS_LABEL = 'All Foundations';

/** Empty choice of the Project filter on Code Contributions and People → Contributors (lfx-self-serve#4559). */
export const ORG_ANY_PROJECT_LABEL = 'Any project';

/** The BFF's allow-list for `commitScope`, default first. The UI picks it through {@link ORG_CODE_MEASURE_OPTIONS}. */
export const ORG_COMMIT_SCOPE_OPTIONS: readonly OrgCommitScopeOption[] = [
  { label: 'All commits', value: 'all' },
  { label: 'Merged to main branch', value: 'merged' },
] as const;

/** The BFF's allow-list for `metric`, default first. The UI picks it through {@link ORG_CODE_MEASURE_OPTIONS}. */
export const ORG_CODE_METRIC_OPTIONS: readonly OrgCodeMetricOption[] = [
  { label: 'All code contributions', value: 'code' },
  { label: 'Commits', value: 'commits' },
] as const;

/**
 * Filter defaults: LF projects (lfx-self-serve#4160) and all code contributions (lfx-self-serve#4559). The URL drops a
 * param while it holds its default, so `?projectScope=all` (what LFX Insights counts) and `?metric=commits` are written,
 * and a link without them opens LF projects and code contributions.
 */
export const DEFAULT_ORG_COMMIT_FILTERS: Readonly<OrgCommitFilters> = { projectScope: 'lf', commitScope: 'all', metric: 'code' };

/**
 * Filters the unranged people roster (assignment pickers, Org Lens Access, Key Contacts) is computed with: every
 * project, so it never follows the page default scope.
 */
export const ORG_UNRANGED_ROSTER_FILTERS: Readonly<OrgCommitFilters> = { ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'all' };

/** The one code-count dropdown on Code Contributions, People → Contributors and People → All Employees, default first. */
export const ORG_CODE_MEASURE_OPTIONS: readonly OrgCodeMeasureOption[] = [
  { label: 'All code contributions', value: 'code' },
  { label: 'All commits', value: 'commits' },
  { label: 'Only main branch commits', value: 'merged' },
] as const;

/** The code-count option the filter defaults show. The URL drops `metric` while it holds this. */
export const DEFAULT_ORG_CODE_MEASURE: OrgCodeMeasure = 'code';

/** The BFF `commitScope` + `metric` each code-count option sends. */
export const ORG_CODE_MEASURE_FILTERS: Readonly<Record<OrgCodeMeasure, Pick<OrgCommitFilters, 'commitScope' | 'metric'>>> = {
  commits: { commitScope: 'all', metric: 'commits' },
  merged: { commitScope: 'merged', metric: 'commits' },
  code: { commitScope: 'all', metric: 'code' },
};

/** Column / KPI label per metric. */
export const ORG_CODE_METRIC_LABEL: Readonly<Record<OrgCodeMetric, string>> = {
  commits: 'Commits',
  code: 'Code contributions',
};

/** Count unit per metric, for "N commits" / "N contributions" badges. */
export const ORG_CODE_METRIC_UNIT: Readonly<Record<OrgCodeMetric, OrgCountUnit>> = {
  commits: { one: 'commit', other: 'commits' },
  code: { one: 'contribution', other: 'contributions' },
};

/** All Employees code tile label: people with any code contribution, whichever code-count option is picked (lfx-self-serve#4160). */
export const ORG_ALL_EMPLOYEE_CODE_STAT_LABEL = 'Code Contributors';

/** Note on the All Employees code tile while only current employees are shown (lfx-self-serve#4160). */
export const ORG_ALL_EMPLOYEE_CURRENT_ONLY_CODE_NOTE =
  'Counts current employees only, unlike People → Contributors and Code Contributions. Set the employment filter to "All" to include people who have since left.';

/** Overview "Active Contributors" card: who it counts and over what window (lfx-self-serve#4160). */
export const ORG_OVERVIEW_ACTIVE_CONTRIBUTORS_DEFINITION =
  'People with at least one code contribution (commit, pull request, review or comment) in LF projects over the last 12 months, ' +
  'credited to the employer they had at the time, so people who have since left are included. Bots excluded.';

/** The one commit definition, shown as the tooltip wherever Org Lens shows an all-branch commit count. */
export const ORG_COMMITS_DEFINITION =
  'Commits the person authored, on any branch (including pull-request commits not yet merged), counted once each. Bots excluded.';

/** Tooltip for the "Only main branch commits" option. */
export const ORG_MAIN_BRANCH_COMMITS_DEFINITION = 'Commits the person authored that landed on the main branch, counted once each. Bots excluded.';

/** Tooltip for the "All code contributions" option. */
export const ORG_CODE_CONTRIBUTIONS_DEFINITION = 'Commits, pull requests, reviews and comments, counted as activities. Bots excluded.';

/** Tooltip per code-count option, next to every column, tile and KPI that shows the count it picks. */
export const ORG_CODE_MEASURE_DEFINITION: Readonly<Record<OrgCodeMeasure, string>> = {
  commits: ORG_COMMITS_DEFINITION,
  merged: ORG_MAIN_BRANCH_COMMITS_DEFINITION,
  code: ORG_CODE_CONTRIBUTIONS_DEFINITION,
};
