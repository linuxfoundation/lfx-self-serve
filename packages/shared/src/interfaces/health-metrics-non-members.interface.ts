// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_NON_MEMBERS_FIT_BANDS,
  HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS,
  HEALTH_METRICS_NON_MEMBERS_SECTIONS,
} from '../constants/health-metrics-non-members.constants';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';
import type { HealthMetricsTableSort } from './health-metrics-table.interface';

/** Section key from the design's `N2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsNonMembersSectionKey = (typeof HEALTH_METRICS_NON_MEMBERS_SECTIONS)[number]['key'];

/** Non-Members' sub-nav entry, keyed to its own sections. */
export interface HealthMetricsNonMembersSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsNonMembersSectionKey;
}

/** Company participation's header-switch cut; `all` matches every company active in the period. */
export type HealthMetricsNonMembersOrgsFilter = (typeof HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS)[number];

/** One choice on Company participation's header switch. */
export interface HealthMetricsNonMembersOrgsFilterOption {
  id: HealthMetricsNonMembersOrgsFilter;
  label: string;
}

/** A fit band the model scores. */
export type HealthMetricsNonMembersFitBand = (typeof HEALTH_METRICS_NON_MEMBERS_FIT_BANDS)[number];

/** Company participation's sortable columns. */
export type HealthMetricsNonMembersOrgsSortKey = 'company' | 'memberships' | 'meetings' | 'contributions' | 'fit';

/** One current membership a non-member company holds in another LF foundation, from `MEMBERSHIP_DIRECTORY`. */
export interface HealthMetricsNonMembersOtherMembership {
  foundationSlug: string;
  foundationName: string;
  /** The warehouse's tier name, such as `Gold Membership`; `null` when unset. */
  tier: string | null;
}

/** One Other memberships badge: a foundation's short name, with its highest tier in the tooltip. */
export interface HealthMetricsNonMembersOtherMembershipView {
  key: string;
  label: string;
  /** "{Tier} membership", or "Membership" with no tier. */
  tierLabel: string;
}

/** `GET /api/analytics/non-members-orgs` — one page of the period's active non-member organizations. */
export interface HealthMetricsNonMembersOrgsQuery {
  foundationSlug: string;
  /** Picks the period columns for the activity counts and flags. */
  range: HealthMetricsL2Range;
  filter: HealthMetricsNonMembersOrgsFilter;
  search: string;
  offset: number;
  pageSize: number;
  /** A column the reader picked, over every page; `null` keeps the view's rank. */
  sort: HealthMetricsTableSort<HealthMetricsNonMembersOrgsSortKey> | null;
}

/** One `NON_MEMBER_COMPANY_PARTICIPATION` row for the period. The date is ISO `YYYY-MM-DD`; `null` is no feed, not zero. */
export interface HealthMetricsNonMembersOrg {
  accountId: string;
  accountName: string;
  /** The company's mapped logo; `null` shows its first letter. */
  logoUrl: string | null;
  lastEngagedDate: string | null;
  meetingsAttended: number | null;
  distinctPeople: number | null;
  contributions: number | null;
  /** The model's fit band (`High`, `Medium` or `Low`); `null` when unscored. */
  fitBand: string | null;
  /** Current memberships in other foundations; empty when it holds none. */
  otherMemberships: HealthMetricsNonMembersOtherMembership[];
}

export interface HealthMetricsNonMembersOrgs {
  rows: HealthMetricsNonMembersOrg[];
  /** Companies matching the filter and search. */
  totalRecords: number;
  /** Every company active in the period; the unfiltered count. */
  scopeTotal: number;
}

/** One company row as the Company participation table renders it. */
export interface HealthMetricsNonMembersOrgRowView {
  accountId: string;
  accountName: string;
  logoUrl: string | null;
  /** "Last engaged {Mon D, YYYY}" under the name; empty with no date. */
  lastEngagedLabel: string;
  /** One badge per other foundation, highest tier first, then A–Z; empty reads "—". */
  otherMemberships: HealthMetricsNonMembersOtherMembershipView[];
  meetingsLabel: string;
  /** "{n} person" or "{n} people" under the count; empty when nobody attended. */
  peopleLabel: string;
  contributionsLabel: string;
  fitLabel: string;
  /** The Fit badge's fill and ink; `null` shows the label as a plain "—". */
  fitBadgeClass: string | null;
}

