// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES,
  HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES,
  HEALTH_METRICS_MEMBERS_SECTIONS,
} from '../constants/health-metrics-members.constants';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `M2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsMembersSectionKey = (typeof HEALTH_METRICS_MEMBERS_SECTIONS)[number]['key'];

/** A read a deep link waits on: a section, or `bridge`, the second read inside `#tiers`. */
export type HealthMetricsMembersDataSectionKey = HealthMetricsMembersSectionKey | 'bridge';

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

/** `GET /api/analytics/members-bridge` — every year's bridge; the section re-projects it per period client-side. */
export interface HealthMetricsMembersBridgeQuery {
  foundationSlug: string;
}

/** A `MEMBERSHIP_WATERFALL` movement: the four that change the base between its start and end totals. */
export type HealthMetricsMembersMovementType = Exclude<HealthMetricsMembersBridgeStepType, 'start_of_year' | 'today'>;

/** A bridge step: the start-of-year total, a movement, or the closing total the model calls `today`. */
export type HealthMetricsMembersBridgeStepType = (typeof HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES)[number];

/** One `MEMBERSHIP_WATERFALL` row. `null` is unmeasured, never zero. */
export interface HealthMetricsMembersBridgeStep {
  year: number;
  movementType: HealthMetricsMembersBridgeStepType;
  sortOrder: number;
  isPartialYear: boolean;
  memberCount: number | null;
  /** Negative for downgrades and churn; the model's own sign, never re-derived. */
  signedMemberCount: number | null;
  revenueImpactUsd: number | null;
}

export interface HealthMetricsMembersBridge {
  /** Newest year first, then `sort_order`. */
  steps: HealthMetricsMembersBridgeStep[];
}

/** The movements a bar opens as a named list; churn lives in `#churn` instead. */
export type HealthMetricsMembersMovementListType = (typeof HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES)[number];

/** `GET /api/analytics/members-movements` — one page of the organizations behind one bar. */
export interface HealthMetricsMembersMovementsQuery {
  foundationSlug: string;
  year: number;
  movementType: HealthMetricsMembersMovementListType;
  offset: number;
  pageSize: number;
}

/** One `MEMBERSHIP_MOVEMENT_DETAIL` row. Dates are ISO `YYYY-MM-DD`. */
export interface HealthMetricsMembersMovement {
  accountId: string;
  accountName: string;
  membershipTier: string | null;
  duesImpactUsd: number | null;
  movementDate: string | null;
  lastEngagedDate: string | null;
}

export interface HealthMetricsMembersMovements {
  rows: HealthMetricsMembersMovement[];
  /** Every organization behind the bar, so the drawer can check it against the bar's count. */
  totalRecords: number;
}

/** A bar's colour: the start and end totals are neutral, gains green, losses red. */
export type HealthMetricsMembersBridgeTone = 'neutral' | 'gain' | 'loss';

/** One bar of the selected year's bridge, positioned as a share of the chart's height. */
export interface HealthMetricsMembersBridgeBarView {
  movementType: HealthMetricsMembersBridgeStepType;
  label: string;
  countLabel: string;
  /** Empty when the model has no dues figure for the step. */
  duesLabel: string;
  tone: HealthMetricsMembersBridgeTone;
  bottomPct: number;
  heightPct: number;
  /** The list the bar opens; `null` for the totals, churn, and an empty movement. */
  listType: HealthMetricsMembersMovementListType | null;
  /** True for a churn bar with members to show, which goes to `#churn`. */
  opensChurn: boolean;
  memberCount: number | null;
  ariaLabel: string;
}

/** `#tiers` bridge, re-projected per period from the every-year response. */
export interface HealthMetricsMembersBridgeView {
  /** Any year has a bridge. */
  measured: boolean;
  /** The selected period's year has a bridge. */
  yearMeasured: boolean;
  year: number;
  heading: string;
  bars: HealthMetricsMembersBridgeBarView[];
  /** Set when start + the signed movements does not equal the end total the model reports. */
  reconcileNote: string | null;
}

/** Fixed copy for one movement list's drawer. */
export interface HealthMetricsMembersMovementDrawerCopy {
  title: string;
  pastTitle: string;
  subtitle: string;
  note: string;
  verb: string;
}

/** One organization in a movement drawer. */
export interface HealthMetricsMembersMovementRowView {
  accountId: string;
  accountName: string;
  detail: string;
  duesLabel: string;
  loss: boolean;
}
