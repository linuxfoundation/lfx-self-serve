// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  ContributionsMetricLabels,
  OrgCodeMetric,
  OrgContributionsKpis,
  OrgContributionsQuery,
  OrgContributionsResponse,
  OrgProjectScope,
} from '../interfaces';
import { DEFAULT_ORG_COMMIT_FILTERS, ORG_CODE_METRIC_LABEL } from './org-commit-filters.constants';
import { ORG_LENS_DEFAULT_TIME_RANGE } from './org-lens-time-range.constants';

// Org Lens → Code Contributions page (LFXV2-1894). Range set shared with the People tabs (org-lens-time-range.constants).

/** Default Repositories page size — Org Lens convention is 10 (open question pending; see ticket). */
export const CONTRIBUTIONS_DEFAULT_PAGE_SIZE = 10;

/** Page-size selector options on the Repositories pagination footer. */
export const CONTRIBUTIONS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50] as const;

/** Repositories-table headers per metric. */
export const CONTRIBUTIONS_METRIC_LABELS: Readonly<Record<OrgCodeMetric, ContributionsMetricLabels>> = {
  commits: { count: ORG_CODE_METRIC_LABEL.commits, firstDate: 'First Commit', lastDate: 'Last Commit' },
  code: { count: ORG_CODE_METRIC_LABEL.code, firstDate: 'First contribution', lastDate: 'Last contribution' },
};

/** Project-scope phrase in the KPI caption (empty for every project). */
export const CONTRIBUTIONS_PROJECT_SCOPE_PHRASE: Readonly<Record<OrgProjectScope, string>> = {
  all: '',
  lf: ' in LF projects',
  non_lf: ' outside LF projects',
};

/** Server-accepted page-size ceiling (clamps the `size` query param; not exposed in the table footer). */
export const CONTRIBUTIONS_MAX_PAGE_SIZE = 100;

/**
 * Most distinct values accepted per `projects` / `employees` filter.
 * @description Each value becomes Snowflake bind variables (three per project, one per employee), so the
 * server rejects a longer list with a 400 before building SQL, and the filter dropdowns stop selection here.
 */
export const CONTRIBUTIONS_MAX_FILTER_VALUES = 50;

/** Default empty filter/pagination state — Repositories tab, Commits desc, page 1, default commit filters. */
export const EMPTY_ORG_CONTRIBUTIONS_QUERY: OrgContributionsQuery = {
  ...DEFAULT_ORG_COMMIT_FILTERS,
  view: 'repositories',
  dateRange: ORG_LENS_DEFAULT_TIME_RANGE,
  search: '',
  projects: [],
  employees: [],
  sort: 'commits',
  dir: -1,
  commitSort: 'date',
  commitDir: -1,
  page: 1,
  size: CONTRIBUTIONS_DEFAULT_PAGE_SIZE,
};

/** Zero-valued KPI strip — fallback when the rollup query returns no rows. */
export const EMPTY_ORG_CONTRIBUTIONS_KPIS: OrgContributionsKpis = {
  projectsWithActivity: 0,
  repositories: 0,
  commits: 0,
};

/** Zero-valued Contributions response — `toSignal` initialValue + empty-account fallback. */
export const EMPTY_ORG_CONTRIBUTIONS_RESPONSE: OrgContributionsResponse = {
  accountId: '',
  dateRange: ORG_LENS_DEFAULT_TIME_RANGE,
  kpis: EMPTY_ORG_CONTRIBUTIONS_KPIS,
  repositories: [],
  commits: [],
  projectOptions: [],
  employeeOptions: [],
  totalRecords: 0,
  commitsTotalRecords: 0,
};
