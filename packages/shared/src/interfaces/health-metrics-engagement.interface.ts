// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_MODES,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
  HEALTH_METRICS_TABS,
} from '../constants/health-metrics-engagement.constants';
import type { HealthMetricsRange } from './dashboard-metric.interface';

/** Section key from the design's `L2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsEngagementSectionKey = (typeof HEALTH_METRICS_ENGAGEMENT_SECTIONS)[number]['key'];

/** Group-type cut shared by the group-attendance and attendance-trend filter segments. */
export type HealthMetricsEngagementGroupTypeFilter = (typeof HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS)[number]['key'];

export type HealthMetricsTabKey = (typeof HEALTH_METRICS_TABS)[number]['key'];

/** Attendance-bar tone: grey at zero, amber below the low threshold, blue otherwise. */
export type HealthMetricsEngagementAttendanceTone = 'empty' | 'low' | 'ok';

/** One entry in the Health Metrics tab bar. Only routable tabs navigate; the rest render disabled. */
export interface HealthMetricsTab {
  key: HealthMetricsTabKey;
  label: string;
  /** Router path segment relative to `foundation/health-metrics`; `null` until that tab's story lands. */
  route: string | null;
}

/** A section with its DOM ids resolved once, so the template never calls a builder per render. */
export interface HealthMetricsEngagementSectionView {
  key: HealthMetricsEngagementSectionKey;
  label: string;
  heading: string;
  description: string;
  footnote: string;
  footnoteCaution: boolean;
  id: string;
  headingId: string;
}

/** Sub-nav badge for one section: a count plus an optional qualifier note. */
export interface HealthMetricsEngagementSubNavItem {
  key: HealthMetricsEngagementSectionKey;
  label: string;
  /** `null` for sections the design gives no badge (`participation`, `trend`). */
  count: number | null;
  /** e.g. `3 dormant`; empty when nothing qualifies. */
  note: string;
}

/**
 * Inputs to the sub-nav badges (the design's `counts()`). A `null` total means that section's data
 * has not resolved yet, so it renders no badge rather than a misleading zero.
 */
export interface HealthMetricsEngagementSubNavCounts {
  groups: number | null;
  dormantGroups: number;
  orgs: number | null;
  lapsedOrgs: number;
  reps: number | null;
  neverAttendedReps: number;
  nonMemberOrgs: number | null;
}

/** One group's numbers for a single period. Every period ships on every row, so the period pill
 * re-reads rather than re-deriving. */
export interface HealthMetricsEngagementGroupPeriod {
  range: HealthMetricsRange;
  meetingsHeld: number;
  invitedCount: number;
  attendedCount: number;
  /** 0-1 share of invited seats filled; `null` means no invited population at all. */
  attendancePct: number | null;
  /** The view's own `IS_DORMANT_<period>` — not re-derived client-side. */
  dormant: boolean;
}

/** A row of the Group attendance table. `periods` is ordered oldest → current and doubles as the
 * sparkline series. */
export interface HealthMetricsEngagementGroupRow {
  committeeId: string;
  committeeName: string;
  projectSlug: string | null;
  projectName: string | null;
  groupTypeLabel: string | null;
  /** ISO date of the group's last meeting, or `null` if it has never met. */
  lastMetDate: string | null;
  periods: HealthMetricsEngagementGroupPeriod[];
}

/** One table row with its selected-period numbers and sparkline series already resolved. */
export interface HealthMetricsEngagementGroupRowView {
  row: HealthMetricsEngagementGroupRow;
  period: HealthMetricsEngagementGroupPeriod | null;
  trend: (number | null)[];
  /** Pre-rendered so the template stays free of `DatePipe`, which would shift the date-only value. */
  lastMetLabel: string;
}

/** Sub-nav badge inputs for `#committees`, aggregated over the whole filtered set, not the page. */
export interface HealthMetricsEngagementGroupCounts {
  groups: number;
  dormantGroups: number;
}

/** One page of Group attendance, already sorted dormant-first by the view's `SORT_RANK_<period>`. */
export interface HealthMetricsEngagementGroupAttendance {
  rows: HealthMetricsEngagementGroupRow[];
  totalRecords: number;
  counts: HealthMetricsEngagementGroupCounts;
}

/** Wire query for `GET /api/analytics/engagement-group-attendance`. */
export interface HealthMetricsEngagementGroupQuery {
  foundationSlug: string;
  /** `null` is the all-projects scope — the view has no roll-up row, so the predicate is dropped. */
  projectSlug: string | null;
  groupType: HealthMetricsEngagementGroupTypeFilter;
  range: HealthMetricsRange;
  /** 1-based. */
  page: number;
  size: number;
}

/** Which measure the participation segment shows: the attendance share or the raw meeting volume. */
export type HealthMetricsEngagementParticipationMode = (typeof HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_MODES)[number]['key'];

/**
 * A participation row's level in the view's own hierarchy. `all` is the foundation-wide roll-up the
 * hero reads; `group` is one meeting-type group. The finer `committee_type` level is not read yet.
 */
export type HealthMetricsEngagementParticipationLevel = 'all' | 'group';

/** One participation row's numbers for a single period. Every period ships on every row. */
export interface HealthMetricsEngagementParticipationPeriod {
  range: HealthMetricsRange;
  meetingsHeld: number;
  invitedCount: number;
  attendedCount: number;
  /** 0-1 share of invited seats filled; `null` means no invited population at all. */
  attendancePct: number | null;
  activeGroups: number;
  neverAttended: number;
  /** Point change vs the previous comparable period; `null` when the view holds no prior period. */
  attendanceChangePp: number | null;
  /** Fractional change in meetings held vs the previous period; `null` when there is no prior. */
  meetingsChangePct: number | null;
}

/** The roll-up row or one meeting-type row of the Meeting participation section. */
export interface HealthMetricsEngagementParticipationRow {
  level: HealthMetricsEngagementParticipationLevel;
  /** The view's `MEETING_TYPE_GROUP`; `null` on the roll-up row. */
  group: string | null;
  label: string;
  totalGroups: number;
  /** True for the rows whose detail belongs to the Members tab rather than this page. */
  governance: boolean;
  periods: HealthMetricsEngagementParticipationPeriod[];
}

/** `GET /api/analytics/engagement-meeting-participation` — the hero's roll-up plus the type table. */
export interface HealthMetricsEngagementMeetingParticipation {
  /** `null` when the foundation has no roll-up row, which renders the section's empty state. */
  total: HealthMetricsEngagementParticipationRow | null;
  rows: HealthMetricsEngagementParticipationRow[];
}

/** Wire query for `GET /api/analytics/engagement-meeting-participation`. */
export interface HealthMetricsEngagementParticipationQuery {
  foundationSlug: string;
  range: HealthMetricsRange;
}

/** One participation table row with its selected-period numbers resolved. */
export interface HealthMetricsEngagementParticipationRowView {
  row: HealthMetricsEngagementParticipationRow;
  period: HealthMetricsEngagementParticipationPeriod | null;
}
