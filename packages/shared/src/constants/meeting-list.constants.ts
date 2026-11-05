// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibilityKind } from '../enums';
import type {
  MeetingDetailsFeature,
  MeetingHomeArtifact,
  MeetingHomeAttendanceKind,
  MeetingJoinLink,
  MeetingResponseFilterOption,
  MeetingRsvpChoice,
  MeetingsHomeFilters,
  MeetingVisibilityInfo,
  UiBadgeTone,
} from '../interfaces';

/** The AI summary of a past meetings home row. */
export const MEETINGS_HOME_SUMMARY_ARTIFACT: MeetingHomeArtifact = { noun: 'summary', title: 'AI Summary' };

/** Join link of a date with no request in flight and no failure. */
export const NO_MEETING_JOIN_LINK: MeetingJoinLink = { url: null, error: null, code: null };

/** Rows the meetings home list loads per page. */
export const MEETINGS_HOME_PAGE_SIZE = 20;

/** Gap in px between the tabs rule and a day heading; must match the day-group separator's -mt-[20px] and pt-[20px]. */
export const MEETINGS_HOME_DAY_HEADING_GAP_PX = 20;

/** Filters with nothing applied. */
export const MEETINGS_HOME_DEFAULT_FILTERS: MeetingsHomeFilters = {
  foundation: null,
  project: null,
  meetingType: null,
  rsvp: 'all',
  organizedByMe: false,
  hideDeclined: false,
};

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
  meetingType: 'Meeting type',
  rsvp: 'RSVP',
  organizedByMe: 'Organized by me',
  hideDeclined: 'Hiding declined series',
} as const;

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
