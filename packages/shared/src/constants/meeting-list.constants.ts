// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibilityKind } from '../enums';
import { RECURRENCE_DAYS_OF_WEEK } from './meeting.constants';
import type {
  MeetingCalendarTypeColor,
  MeetingDetailsFeature,
  MeetingGroupTypePattern,
  MeetingHomeArtifact,
  MeetingHomeAttendanceKind,
  MeetingJoinLink,
  MeetingResponseFilterOption,
  MeetingRsvpChoice,
  MeetingsHomeFilters,
  MeetingsHomePastFilters,
  MeetingVisibilityInfo,
  UiBadgeTone,
} from '../interfaces';

/** The AI summary of a past meetings home row. */
export const MEETINGS_HOME_SUMMARY_ARTIFACT: MeetingHomeArtifact = { noun: 'summary', title: 'AI Summary' };

/** Empty join link (no link, no error): the state while loading and outside the join window. */
export const NO_MEETING_JOIN_LINK: MeetingJoinLink = { url: null, error: null, code: null };

/** Rows the meetings home list loads per page. */
export const MEETINGS_HOME_PAGE_SIZE = 20;

/** Gap in px between the tabs rule and a day heading; must match the day-group separator's -mt-[20px] and pt-[20px]. */
export const MEETINGS_HOME_DAY_HEADING_GAP_PX = 20;

/** Filters with nothing applied. */
export const MEETINGS_HOME_DEFAULT_FILTERS: MeetingsHomeFilters = {
  foundation: null,
  project: null,
  group: null,
  groupType: null,
  meetingType: null,
  rsvp: 'all',
  organizedByMe: false,
  hideDeclined: false,
};

/** A paged past feed with no filters applied on the server. */
export const MEETINGS_HOME_NO_PAST_FILTERS: MeetingsHomePastFilters = { projectUid: null, committeeUid: null, groupType: null, meetingType: null };

/** RSVP filter choices, in menu order. */
export const MEETINGS_HOME_RSVP_FILTER_OPTIONS: readonly MeetingResponseFilterOption[] = [
  { label: 'Any RSVP', value: 'all' },
  { label: 'Needs response', value: 'pending' },
  { label: 'Going', value: 'accepted' },
  { label: 'Not going', value: 'declined' },
  { label: 'Maybe', value: 'maybe' },
];

/** RSVP answers on a meetings home row, in button order. */
export const MEETINGS_HOME_RSVP_CHOICES: readonly MeetingRsvpChoice[] = [
  { response: 'accepted', action: 'Yes', label: 'Going', icon: 'fa-solid fa-circle-check', buttonIcon: 'fa-light fa-circle-check', tone: 'success' },
  { response: 'maybe', action: 'Maybe', label: 'Maybe', icon: 'fa-solid fa-circle-question', buttonIcon: 'fa-light fa-circle-question', tone: 'warning' },
  { response: 'declined', action: 'No', label: 'Not going', icon: 'fa-solid fa-circle-xmark', buttonIcon: 'fa-light fa-circle-xmark', tone: 'danger' },
];

/** Applied-filter chip copy. */
export const MEETINGS_HOME_FILTER_CHIP_LABELS = {
  foundation: 'Foundation',
  project: 'Project',
  group: 'Group',
  groupType: 'Group type',
  meetingType: 'Meeting type',
  rsvp: 'RSVP',
  organizedByMe: 'Organized by me',
  hideDeclined: 'Hiding declined series',
} as const;

/** Group types read from a group's name when it has no category, first match wins. */
export const MEETING_GROUP_TYPE_PATTERNS: readonly MeetingGroupTypePattern[] = [
  { pattern: /\bBoard\b/i, type: 'Board' },
  { pattern: /\bWG\b|\bWorking Group\b|\bWorkstreams?\b/i, type: 'Working Group' },
  { pattern: /\bSIG\b|\bSpecial Interest\b/i, type: 'Special Interest Group' },
  { pattern: /\b(?:TAC|TOC)\b|\bTechnical\b|\bSteering\b/i, type: 'Technical Advisory Committee' },
  { pattern: /\bCommittee\b|\bCouncil\b/i, type: 'Committee' },
  { pattern: /\bAmbassadors?\b/i, type: 'Ambassador' },
];

