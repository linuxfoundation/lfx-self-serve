// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  ContributionsDateRange,
  ContributionsDateRangeOption,
  OrgContributionsKpis,
  OrgContributionsQuery,
  OrgContributionsResponse,
} from '../interfaces';

// Org Lens → Code Contributions page (LFXV2-1894). Date-range vocab 30d/90d/12mo/all
// mirrors the People → Contributors tab; default = Past 12 Months per the prototype.

/** Default date-range window — Past 12 Months per the prototype default. */
export const CONTRIBUTIONS_DEFAULT_DATE_RANGE: ContributionsDateRange = '12mo';

/** Date-range dropdown options — ordered widest-first to match the prototype. */
export const CONTRIBUTIONS_DATE_RANGE_OPTIONS: readonly ContributionsDateRangeOption[] = [
  { label: 'Past 12 Months', value: '12mo' },
  { label: 'Past 90 Days', value: '90d' },
  { label: 'Past 30 Days', value: '30d' },
  { label: 'All Time', value: 'all' },
] as const;

/** Default Repositories page size — Org Lens convention is 10 (open question pending; see ticket). */
export const CONTRIBUTIONS_DEFAULT_PAGE_SIZE = 10;

/** Page-size selector options on the Repositories pagination footer. */
export const CONTRIBUTIONS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50] as const;

/** Server-accepted page-size ceiling (clamps the `size` query param; not exposed in the table footer). */
export const CONTRIBUTIONS_MAX_PAGE_SIZE = 100;

/** Default empty filter/pagination state — Repositories tab, Commits desc, page 1. */
export const EMPTY_ORG_CONTRIBUTIONS_QUERY: OrgContributionsQuery = {
  view: 'repositories',
  dateRange: CONTRIBUTIONS_DEFAULT_DATE_RANGE,
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
  dateRange: CONTRIBUTIONS_DEFAULT_DATE_RANGE,
  kpis: EMPTY_ORG_CONTRIBUTIONS_KPIS,
  repositories: [],
  commits: [],
  projectOptions: [],
  employeeOptions: [],
  totalRecords: 0,
  commitsTotalRecords: 0,
};
