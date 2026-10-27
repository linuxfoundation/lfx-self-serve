// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Org Lens drill-down filters on the one commit definition every surface shares (lfx-self-serve#4164,
// #4322): a commit is a distinct SHA with an `authored-commit` activity, on any branch, by a non-bot
// member. The defaults reproduce LFX Insights; each filter narrows to a stricter view.

/** Projects a count covers: every project (Insights' default), LF projects (Insights' `is_lf_project`), or the rest. */
export type OrgProjectScope = 'all' | 'lf' | 'non_lf';

/** Commits that count: every authored commit on any branch, or only the ones merged to the main branch. */
export type OrgCommitScope = 'all' | 'merged';

/** What the code count measures: authored commits, or every code-contribution activity (commits, pull requests, reviews, comments). */
export type OrgCodeMetric = 'commits' | 'code';

/** The three filters together — the BFF query params `projectScope`, `commitScope`, `metric`. The UI picks `commitScope` and `metric` through one {@link OrgCodeMeasure}. */
export interface OrgCommitFilters {
  projectScope: OrgProjectScope;
  commitScope: OrgCommitScope;
  metric: OrgCodeMetric;
}

/** The one code-count dropdown every Org Lens surface shows (URL param `metric`): authored commits, commits merged to the main branch, or every code contribution. Each maps onto a `commitScope` + `metric` pair. */
export type OrgCodeMeasure = 'commits' | 'merged' | 'code';

/** The filters as the UI picks them — URL params `projectScope` and `metric` (an {@link OrgCodeMeasure}). */
export interface OrgCodeFilterValues {
  projectScope: OrgProjectScope;
  metric: OrgCodeMeasure;
}

/** Dropdown option for {@link OrgProjectScope} (typed value). */
export interface OrgProjectScopeOption {
  label: string;
  value: OrgProjectScope;
}

/** Allowed {@link OrgCommitScope} value (the BFF's allow-list; the UI picks it through {@link OrgCodeMeasureOption}). */
export interface OrgCommitScopeOption {
  label: string;
  value: OrgCommitScope;
}

/** Allowed {@link OrgCodeMetric} value (the BFF's allow-list; the UI picks it through {@link OrgCodeMeasureOption}). */
export interface OrgCodeMetricOption {
  label: string;
  value: OrgCodeMetric;
}

/** Dropdown option for {@link OrgCodeMeasure} (typed value). */
export interface OrgCodeMeasureOption {
  label: string;
  value: OrgCodeMeasure;
}

/** Singular/plural noun for a count badge ("1 commit", "3 commits"). */
export interface OrgCountUnit {
  one: string;
  other: string;
}
