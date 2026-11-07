// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Injector } from '@angular/core';

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

/** Next meeting card's join state: before the join window, inside it before the start, or under way. */
export type MeetingHomeJoinState = 'early' | 'soon' | 'live';

/** Applied filters on the meetings home list (search is kept separately). */
export interface MeetingsHomeFilters {
  /** Foundation UID: the foundation's own meetings and its non-foundation child projects'; null means all foundations. */
  foundation: string | null;
  /** Project UID; null means all projects. Takes precedence over `foundation`. */
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
  /** Filter name with its colon, e.g. "Project:"; absent on chips that are only a name. */
  prefix?: string;
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

/** One avatar in the "Organized by" stack of a meetings home row. */
export interface MeetingHomeRowOrganizer {
  /** Normalized username or email, unique within the row. */
  key: string;
  /** Accessible name and tooltip: "You" for the viewer, else the name. */
  label: string;
  /** Display name or username; the source of the initials. */
  name: string;
  /** Photo URL; empty when the feed has none. */
  photo: string;
}

/** One date in the Pending RSVPs drawer of the meetings home page, with what its row shows. */
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
  /** Status badge and menu icon. */
  icon: string;
  /** Yes / Maybe / No button icon. */
  buttonIcon: string;
  tone: UiBadgeTone;
}

/** Where a meetings dialog was opened; from the details drawer the dialog hides the meeting context block. */
export type MeetingDialogOrigin = 'drawer' | 'page';

/** What the recurring RSVP dialog opens with. */
export interface MeetingRsvpScopeDialogData {
  row: MeetingHomeRow;
  response: RsvpResponse;
  /** Defaults to `page`. */
  origin?: MeetingDialogOrigin;
}

/** One choice of the recurring RSVP dialog. */
export interface MeetingRsvpScopeOption {
  value: RsvpScope;
  label: string;
}

/** What the meetings home AI summary dialog opens with. */
export interface MeetingSummaryDialogData {
  row: MeetingHomeRow;
  summary: PastMeetingSummary;
  /** Gets the summary after each saved edit or approval. */
  onChange?: (summary: PastMeetingSummary) => void;
  /** Defaults to `page`. */
  origin?: MeetingDialogOrigin;
  /** Shows a summary still awaiting approval to any reader, marked Pending Review, as the meeting page does. */
  showPending?: boolean;
}

/** What the meetings home edit scope dialog opens with. */
export interface MeetingEditScopeDialogData {
  row: MeetingHomeRow;
  /** The meeting as just re-read; the occurrence picker lists its dates. */
  meeting: Meeting;
  /** The date the dialog opens on. */
  occurrence: MeetingOccurrence;
  /** Defaults to `page`. */
  origin?: MeetingDialogOrigin;
}

/** What the meetings home delete dialogs open with: the recurring scope picker, and the delete or cancel confirmation. */
export interface MeetingDeleteDialogData {
  row: MeetingHomeRow;
  /** Picker: the date it opens on. Confirmation: the date to cancel; null deletes the whole meeting. */
  occurrence: MeetingOccurrence | null;
  /** Defaults to `page`. */
  origin?: MeetingDialogOrigin;
}

/** A past meeting artifact a meetings home row loads on click, named for its error copy. */
export interface MeetingHomeArtifact {
  /** Lower-case name in messages, e.g. "summary". */
  noun: string;
  /** Name in a toast title, e.g. "AI Summary". */
  title: string;
}

/** What a meetings home attendance count or bar segment measures; `attendedPoor` is attendance under 50%. */
export type MeetingHomeAttendanceKind = 'yes' | 'maybe' | 'no' | 'attended' | 'attendedPoor';

/** One answer count in the meetings home attendance legend. */
export interface MeetingHomeAttendanceCount {
  kind: MeetingHomeAttendanceKind;
  /** "Yes", "Maybe" or "No". */
  label: string;
  count: number;
}

/** One coloured part of the meetings home attendance bar. */
export interface MeetingHomeAttendanceSegment {
  kind: MeetingHomeAttendanceKind;
  /** Width as a percentage of the invited count. */
  percent: number;
}

/** Attendance shown to the organizer on a meetings home row or card. */
export interface MeetingHomeAttendance {
  /** "12 of 16 attending · 75%" upcoming, "9 of 20 attended · 45%" past. */
  label: string;
  /** Spoken description of the bar. */
  ariaLabel: string;
  /** Bar segments with a count above zero. */
  segments: MeetingHomeAttendanceSegment[];
  /** Yes, Maybe and No counts, zeros included; empty for a past meeting. */
  answers: MeetingHomeAttendanceCount[];
  /** Invitees with no answer; null for a past meeting. */
  noResponse: number | null;
  /** A past meeting that fewer than half of the invitees attended. */
  poor: boolean;
}

