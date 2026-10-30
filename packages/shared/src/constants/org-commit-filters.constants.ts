// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgAllEmployeeEmploymentFilter,
  OrgCodeMeasure,
  OrgCodeMeasureOption,
  OrgCodeMetric,
  OrgCodeMetricOption,
  OrgCommitFilters,
  OrgCommitScopeOption,
  OrgProjectScopeOption,
  OrgCountUnit,
} from '../interfaces';
import { ORG_LENS_DEFAULT_TIME_RANGE_LABEL } from './org-lens-time-range.constants';

/**
 * Project-type dropdown options, default first (lfx-self-serve#4322, #4160, #4559). Also the BFF's allow-list for
 * `projectScope`. LF and non-LF projects is the default (lfx-self-serve#4694): what LFX Insights counts, so every Org
 * Lens view opens on the same projects as Insights and the Overview.
 */
export const ORG_PROJECT_SCOPE_OPTIONS: readonly OrgProjectScopeOption[] = [
  { label: 'LF and non-LF projects', value: 'all' },
  { label: 'LF projects', value: 'lf' },
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
 * Filter defaults: LF and non-LF projects, as LFX Insights counts (lfx-self-serve#4694), and all code contributions
 * (lfx-self-serve#4559). The URL drops a param while it holds its default, so `?projectScope=lf` and `?metric=commits`
 * are written, and a link without them opens every project and code contributions.
 */
export const DEFAULT_ORG_COMMIT_FILTERS: Readonly<OrgCommitFilters> = { projectScope: 'all', commitScope: 'all', metric: 'code' };

/** Label of the default project scope, for copy that names it ("LF and non-LF projects"). */
export const ORG_DEFAULT_PROJECT_SCOPE_LABEL: string =
  ORG_PROJECT_SCOPE_OPTIONS.find((option) => option.value === DEFAULT_ORG_COMMIT_FILTERS.projectScope)?.label ?? '';

/** The Org Lens default view in words, for copy that names it: "LF and non-LF projects, past 2 years". */
export const ORG_LENS_DEFAULT_VIEW_PHRASE = `${ORG_DEFAULT_PROJECT_SCOPE_LABEL}, ${ORG_LENS_DEFAULT_TIME_RANGE_LABEL.toLowerCase()}`;

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

/**
 * Note on the All Employees code tile per employment view (lfx-self-serve#4160, #4730): under "Current employees" it
 * leaves out people who have left; under "All employees" it matches People → Contributors, people with code but no
 * employment record included; the Former view needs none.
 */
export const ORG_ALL_EMPLOYEE_CODE_NOTE = {
  current:
    'Counts current employees only, unlike People → Contributors and Code Contributions. Set the employment filter to "All employees" to include people who have since left.',
  former: null,
  all: 'Matches People → Contributors. Includes people with code credited to this company but no employment record, who are counted and listed only under "All employees", not under current or former employees.',
} as const satisfies Readonly<Record<OrgAllEmployeeEmploymentFilter, string | null>>;

/**
 * Overview "Active Contributors" card: who it counts and over what window (lfx-self-serve#4160). The headline is the
 * People → Contributors default tile (the Org Lens default view), so it says so in the same words as the Maintainer roles card.
 */
export const ORG_OVERVIEW_ACTIVE_CONTRIBUTORS_DEFINITION =
  `People with at least one code contribution (commit, pull request, review or comment) in ${ORG_DEFAULT_PROJECT_SCOPE_LABEL} ` +
  `over the ${ORG_LENS_DEFAULT_TIME_RANGE_LABEL.toLowerCase()}, credited to the employer they had at the time, so people who have since left are included. Bots and CDP team members excluded.`;

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
