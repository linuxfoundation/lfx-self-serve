// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_MEETINGS_TIME_RANGES } from '@lfx-one/shared/constants';

import type { OrgLensProjectBand } from './org-lens-project-detail.interface';

/** Window over which Org Lens meeting-insights data is aggregated. */
export type OrgMeetingsTimeRange = (typeof ORG_MEETINGS_TIME_RANGES)[number];

/** One selectable row in the `lfx-org-meetings-time-range` dropdown, with its computed date-range preview. */
export interface OrgMeetingsTimeRangeOption {
  value: OrgMeetingsTimeRange;
  label: string;
  /** e.g. "Apr 18, 2026 → Today" or "2021 → 2025"; omitted for options with no fixed preview (All time, Custom). */
  rangeLabel: string | null;
}

/** Direction of a period-over-period delta, drives arrow icon + color. */
export type OrgMeetingsDeltaDirection = 'up' | 'down' | 'flat';

/** One of the four org-level KPI totals shown at the top of the page. */
export interface OrgMeetingsKpiSummary {
  employeesActive: number;
  employeesActiveDeltaLabel: string;
  employeesActiveDeltaDirection: OrgMeetingsDeltaDirection;
  meetingsAttended: number;
  meetingsAttendedDeltaLabel: string;
  meetingsAttendedDeltaDirection: OrgMeetingsDeltaDirection;
  projectsSupported: number;
  projectsSupportedDeltaLabel: string;
  projectsSupportedDeltaDirection: OrgMeetingsDeltaDirection;
  foundationsSupported: number;
  foundationsSupportedDeltaLabel: string;
  foundationsSupportedDeltaDirection: OrgMeetingsDeltaDirection;
}

/** One item folded into a spend-bar segment's trailing "others" bucket. */
export interface OrgMeetingsSpendOtherItem {
  label: string;
  pct: number;
}

/** One colored segment of a "where time is spent" stacked bar. */
export interface OrgMeetingsSpendSegment {
  label: string;
  pct: number;
  count?: number;
  /** Itemized contents of the bucket, shown on hover when this is the trailing "others" segment. */
  others?: OrgMeetingsSpendOtherItem[];
}

/** An `OrgMeetingsSpendSegment` flagged as the trailing "others" bucket, for `lfx-org-spend-bar`. */
export interface OrgSpendBarSegment extends OrgMeetingsSpendSegment {
  isOther: boolean;
}

/** The four stacked bars rendered by the "Where your people spend time" card. */
export interface OrgMeetingsSpendBreakdown {
  byFoundation: OrgMeetingsSpendSegment[];
  byProject: OrgMeetingsSpendSegment[];
  byMeetingType: OrgMeetingsSpendSegment[];
  byRole: OrgMeetingsSpendSegment[];
}

/** One of the three "how this has changed over time" trend cards. */
export interface OrgMeetingsTrend {
  label: string;
  value: number;
  deltaLabel: string;
  deltaDirection: OrgMeetingsDeltaDirection;
  sparkline: number[];
}

/** One value (foundation/type/role) tied to a single meeting, tagged so private meetings can be masked in the leaderboard. */
export interface OrgLeaderboardMaskedValue {
  value: string;
  isPrivate: boolean;
}

/** One row of the employee meeting-attendance leaderboard. */
export interface OrgLeaderboardRow {
  employee: string;
  identity: string;
  foundationMeetings: OrgLeaderboardMaskedValue[];
  attended: number;
  upcoming: number;
  typeMeetings: OrgLeaderboardMaskedValue[];
  roleMeetings: OrgLeaderboardMaskedValue[];
  attendancePct: number;
}

/** One pill in a leaderboard cell — the real value, or "Private" if every meeting for it is private. */
export interface OrgLeaderboardPillValue {
  label: string;
  isPrivate: boolean;
}

/** Visible + overflow-collapsed pills for a multi-value leaderboard cell (foundations/type/role). */
export interface OrgLeaderboardPillGroup {
  visible: OrgLeaderboardPillValue[];
  overflowCount: number;
  /** Every value (visible + overflow), sorted by meeting count descending, shown in the "+N" hover popover. */
  all: OrgLeaderboardPillValue[];
}

/** An `OrgLeaderboardRow` with its multi-value cells pre-collapsed into pill groups for display. */
export interface OrgLeaderboardDisplayRow extends OrgLeaderboardRow {
  foundationsGroup: OrgLeaderboardPillGroup;
  typeGroup: OrgLeaderboardPillGroup;
  roleGroup: OrgLeaderboardPillGroup;
}

/** Ecosystem Influence rank tier, drives pill color in the influence accordion. */
export type OrgInfluenceRankTier = 'top' | 'down' | 'neutral';

/**
 * One measure feeding a project's Ecosystem Influence Score, rendered as a segment of the breakdown
 * bar. Labels/measures mirror the Org Lens Project Detail ecosystem-influence cards (PR #1028):
 * Collaboration Activity, Meeting Attendance, Board Members, Committee Members, Event Attendance,
 * Event Speakers, Event Sponsorships, Meetup Attendance, Certified Individuals.
 */
export interface OrgInfluenceBreakdownSegment {
  label: string;
  pct: number;
}

/** An `OrgInfluenceBreakdownSegment` flagged as the Meeting Attendance measure, for highlighting. */
export interface OrgInfluenceBreakdownRow extends OrgInfluenceBreakdownSegment {
  isAttendance: boolean;
}

/** One row of the "How attendance drives Ecosystem Influence" accordion. */
export interface OrgInfluenceRow {
  project: string;
  projectSlug: string;
  projectLink: string;
  ecosystemInfluence: number;
  /** Qualitative ecosystem-influence band shown (with signal-bar icon) in place of the raw score. */
  band: OrgLensProjectBand;
  rankLabel: string;
  rankTier: OrgInfluenceRankTier;
  fromAttendancePct: number;
  deltaLabel: string;
  deltaDirection: OrgMeetingsDeltaDirection;
  breakdown: OrgInfluenceBreakdownSegment[];
}

/** One bar of the band's signal-bar icon, positioned and filled per its rank. */
export interface OrgInfluenceBandBar {
  x: number;
  y: number;
  h: number;
  fillClass: string;
}

/** An `OrgInfluenceRow` enriched with display-ready band chip/bar and highlighted breakdown, as rendered by the influence accordion. */
export interface OrgInfluenceDisplayRow extends Omit<OrgInfluenceRow, 'breakdown'> {
  bandChipClass: string;
  bandLabel: string;
  bandBars: OrgInfluenceBandBar[];
  breakdown: OrgInfluenceBreakdownRow[];
}
