// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibilityKind } from '../enums';
import type { MeetingHomeArtifact, MeetingResponseFilterOption, MeetingRsvpChoice, MeetingsHomeFilters, MeetingVisibilityInfo } from '../interfaces';

/** The AI summary of a past meetings home row. */
export const MEETINGS_HOME_SUMMARY_ARTIFACT: MeetingHomeArtifact = { noun: 'summary', title: 'AI Summary' };

/** Rows the meetings home list loads per page. */
export const MEETINGS_HOME_PAGE_SIZE = 20;

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
  { response: 'accepted', action: 'Yes', label: 'Going', icon: 'fa-solid fa-circle-check', tone: 'accent' },
  { response: 'declined', action: 'No', label: 'Not going', icon: 'fa-solid fa-circle-xmark', tone: 'danger' },
  { response: 'maybe', action: 'Maybe', label: 'Maybe', icon: 'fa-solid fa-circle-question', tone: 'warning' },
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
