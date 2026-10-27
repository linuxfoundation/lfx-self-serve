// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_COMMIT_FILTERS,
  ORG_CODE_METRIC_OPTIONS,
  ORG_COMMIT_SCOPE_OPTIONS,
  ORG_PROJECT_SCOPE_OPTIONS,
} from '../constants/org-commit-filters.constants';
import type { OrgCodeMetric, OrgCommitFilters, OrgCommitScope, OrgProjectScope } from '../interfaces';

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

/** Lenient read of the three URL params: a missing or unknown value is the default. */
export function readOrgCommitFilters(get: (name: keyof OrgCommitFilters) => string | null | undefined): OrgCommitFilters {
  return {
    projectScope: parseOrgProjectScope(get('projectScope')) ?? DEFAULT_ORG_COMMIT_FILTERS.projectScope,
    commitScope: parseOrgCommitScope(get('commitScope')) ?? DEFAULT_ORG_COMMIT_FILTERS.commitScope,
    metric: parseOrgCodeMetric(get('metric')) ?? DEFAULT_ORG_COMMIT_FILTERS.metric,
  };
}

/** URL query params for the filters, `null` (dropped under `queryParamsHandling: 'merge'`) for a default. */
export function orgCommitFiltersUrlParams(filters: OrgCommitFilters): Record<keyof OrgCommitFilters, string | null> {
  return {
    projectScope: filters.projectScope === DEFAULT_ORG_COMMIT_FILTERS.projectScope ? null : filters.projectScope,
    commitScope: filters.commitScope === DEFAULT_ORG_COMMIT_FILTERS.commitScope ? null : filters.commitScope,
    metric: filters.metric === DEFAULT_ORG_COMMIT_FILTERS.metric ? null : filters.metric,
  };
}

/** Cache-key segment for the filters, `{projectScope}:{commitScope}:{metric}` — every value is a fixed token. */
export function orgCommitFiltersKey(filters: OrgCommitFilters): string {
  return `${filters.projectScope}:${filters.commitScope}:${filters.metric}`;
}

/** Equality on the three filters (for `distinctUntilChanged`). */
export function sameOrgCommitFilters(a: OrgCommitFilters, b: OrgCommitFilters): boolean {
  return a.projectScope === b.projectScope && a.commitScope === b.commitScope && a.metric === b.metric;
}