/** `GET /api/analytics/non-members-people` — one page of the period's engaged non-member individuals. */
export interface HealthMetricsNonMembersPeopleQuery {
  foundationSlug: string;
  /** Picks the period columns for the meeting count and rank. */
  range: HealthMetricsL2Range;
  /** Matches the person's name or their organization's. */
  search: string;
  offset: number;
  pageSize: number;
}

/** One `NON_MEMBER_PEOPLE` row for the period; never carries an email address. The date is ISO `YYYY-MM-DD`. */
export interface HealthMetricsNonMembersPerson {
  /** 1-based position in the ranked result; the warehouse person key can be an email, so it stays on the server. */
  rowKey: string;
  displayName: string;
  jobTitle: string | null;
  accountId: string | null;
  accountName: string | null;
  lastAttendedDate: string | null;
  meetingsAttended: number | null;
}

export interface HealthMetricsNonMembersPeople {
  rows: HealthMetricsNonMembersPerson[];
  /** Individuals matching the search. */
  totalRecords: number;
  /** Every individual who attended in the period; `null` when the model leaves it unset, which is not zero. */
  scopeTotal: number | null;
}

/** One person row as the People table renders it; a missing title has no secondary line. */
export interface HealthMetricsNonMembersPersonRowView {
  rowKey: string;
  displayName: string;
  jobTitle: string | null;
  organizationLabel: string;
  meetingsLabel: string;
  lastAttendedLabel: string;
}

/** `GET /api/analytics/non-members-conversion` — the period's pipeline estimate and its warmest organizations. */
export interface HealthMetricsNonMembersConversionQuery {
  foundationSlug: string;
  /** Picks the period columns for the counts, the estimate and the high-fit set. */
  range: HealthMetricsL2Range;
}

/** A high-fit organization, in the fit model's rank. `null` is no feed, not zero. */
export interface HealthMetricsNonMembersWarmOrg {
  accountId: string;
  accountName: string;
  meetingsAttended: number | null;
  contributions: number | null;
}

/** One `NON_MEMBER_CONVERSION_OPPORTUNITY` row for the period; `null` is not available, never zero. */
export interface HealthMetricsNonMembersConversion {
  /** False when the foundation has no conversion row, so nothing below is meaningful. */
  measured: boolean;
  entryTierName: string | null;
  entryTierFeeUsd: number | null;
  organizationsTracked: number | null;
  highFitCount: number | null;
  newCount: number | null;
  /** High-fit count × entry-tier fee; `null` when the foundation has no entry-tier fee. */
  estimatedPipelineUsd: number | null;
  /** Top high-fit organizations by fit rank, from the High-band active set the count covers. */
  warmest: HealthMetricsNonMembersWarmOrg[];
}

export interface HealthMetricsNonMembersConversionStatView {
  key: 'high-fit' | 'new';
  label: string;
  value: string;
}

export interface HealthMetricsNonMembersWarmOrgRowView {
  accountId: string;
  label: string;
  valueLabel: string;
}

/** The Conversion opportunity section as it renders. */
export interface HealthMetricsNonMembersConversionView {
  measured: boolean;
  summary: string;
  pipelineValue: string;
  pipelineLabel: string;
  hasEstimate: boolean;
  side: HealthMetricsNonMembersConversionStatView[];
  warmest: HealthMetricsNonMembersWarmOrgRowView[];
}

/** Each section's filter and page state in the URL; `null` clears a param the URL already carries. */
export interface HealthMetricsNonMembersQueryParams {
  nonFit?: HealthMetricsNonMembersOrgsFilter | null;
  nonSearch?: string | null;
  nonPage?: number | null;
  nonPeopleSearch?: string | null;
  nonPeoplePage?: number | null;
}
