// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgCodeMetric, OrgCodeMetricOption, OrgCommitFilters, OrgCommitScopeOption, OrgProjectScopeOption, OrgCountUnit } from '../interfaces';

/** Project-scope dropdown options, default first (lfx-self-serve#4322). Also the BFF's allow-list for `projectScope`. */
export const ORG_PROJECT_SCOPE_OPTIONS: readonly OrgProjectScopeOption[] = [
  { label: 'All projects', value: 'all' },
  { label: 'LF projects', value: 'lf' },
  { label: 'Non-LF projects', value: 'non_lf' },
] as const;

/** Commit-scope dropdown options, default first. Also the BFF's allow-list for `commitScope`. */
export const ORG_COMMIT_SCOPE_OPTIONS: readonly OrgCommitScopeOption[] = [
  { label: 'All commits', value: 'all' },
  { label: 'Merged to main branch', value: 'merged' },
] as const;

/** Metric dropdown options, default first. Also the BFF's allow-list for `metric`. */
export const ORG_CODE_METRIC_OPTIONS: readonly OrgCodeMetricOption[] = [
  { label: 'Commits', value: 'commits' },
  { label: 'All code contributions', value: 'code' },
] as const;

/** Filter defaults — they reproduce LFX Insights. The URL drops a param while it holds its default. */
export const DEFAULT_ORG_COMMIT_FILTERS: Readonly<OrgCommitFilters> = { projectScope: 'all', commitScope: 'all', metric: 'commits' };

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

/** All Employees code tile label per metric: people with at least one commit, or with any code contribution. */
export const ORG_ALL_EMPLOYEE_CODE_STAT_LABEL: Readonly<Record<OrgCodeMetric, string>> = {
  commits: 'Committers',
  code: 'Code Contributors',
};

/** The one commit definition, shown as the tooltip wherever Org Lens shows a commit count. */
export const ORG_COMMITS_DEFINITION =
  'Commits the person authored, on any branch (including pull-request commits not yet merged), counted once each. Bots excluded.';

/** Tooltip for the "All code contributions" metric. */
export const ORG_CODE_CONTRIBUTIONS_DEFINITION =
  'Every code contribution the person made: commits, pull requests, reviews and comments, each activity counted. Bots excluded.';
