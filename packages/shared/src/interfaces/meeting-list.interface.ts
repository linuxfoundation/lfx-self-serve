// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingVisibilityKind } from '../enums';
import type { Meeting, MeetingOccurrence, MeetingResponseFilter, MeetingRsvp, PastMeetingSummary, RsvpResponse, RsvpScope } from './meeting.interface';
import type { UiBadgeTone } from './uikit.interface';

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

/** One date in the Pending RSVPs popover of the meetings home page, with what its row shows. */
export interface MeetingPendingRsvpItem {
  row: MeetingHomeRow;
  project: MeetingHomeRowProject | null;
  link: MeetingHomeRowLink;
  visibilityBadges: MeetingVisibilityInfo[];
  /** Day and start time in the viewer's zone, e.g. "Thu, Oct 1 · 6:30 AM PDT". */
  when: string;
  type: MeetingHomeRowType | null;
  /** Recurring tooltip; null for a one-time meeting. */
  recurrenceTooltip: string | null;
}

/** One RSVP answer on a meetings home row: its button label, its status label and look. */
export interface MeetingRsvpChoice {
  response: RsvpResponse;
  /** Button label before answering, e.g. "Yes". */
  action: string;
  /** Status label once answered, e.g. "Going". */
  label: string;
  icon: string;
  tone: UiBadgeTone;
}

/** What the recurring RSVP dialog opens with. */
export interface MeetingRsvpScopeDialogData {
  row: MeetingHomeRow;
  response: RsvpResponse;
}

/** One choice of the recurring RSVP dialog. */
export interface MeetingRsvpScopeOption {
  value: RsvpScope;
  label: string;
  description: string;
}

/** What the meetings home AI summary dialog opens with. */
export interface MeetingSummaryDialogData {
  row: MeetingHomeRow;
  summary: PastMeetingSummary;
  /** Gets the summary after each saved edit or approval. */
  onChange?: (summary: PastMeetingSummary) => void;
}

/** What the meetings home recording dialog opens with. */
export interface MeetingRecordingDialogData {
  row: MeetingHomeRow;
  shareUrl: string;
}

/** What the meetings home edit scope dialog opens with. */
export interface MeetingEditScopeDialogData {
  row: MeetingHomeRow;
  /** The meeting as just re-read; the occurrence picker lists its dates. */
  meeting: Meeting;
  /** The date the dialog opens on. */
  occurrence: MeetingOccurrence;
}
