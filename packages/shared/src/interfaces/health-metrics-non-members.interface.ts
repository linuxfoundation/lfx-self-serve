// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS, HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `N2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsNonMembersSectionKey = (typeof HEALTH_METRICS_NON_MEMBERS_SECTIONS)[number]['key'];

/** Non-Members' sub-nav badge, keyed to its own sections. */
export interface HealthMetricsNonMembersSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsNonMembersSectionKey;
}

/** Company participation's filter pill; `all` matches every organization active in the period. */
export type HealthMetricsNonMembersOrgsFilter = (typeof HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS)[number];

/** `GET /api/analytics/non-members-orgs` — one page of the period's active non-member organizations. */
export interface HealthMetricsNonMembersOrgsQuery {
  foundationSlug: string;
  /** Picks the period columns for the activity counts and flags. */
  range: HealthMetricsL2Range;
  filter: HealthMetricsNonMembersOrgsFilter;
  search: string;
  offset: number;
  pageSize: number;
}

/** One `NON_MEMBER_COMPANY_PARTICIPATION` row for the period. The date is ISO `YYYY-MM-DD`; `null` is no feed, not zero. */
export interface HealthMetricsNonMembersOrg {
  accountId: string;
  accountName: string;
  lastEngagedDate: string | null;
  meetingsAttended: number | null;
  distinctPeople: number | null;
  contributions: number | null;
  isNew: boolean;
}

export interface HealthMetricsNonMembersOrgs {
  rows: HealthMetricsNonMembersOrg[];
  /** Organizations matching the filter and search. */
  totalRecords: number;
  /** Every organization active in the period; the sub-nav badge and the unfiltered count. */
  scopeTotal: number;
  /** Organizations new this period across the whole foundation, whatever the filter. */
  newCount: number;
}

/** An active channel chip on a row; a channel with no activity, or no feed, has no chip. */
export interface HealthMetricsNonMembersOrgChannelView {
  key: string;
  label: string;
}

/** One organization row as the Company participation table renders it. */
export interface HealthMetricsNonMembersOrgRowView {
  accountId: string;
  accountName: string;
  channels: HealthMetricsNonMembersOrgChannelView[];
  meetingsLabel: string;
  peopleLabel: string;
  contributionsLabel: string;
  lastEngagedLabel: string;
}

/** Each section's filter and page state in the URL; `null` clears a param the URL already carries. */
export interface HealthMetricsNonMembersQueryParams {
  nonFit?: HealthMetricsNonMembersOrgsFilter | null;
  nonSearch?: string | null;
  nonPage?: number | null;
}
