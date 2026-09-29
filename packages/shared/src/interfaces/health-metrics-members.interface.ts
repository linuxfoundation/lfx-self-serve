// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `M2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsMembersSectionKey = (typeof HEALTH_METRICS_MEMBERS_SECTIONS)[number]['key'];

/** Members' sub-nav badge, keyed to its own sections. */
export interface HealthMetricsMembersSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsMembersSectionKey;
}

/** `GET /api/analytics/members-tiers` — every year's tier rows; the section is re-projected per period client-side. */
export interface HealthMetricsMembersTiersQuery {
  foundationSlug: string;
}

/** One `MEMBERSHIP_TIER_YEAR` row: a tier's figures for one year. `null` is unmeasured, never zero. */
export interface HealthMetricsMembersTierYear {
  year: number;
  tier: string;
  sortRank: number;
  memberCount: number | null;
  newMemberCount: number | null;
  revenueUsd: number | null;
  isPartialYear: boolean;
}

/** The foundation's revenue across every domain for one period, from the Overview revenue model. */
export interface HealthMetricsMembersFoundationRevenue {
  range: HealthMetricsL2Range;
  totalUsd: number;
}

export interface HealthMetricsMembersTiers {
  /** Newest year first, then `tier_sort_rank`, then tier name; the view re-sorts years for display. */
  rows: HealthMetricsMembersTierYear[];
  /** A period the Overview model has no total for is left out, so its share reads as not available. */
  foundationRevenue: HealthMetricsMembersFoundationRevenue[];
}

/** The Members / Revenue toggle over the hero. */
export type HealthMetricsMembersTiersMode = 'members' | 'revenue';

export interface HealthMetricsMembersTiersModeOption {
  id: HealthMetricsMembersTiersMode;
  label: string;
}

export interface HealthMetricsMembersTiersStatView {
  key: string;
  label: string;
  value: string;
  /** `null` renders no delta; `not available` renders as text. */
  delta: string | null;
  deltaDirection: 'up' | 'down' | 'neutral';
  /** What a measured delta compares against, e.g. `vs 2024`; `null` when there is none to state. */
  baseline: string | null;
  /** Drawn in the design's green, e.g. new members. */
  positive: boolean;
}

/** One year column of the matrix and one bar of the composition chart. */
export interface HealthMetricsMembersTiersYearView {
  year: number;
  isCurrent: boolean;
  isPartial: boolean;
  /** `null` when every tier's count is unmeasured. */
  totalMembers: number | null;
  totalMembersLabel: string;
  totalRevenueLabel: string;
}

export interface HealthMetricsMembersTiersCellView {
  year: number;
  count: number | null;
  /** `—` for a measured zero or an unmeasured count. */
  label: string;
  /** Share of that year's members, 0–100; 0 when the year has none, `null` when the count is unmeasured. */
  sharePct: number | null;
}

export interface HealthMetricsMembersTiersTierView {
  tier: string;
  color: string;
  /** One cell per year column, in the same order. */
  cells: HealthMetricsMembersTiersCellView[];
}

export interface HealthMetricsMembersTiersView {
  /** False when the foundation has no tier rows at all. */
  measured: boolean;
  /** False when the selected period's year has no tier rows. */
  yearMeasured: boolean;
  metaLabel: string;
  headline: HealthMetricsMembersTiersStatView;
  side: HealthMetricsMembersTiersStatView[];
  years: HealthMetricsMembersTiersYearView[];
  tiers: HealthMetricsMembersTiersTierView[];
}

/** One year's tier rows summed; a figure is `null` when no row in the year measures it. */
export interface HealthMetricsMembersTiersYearSummary {
  measured: boolean;
  isPartial: boolean;
  members: number | null;
  newMembers: number | null;
  revenue: number | null;
}