/** An invitee's answer before a meeting, or their attendance after it, in the attendee avatar grid. */
export type MeetingAttendeeStatus = 'yes' | 'maybe' | 'no' | 'no_response' | 'attended' | 'absent';

/** Label and Tailwind fills of an attendee status. */
export interface MeetingAttendeeStatusInfo {
  /** "Yes", "No response", "Attended"... */
  label: string;
  /** Fill of the status dot on an avatar. */
  dotClass: string;
  /** Fill of the dot in the stats line. */
  legendDotClass: string;
}

/** One person in the attendee avatar grid. */
export interface MeetingAttendeeGridPerson {
  /** Registrant or participant uid. */
  id: string;
  name: string;
  /** Photo URL; empty shows initials. */
  avatarUrl: string;
  status: MeetingAttendeeStatus;
  /** "{name} · {status}", the tooltip and spoken label. */
  label: string;
}

/** One status count in the attendee grid stats line. */
export interface MeetingAttendeeGridStat {
  status: MeetingAttendeeStatus;
  label: string;
  count: number;
}

/** Invitees ordered for the attendee avatar grid, with their counts per status. */
export interface MeetingAttendeeGrid {
  /** Ordered by status, then name A–Z. */
  people: MeetingAttendeeGridPerson[];
  /** Statuses with a count above zero, in grid order. */
  stats: MeetingAttendeeGridStat[];
}

/** How many avatars the grid shows and whether more are hidden. */
export interface MeetingAttendeeGridOverflow {
  visible: number;
  /** More people than the visible rows hold: fade the last row and offer "View all". */
  more: boolean;
}

/** An organizer's edit or approval of a past meeting summary, for the row it was opened from. */
export interface MeetingHomeSummaryChange {
  /** Key of the row the summary dialog was opened from. */
  key: string;
  summary: PastMeetingSummary;
}

/** What the meeting details drawer shows for its date: before the join window, inside it before the start, under way, or over. */
export type MeetingDetailsState = 'far' | 'soon' | 'live' | 'ended';

/** Tab of the meeting details drawer. */
export type MeetingDetailsTab = 'agenda' | 'guests';

/** Where on the meetings home page the details drawer was opened from, sent with its analytics event. */
export type MeetingDetailsEntryPoint = 'row' | 'next_card' | 'last_card' | 'pending_rsvps' | 'attendance';

/** How the meeting details drawer opens. */
export interface MeetingDetailsOpenOptions {
  /** Tab to open on; Agenda & Materials by default. */
  tab?: MeetingDetailsTab;
}

/** What the meeting details drawer opens with. */
export interface MeetingDetailsDrawerData {
  row: MeetingHomeRow;
  tab: MeetingDetailsTab;
  /** The meetings home page's injector, so the drawer reaches the page's store and edit flow. */
  injector: Injector;
}

/** A meeting feature badge in the meeting details drawer, such as Recording, shown when its setting is on. */
export interface MeetingDetailsFeature {
  setting: 'recording_enabled' | 'transcript_enabled' | 'youtube_upload_enabled' | 'ai_summary_enabled';
  label: string;
  icon: string;
  /** Text colour class of the icon. */
  iconClass: string;
}

/** Which artifacts of an ended meeting exist, for its feature badges. */
export interface MeetingDetailsArtifacts {
  recording: boolean;
  transcript: boolean;
  summary: boolean;
}

/** One person in the "Organized by" line of the meeting details drawer. */
export interface MeetingDetailsOrganizer extends MeetingHomeRowOrganizer {
  /** Pre-filled `mailto:` about the meeting; null for the viewer or without a valid email. */
  mailto: string | null;
}

/** The artifacts of an ended date in the meeting details drawer; each is null when it does not exist or its lookup failed. */
export interface MeetingDetailsArtifactData {
  /** Share link of the largest recording session. */
  recordingUrl: string | null;
  /** Download link of the transcript file; only its presence is used. */
  transcriptUrl: string | null;
  summary: PastMeetingSummary | null;
}

/** Join link of a meeting date; `url` and `error` are both null while it loads or outside the join window. */
export interface MeetingJoinLink {
  url: string | null;
  /** Why the link could not be built, shown to the viewer. */
  error: string | null;
  /** Error code of a failed request, such as `NOT_REGISTERED_FOR_MEETING`. */
  code: string | null;
}
