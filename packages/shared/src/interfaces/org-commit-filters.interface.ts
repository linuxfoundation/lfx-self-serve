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

/** The three filters together — URL params `projectScope`, `commitScope`, `metric`, and the BFF query params of the same names. */
export interface OrgCommitFilters {
  projectScope: OrgProjectScope;
  commitScope: OrgCommitScope;
  metric: OrgCodeMetric;
}

/** Dropdown option for {@link OrgProjectScope} (typed value). */
export interface OrgProjectScopeOption {
  label: string;
  value: OrgProjectScope;
}

/** Dropdown option for {@link OrgCommitScope} (typed value). */
export interface OrgCommitScopeOption {
  label: string;
  value: OrgCommitScope;
}

/** Dropdown option for {@link OrgCodeMetric} (typed value). */
export interface OrgCodeMetricOption {
  label: string;
  value: OrgCodeMetric;
}

/** Singular/plural noun for a count badge ("1 commit", "3 commits"). */
export interface OrgCountUnit {
  one: string;
  other: string;
}
