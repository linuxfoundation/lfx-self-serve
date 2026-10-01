// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type { HealthMetricsL2CrossReference } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersOrgs,
  HealthMetricsNonMembersOrgsFilter,
  HealthMetricsNonMembersPeople,
  HealthMetricsNonMembersQueryParams,
  HealthMetricsNonMembersSectionKey,
} from '../interfaces/health-metrics-non-members.interface';

/**
 * The three Non-Members sections in render order. `key` is the section's URL fragment and the
 * scroll-spy allowlist; the DOM id is `sec-non-<key>`. Footnotes land with each section's data.
 */
export const HEALTH_METRICS_NON_MEMBERS_SECTIONS = [
  {
    key: 'orgs',
    label: 'Company participation',
    heading: 'Company participation',
    description:
      'Organizations engaging without paying. Ranked by meetings attended first, not code — showing up to meetings means they are already spending staff time, which is the stronger buying signal.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'people',
    label: 'People',
    heading: 'People',
    description: 'The individuals behind those organizations — the actual contact to reach out to. A company is a lead; a person is a conversation.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'conversion',
    label: 'Conversion opportunity',
    heading: 'Conversion opportunity',
    description: 'What the pipeline is worth if the warmest organizations convert. Framed as upside — this section carries no risk badges, only opportunity.',
    footnote: '',
    footnoteCaution: false,
  },
] as const;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_NON_MEMBERS_SECTION_ID_PREFIX = 'sec-non-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS = ['orgs', 'people'] as const satisfies readonly HealthMetricsNonMembersSectionKey[];

/** Note under the sub-nav items, linking to Engagement's non-member participation. */
export const HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE: HealthMetricsL2CrossReference = {
  text: 'Non-members attending meetings also appear in',
  linkLabel: 'Engagement',
  route: 'engagement',
  fragment: 'nonmem',
};

/** The project selector does not narrow Non-Members, so the page says so above its sections. */
export const HEALTH_METRICS_NON_MEMBERS_SCOPE_NOTE = 'Non-Members figures are foundation-wide. The project selector does not narrow them.';

/** Each section's filter, search and page state in the URL; each key is namespaced to the tab. */
export const HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS = {
  orgsFilter: 'nonFit',
  orgsSearch: 'nonSearch',
  orgsPage: 'nonPage',
  peopleSearch: 'nonPeopleSearch',
  peoplePage: 'nonPeoplePage',
} as const satisfies Record<string, keyof HealthMetricsNonMembersQueryParams>;

/** Company participation's filters, and the allowlist the read validates against. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS = ['all', 'meetings', 'high-fit'] as const;

export const HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS: readonly (FilterPillOption & { id: HealthMetricsNonMembersOrgsFilter })[] = [
  { id: 'all', label: 'All' },
  { id: 'meetings', label: 'Attends meetings' },
  { id: 'high-fit', label: 'High fit' },
];

/** Read-failed / no-foundation value: no organizations, so the section renders no rows. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED: HealthMetricsNonMembersOrgs = {
  rows: [],
  totalRecords: 0,
  scopeTotal: 0,
  newCount: 0,
};

/** Rows per page, and the rows-per-page choices; the largest foundation has several hundred active organizations. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE = 10;

export const HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50];

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE = 100;

export const HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH = 100;

export const HEALTH_METRICS_NON_MEMBERS_ORGS_SEARCH_DEBOUNCE_MS = 200;

/** Under the table until the organization match is validated. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_PROVISIONAL_NOTE =
  "Organization matching is under validation. Treat this list as provisional and don't send it to sales unchecked.";

/** Read-failed / no-foundation value: no individuals, so the section renders no rows. */
export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_UNMEASURED: HealthMetricsNonMembersPeople = {
  rows: [],
  totalRecords: 0,
  scopeTotal: 0,
};

/** People rows per page, and the rows-per-page choices; the largest foundation has a few hundred engaged individuals. */
export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE = 10;

export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50];

export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_PAGE_SIZE = 100;

export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_SEARCH_LENGTH = 100;

export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_SEARCH_DEBOUNCE_MS = 200;

/** Read-failed / no-foundation value: nothing measured, so the section renders its empty state. */
export const HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED: HealthMetricsNonMembersConversion = {
  measured: false,
  entryTierName: null,
  entryTierFeeUsd: null,
  organizationsTracked: null,
  highFitCount: null,
  newCount: null,
  estimatedPipelineUsd: null,
  warmest: [],
};

/** How many high-fit organizations the warmest list shows. */
export const HEALTH_METRICS_NON_MEMBERS_CONVERSION_WARMEST_LIMIT = 10;

/** A NULL count or estimate is not zero; the section says so in words. */
export const HEALTH_METRICS_NON_MEMBERS_NOT_AVAILABLE = 'not available';

/** Opportunity styling only: this section carries no risk colours. */
export const HEALTH_METRICS_NON_MEMBERS_CONVERSION_BAR_CLASS = 'bg-blue-600';
