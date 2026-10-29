// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_CODE_MEASURE,
  DEFAULT_ORG_COMMIT_FILTERS,
  ORG_CODE_MEASURE_FILTERS,
  ORG_CODE_MEASURE_OPTIONS,
  ORG_CODE_METRIC_OPTIONS,
  ORG_COMMIT_SCOPE_OPTIONS,
  ORG_PROJECT_SCOPE_OPTIONS,
} from '../constants/org-commit-filters.constants';
import type { OrgCodeFilterValues, OrgCodeMeasure, OrgCodeMetric, OrgCommitFilters, OrgCommitScope, OrgProjectScope } from '../interfaces';

type OrgCommitFilterParamReader = (name: keyof OrgCommitFilters) => string | null | undefined;

/** `projectScope` value → scope, or `null` when it is not one of the allowed values. */
export function parseOrgProjectScope(value: string | null | undefined): OrgProjectScope | null {
  return ORG_PROJECT_SCOPE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** `commitScope` value → scope, or `null` when it is not one of the allowed values. */
export function parseOrgCommitScope(value: string | null | undefined): OrgCommitScope | null {
  return ORG_COMMIT_SCOPE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** `metric` value → metric, or `null` when it is not one of the allowed values. */
export function parseOrgCodeMetric(value: string | null | undefined): OrgCodeMetric | null {
  return ORG_CODE_METRIC_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** URL `metric` value → code-count option, or `null` when it is not one of the allowed values. */
export function parseOrgCodeMeasure(value: string | null | undefined): OrgCodeMeasure | null {
  return ORG_CODE_MEASURE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** The BFF filters for the project scope and code-count option picked in the UI. */
export function orgCommitFiltersFor(values: OrgCodeFilterValues): OrgCommitFilters {
  return { projectScope: values.projectScope, ...ORG_CODE_MEASURE_FILTERS[values.metric] };
}

/** The UI's picks for a filter set: code contributions, merged commits, or commits. */
export function orgCodeFilterValues(filters: OrgCommitFilters): OrgCodeFilterValues {
  if (filters.metric === 'code') {
    return { projectScope: filters.projectScope, metric: 'code' };
  }
  if (filters.commitScope === 'merged') {
    return { projectScope: filters.projectScope, metric: 'merged' };
  }
  return { projectScope: filters.projectScope, metric: 'commits' };
}

/**
 * Lenient read of the URL params `projectScope` and `metric` (a code-count option): a missing or unknown value is the
 * default. A link from before the one code-count dropdown carries `commitScope=merged` with `metric=commits` or no
 * `metric` (commits was the default then); it reads as `metric=merged` unless it asked for code contributions.
 */
export function readOrgCommitFilters(get: OrgCommitFilterParamReader): OrgCommitFilters {
  const projectScope = parseOrgProjectScope(get('projectScope')) ?? DEFAULT_ORG_COMMIT_FILTERS.projectScope;
  const measure = parseOrgCodeMeasure(get('metric'));
  if (get('commitScope') === 'merged' && (measure === null || measure === 'commits')) {
    return orgCommitFiltersFor({ projectScope, metric: 'merged' });
  }
  return orgCommitFiltersFor({ projectScope, metric: measure ?? DEFAULT_ORG_CODE_MEASURE });
}

/**
 * URL query params for the filters — `projectScope` and the code-count option in `metric` — `null` (dropped under
 * `queryParamsHandling: 'merge'`) for a default. `commitScope` is always `null`, so a legacy link drops it once rewritten.
 */
export function orgCommitFiltersUrlParams(filters: OrgCommitFilters): Record<keyof OrgCommitFilters, string | null> {
  const { projectScope, metric } = orgCodeFilterValues(filters);
  return {
    projectScope: projectScope === DEFAULT_ORG_COMMIT_FILTERS.projectScope ? null : projectScope,
    commitScope: null,
    metric: metric === DEFAULT_ORG_CODE_MEASURE ? null : metric,
  };
}

/** Whether the URL already spells the filters canonically — no default, unknown or legacy `commitScope` value left to rewrite. */
export function orgCommitFiltersUrlMatches(filters: OrgCommitFilters, get: OrgCommitFilterParamReader): boolean {
  const params = orgCommitFiltersUrlParams(filters);
  return (Object.keys(params) as (keyof OrgCommitFilters)[]).every((name) => (get(name) ?? null) === params[name]);
}

/** Cache-key segment for the filters, `{projectScope}:{commitScope}:{metric}` — every value is a fixed token. */
export function orgCommitFiltersKey(filters: OrgCommitFilters): string {
  return `${filters.projectScope}:${filters.commitScope}:${filters.metric}`;
}

/** Equality on the three filters (for `distinctUntilChanged`). */
export function sameOrgCommitFilters(a: OrgCommitFilters, b: OrgCommitFilters): boolean {
  return a.projectScope === b.projectScope && a.commitScope === b.commitScope && a.metric === b.metric;
}
