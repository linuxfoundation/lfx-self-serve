// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_EMPTY_SOURCES } from './health-metrics-l2.constants';
import type { HealthMetricsL2Blank, HealthMetricsL2Section } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsSortColumn, HealthMetricsTableSort } from '../interfaces/health-metrics-table.interface';
import type {
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersFitBand,
  HealthMetricsNonMembersOrgs,
  HealthMetricsNonMembersOrgsFilter,
  HealthMetricsNonMembersOrgsFilterOption,
  HealthMetricsNonMembersOrgsSortKey,
  HealthMetricsNonMembersPeople,
  HealthMetricsNonMembersPeopleSortKey,
  HealthMetricsNonMembersQueryParams,
  HealthMetricsNonMembersSectionKey,
} from '../interfaces/health-metrics-non-members.interface';

/**
 * The three Non-Members sections in render order. `key` is the section's URL fragment and the
 * scroll-spy allowlist; the DOM id is `sec-non-<key>`.
 */
export const HEALTH_METRICS_NON_MEMBERS_SECTIONS = [
  {
    key: 'orgs',
    empty: { icon: 'fa-light fa-chart-simple', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Companies',
    heading: 'Company participation',
    description: 'Non-member companies already engaged with the foundation — your best leads.',
  },
  {
    key: 'people',
    empty: { icon: 'fa-light fa-chart-simple', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'People',
    heading: 'People',
    description: 'Contacts at those companies you can reach out to.',
  },
  {
    key: 'conversion',
    empty: { icon: 'fa-light fa-chart-simple', source: HEALTH_METRICS_L2_EMPTY_SOURCES.members },
    label: 'Conversion opportunity',
    heading: 'Conversion opportunity',
    description: 'What the pipeline is worth if the warmest companies convert. Framed as upside — this section carries no risk badges, only opportunity.',
  },
] as const satisfies readonly HealthMetricsL2Section[];

/** The tab's blank card, shown in place of every section when none has data for the period. */
export const HEALTH_METRICS_NON_MEMBERS_BLANK: HealthMetricsL2Blank = {
  icon: 'fa-light fa-buildings',
  noun: 'non-member',
  lead: 'Companies show here once they take part in foundation activities without a membership.',
  reasons: [
    'No code, event, meeting or training activity is recorded yet',
    'New activity can take 24–48 hours to appear',
    'Members are listed in the Members tab instead',
  ],
  pastActivity: 'non-member activity',
};

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_NON_MEMBERS_SECTION_ID_PREFIX = 'sec-non-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS = ['orgs', 'people', 'conversion'] as const satisfies readonly HealthMetricsNonMembersSectionKey[];

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

/** The header switch's choices, in the design's order. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS: readonly HealthMetricsNonMembersOrgsFilterOption[] = [
  { id: 'all', label: 'All' },
  { id: 'meetings', label: 'Attends meetings' },
  { id: 'high-fit', label: 'High fit' },
];

/** Read-failed / no-foundation value: no organizations, so the section renders no rows. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_UNMEASURED: HealthMetricsNonMembersOrgs = {
  rows: [],
  totalRecords: 0,
  scopeTotal: 0,
};

/** Rows per page, with the numbered pager; the largest foundation has several hundred active companies. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE = 10;

/** Largest page a caller may ask for. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE = 100;

export const HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_SEARCH_LENGTH = 100;

export const HEALTH_METRICS_NON_MEMBERS_ORGS_SEARCH_DEBOUNCE_MS = 200;

/** The Contributions header tip. The design's wording, with "company" for its "organization" (#5428). */
export const HEALTH_METRICS_NON_MEMBERS_CONTRIBUTIONS_TIP =
  "Code contributions (commits and pull requests) this company made to the foundation's projects in the selected period.";

/**
 * Short foundation names for the Other memberships badges, keyed by `foundation_slug`; a foundation missing here shows its
 * full name. Replaced by a `foundation_short_name` column once the directory carries one.
 */
export const HEALTH_METRICS_NON_MEMBERS_FOUNDATION_SHORT_NAMES: Readonly<Record<string, string>> = {
  aaif: 'AAIF',
  cncf: 'CNCF',
  openssf: 'OpenSSF',
  pytorch: 'PyTorch',
};

/** The fit bands, highest first; the Fit column ranks them in this order. */
export const HEALTH_METRICS_NON_MEMBERS_FIT_BANDS = ['High', 'Medium', 'Low'] as const;

/** The Fit badge's fill and ink per band, as the design colours them. */
export const HEALTH_METRICS_NON_MEMBERS_FIT_BADGE_CLASSES: Readonly<Record<HealthMetricsNonMembersFitBand, string>> = {
  High: 'bg-emerald-50 text-emerald-700',
  Medium: 'bg-amber-50 text-amber-800',
  Low: 'bg-red-50 text-red-700',
};

/** Company participation's sortable columns. Fit ranks its bands, so it sorts as a number, High first. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_SORT_COLUMNS: readonly HealthMetricsSortColumn<HealthMetricsNonMembersOrgsSortKey>[] = [
  { key: 'company', kind: 'text' },
  // The highest tier held, then how many; the first click puts the highest tier first.
  { key: 'memberships', kind: 'number' },
  { key: 'meetings', kind: 'number' },
  { key: 'contributions', kind: 'number' },
  { key: 'fit', kind: 'number' },
];

/** Company participation opens on the view's rank: meetings attended, then contributions, then name. */
export const HEALTH_METRICS_NON_MEMBERS_ORGS_DEFAULT_SORT: HealthMetricsTableSort<HealthMetricsNonMembersOrgsSortKey> = {
  key: 'meetings',
  direction: 'desc',
};

/** Read-failed / no-foundation value: no individuals, so the section renders no rows. */
export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_UNMEASURED: HealthMetricsNonMembersPeople = {
  rows: [],
  totalRecords: 0,
  scopeTotal: 0,
};

/** People rows per page, with the numbered pager; the largest foundation has a few hundred engaged individuals. */
export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE = 10;

/** People's sortable columns. */
export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_SORT_COLUMNS: readonly HealthMetricsSortColumn<HealthMetricsNonMembersPeopleSortKey>[] = [
  { key: 'person', kind: 'text' },
  { key: 'company', kind: 'text' },
  { key: 'meetings', kind: 'number' },
  { key: 'lastAttended', kind: 'date' },
];

/** People opens on the view's rank: meetings attended, highest first. */
export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_DEFAULT_SORT: HealthMetricsTableSort<HealthMetricsNonMembersPeopleSortKey> = {
  key: 'meetings',
  direction: 'desc',
};

export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_PAGE_SIZE = 100;

export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_SEARCH_LENGTH = 100;

export const HEALTH_METRICS_NON_MEMBERS_PEOPLE_SEARCH_DEBOUNCE_MS = 200;

/** Read-failed / no-foundation value: nothing measured, so the hero shows a muted dash and no warmest list. */
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