/** Type of a group without a category whose name matches no {@link MEETING_GROUP_TYPE_PATTERNS}. */
export const MEETING_GROUP_TYPE_OTHER = 'Other';

/** Tailwind fill of a visibility badge per kind. */
export const MEETING_VISIBILITY_BG_CLASSES: Record<MeetingVisibilityKind, string> = {
  [MeetingVisibilityKind.PUBLIC]: 'bg-emerald-500',
  [MeetingVisibilityKind.PRIVATE]: 'bg-gray-900',
  [MeetingVisibilityKind.RESTRICTED]: 'bg-red-600',
};

/** Tailwind fill of an attendance bar segment and legend dot per kind. */
export const MEETING_HOME_ATTENDANCE_BG_CLASSES: Record<MeetingHomeAttendanceKind, string> = {
  yes: 'bg-emerald-500',
  maybe: 'bg-amber-500',
  no: 'bg-red-500',
  attended: 'bg-blue-500',
  attendedPoor: 'bg-amber-500',
  absent: 'bg-gray-300',
};

/** Visibility badge icon and tooltip copy per kind. */
export const MEETING_VISIBILITY_INFO: Record<MeetingVisibilityKind, MeetingVisibilityInfo> = {
  [MeetingVisibilityKind.PUBLIC]: {
    kind: MeetingVisibilityKind.PUBLIC,
    title: 'Public',
    description: null,
    icon: 'fa-solid fa-globe',
  },
  [MeetingVisibilityKind.PRIVATE]: {
    kind: MeetingVisibilityKind.PRIVATE,
    title: 'Private',
    description: 'Meeting not publicly discoverable. Only invited people can find this meeting across the app or the project calendar.',
    icon: 'fa-solid fa-shield-halved',
  },
  [MeetingVisibilityKind.RESTRICTED]: {
    kind: MeetingVisibilityKind.RESTRICTED,
    title: 'Restricted',
    description: 'Only invited people can join',
    icon: 'fa-solid fa-lock',
  },
};

/** Badge tone of each visibility in the meeting details drawer. */
export const MEETING_DETAILS_VISIBILITY_TONES: Record<MeetingVisibilityKind, UiBadgeTone> = {
  [MeetingVisibilityKind.PUBLIC]: 'success',
  [MeetingVisibilityKind.PRIVATE]: 'neutral',
  [MeetingVisibilityKind.RESTRICTED]: 'danger',
};

/** Feature badges of the meeting details drawer, in order. */
export const MEETING_DETAILS_FEATURES: readonly MeetingDetailsFeature[] = [
  { setting: 'recording_enabled', label: 'Recording', icon: 'fa-light fa-video', iconClass: 'text-red-600' },
  { setting: 'transcript_enabled', label: 'Transcripts', icon: 'fa-light fa-file-lines', iconClass: 'text-emerald-600' },
  { setting: 'youtube_upload_enabled', label: 'YouTube Upload', icon: 'fa-light fa-upload', iconClass: 'text-amber-600' },
  { setting: 'ai_summary_enabled', label: 'AI Summary', icon: 'fa-light fa-sparkles', iconClass: 'text-violet-600' },
];

/** Id the meeting details drawer registers with the app's open-overlay tracking while it is open. */
export const MEETING_DETAILS_OVERLAY_ID = 'meeting-details-drawer';

/** Analytics event sent when the meeting details drawer opens, in place of a meeting page view. */
export const MEETING_DETAILS_OPENED_EVENT = 'Meeting Details Opened';

/**
 * Most projects a meetings roll-up filter may name (GH-5566); the server rejects more. Selecting every
 * project sends no subset at all, so only a hand-picked partial selection of a very large tree can reach it.
 */
export const MEETING_ROLLUP_MAX_PROJECTS = 200;

/**
 * Most projects a meetings roll-up sends to query-service in one `filters_or` request (GH-5807). Measured in
 * production: 150 projects work, 200 fail. A larger scope falls back to the root project's own meetings, so a
 * selection of 151 to MEETING_ROLLUP_MAX_PROJECTS projects is accepted but shows the root only.
 */
export const MEETING_ROLLUP_QUERY_MAX_PROJECTS = 150;

