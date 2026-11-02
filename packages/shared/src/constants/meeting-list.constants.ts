// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibilityKind } from '../enums';
import type { MeetingResponseFilterOption, MeetingsHomeFilters, MeetingVisibilityInfo } from '../interfaces';

/** Rows the meetings home list loads per page. */
export const MEETINGS_HOME_PAGE_SIZE = 20;

/** Filters with nothing applied. */
export const MEETINGS_HOME_DEFAULT_FILTERS: MeetingsHomeFilters = {
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

/** Applied-filter chip copy. */
export const MEETINGS_HOME_FILTER_CHIP_LABELS = {
  project: 'Project',
  meetingType: 'Meeting type',
  rsvp: 'RSVP',
  organizedByMe: 'Organized by me',
  hideDeclined: 'Hiding declined series',
} as const;

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
