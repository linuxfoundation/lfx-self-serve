// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingVisibilityKind } from '../enums';
import type { Meeting, MeetingOccurrence, MeetingResponseFilter, MeetingRsvp } from './meeting.interface';

/** One row of the meetings home list: a single date of a meeting. */
export interface MeetingHomeRow {
  /** Stable key: the meeting id, plus the occurrence id for one date of a series. */
  key: string;
  meeting: Meeting;
  /** The occurrence this row shows; null for one-time meetings, past meetings and series without a usable occurrence list. */
  occurrence: MeetingOccurrence | null;
  /** The occurrence's own title when it has one, else the meeting title. */
  title: string;
  /** Occurrence id to act on (RSVP, links); null for one-time meetings. */
  occurrenceId: string | null;
  /** RFC3339 start of this row's date. */
  startTime: string;
  /** Duration of this row's date in minutes. */
  durationMinutes: number;
  /** The viewer's RSVP that applies to this date: null when none applies, undefined when RSVPs were not loaded. */
  myRsvp?: MeetingRsvp | null;
}

/** Applied filters on the meetings home list (search is kept separately). */
export interface MeetingsHomeFilters {
  /** Project UID; null means all projects. */
  project: string | null;
  /** Exact `meeting_type`; null means all types. */
  meetingType: string | null;
  /** The viewer's RSVP for the row's date. */
  rsvp: MeetingResponseFilter;
  /** Keep only meetings the viewer organizes. */
  organizedByMe: boolean;
  /** Hide a series when the viewer declined every upcoming date of it; never hides meetings the viewer organizes. */
  hideDeclined: boolean;
}

export interface MeetingResponseFilterOption {
  label: string;
  value: MeetingResponseFilter;
}

/** A day separator on the meetings home list with the rows under it. */
export interface MeetingDayGroup {
  /** "Today", "Tomorrow"/"Yesterday", "This week", "This month", or a month name (with the year when it falls in another year). */
  label: string;
  /** Rows in this bucket across the whole list, not just the loaded page. */
  count: number;
  /** Loaded rows in this bucket. */
  rows: MeetingHomeRow[];
}

/** An applied-filter chip; removing it resets `key` to its default. */
export interface MeetingFilterChip {
  key: keyof MeetingsHomeFilters;
  label: string;
}

/** Visibility badge and tooltip copy for a meetings home row. */
export interface MeetingVisibilityInfo {
  kind: MeetingVisibilityKind;
  title: string;
  /** Tooltip description; null when the title says it all. */
  description: string | null;
  icon: string;
}

/** Where a meetings home row opens. */
export interface MeetingHomeRowLink {
  /** App-relative URL with its query string. */
  url: string;
  /** Open in a new tab, as the legacy card does for upcoming meetings. */
  newTab: boolean;
}

/** Project eyebrow of a meetings home row. */
export interface MeetingHomeRowProject {
  name: string;
  /** Shown in the logo tile when there is no logo. */
  initial: string;
  /** Logo URL; empty when the project has none. */
  logo: string;
  /** Project or foundation overview; null without a project slug. */
  url: string | null;
  /** Accessible name, e.g. "Jump to project: Kubernetes". */
  label: string;
}

/** Meeting type label and icon on a meetings home row. */
export interface MeetingHomeRowType {
  label: string;
  icon: string;
}