/** User-service preference app name for the meetings roll-up project selection (GH-5566). */
export const MEETING_ROLLUP_PROJECTS_PREFERENCE_APP_NAME = 'LFXOne';

/** User-service preference name: a JSON map of roll-up root project UID to the project UIDs the user selected under it. */
export const MEETING_ROLLUP_PROJECTS_PREFERENCE_NAME = 'MeetingsRollupProjects';

/** Most roll-up roots the preference remembers; the least recently saved root is dropped first. */
export const MEETING_ROLLUP_PROJECTS_PREFERENCE_MAX_ROOTS = 25;

/** Largest stored preference value; least recently saved roots are dropped until it fits. Same budget as favorite projects. */
export const MEETING_ROLLUP_PROJECTS_PREFERENCE_VALUE_MAX_LENGTH = 16_000;

/** `projects` URL value (and saved-choice marker) for every project of a meetings roll-up; the root alone is the default. */
export const MEETING_ROLLUP_ALL_PROJECTS = 'all';

/** Past meetings per request on a project's meetings home, which pages its past feed on the server. */
export const MEETINGS_HOME_PROJECT_PAST_PAGE_SIZE = 50;

/** Most max-size pages a project's meetings home reads for its upcoming feed, as the legacy calendar does. */
export const MEETINGS_HOME_PROJECT_MAX_UPCOMING_PAGES = 10;

/** Weekday initials of the meetings home calendars, Sunday first. */
export const MEETINGS_HOME_CALENDAR_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Most dots a mini calendar day shows, one per meeting. */
export const MEETINGS_HOME_MINI_CALENDAR_MAX_DOTS = 3;

/** Most meetings a mini calendar day's tooltip lists before "+N more". */
export const MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_ITEMS = 6;

/** Tooltip centre never closer than this to the window's right edge (half its 280px width plus a margin). */
export const MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_EDGE_PX = 152;

/** Room a full mini calendar tooltip needs above its day; with less, and more room below, it opens below the day. */
export const MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_MAX_HEIGHT_PX = 220;

/** Room a calendar dialog chip tooltip (title and detail) needs above its chip; with less it opens below. */
export const MEETINGS_HOME_CALENDAR_CHIP_TOOLTIP_HEIGHT_PX = 72;

/** Delay before a mini calendar tooltip closes once the pointer leaves its day, so the pointer can move onto it. */
export const MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_HIDE_MS = 120;

/** Gap between the sticky tabs bar and the first row of a day picked on the calendar. */
export const MEETINGS_HOME_DAY_SCROLL_OFFSET_PX = 36;

/** Wait before scrolling to a picked day, so its rows have rendered. */
export const MEETINGS_HOME_DAY_SCROLL_DELAY_MS = 120;

/** Meeting types of the calendar dialog's legend, in order, with their chip colour; any other type uses the last. */
export const MEETINGS_HOME_CALENDAR_TYPE_COLORS: readonly MeetingCalendarTypeColor[] = [
  { type: 'Board', color: 'var(--ui-danger-500)' },
  { type: 'Maintainers', color: 'var(--ui-accent-500)' },
  { type: 'Marketing', color: 'var(--ui-success-500)' },
  { type: 'Technical', color: 'var(--ui-feature-500)' },
  { type: 'Legal', color: 'var(--ui-warning-500)' },
  { type: 'Other', color: 'var(--ui-neutral-500)' },
];

/** Weekday names of the calendar dialog, Sunday first. */
export const MEETINGS_HOME_CALENDAR_WEEKDAY_NAMES: readonly string[] = RECURRENCE_DAYS_OF_WEEK.map((day) => day.label);

/** Height of one hour in the calendar dialog's week view. */
export const MEETINGS_HOME_CALENDAR_HOUR_PX = 48;

/** Least height a week view event is drawn at, so its time stays readable. */
export const MEETINGS_HOME_CALENDAR_EVENT_MIN_HEIGHT_PX = 22;

/** Hour the week view opens scrolled to. */
export const MEETINGS_HOME_CALENDAR_START_HOUR = 8;

/** Chips a month view cell shows before "+N more". */
export const MEETINGS_HOME_CALENDAR_MONTH_CHIPS = 3;
