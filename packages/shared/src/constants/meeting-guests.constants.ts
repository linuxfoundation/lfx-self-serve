// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberVotingStatus } from '../enums';
import type { MeetingGuestFilters, MeetingGuestRoleKey, MeetingGuestStatusKey, UiAvatarStatus } from '../interfaces';

/** Section and filter key for people invited directly rather than through a committee. */
export const MEETING_GUEST_DIRECT_GROUP = 'direct';

export const MEETING_GUEST_EMPTY_FILTERS: MeetingGuestFilters = { status: null, role: null, invite: null, group: null, voting: null };

/** Filter label and avatar status circle of each guest status. */
export const MEETING_GUEST_STATUSES: Record<MeetingGuestStatusKey, { label: string; badge: UiAvatarStatus }> = {
  yes: { label: 'Yes', badge: { icon: 'fa-solid fa-check', tone: 'success', label: 'RSVP: Yes' } },
  maybe: { label: 'Maybe', badge: { icon: 'fa-solid fa-question', tone: 'warning', label: 'RSVP: Maybe' } },
  no: { label: 'No', badge: { icon: 'fa-solid fa-xmark', tone: 'danger', label: 'RSVP: No' } },
  pending: { label: 'No response', badge: { icon: 'fa-solid fa-ellipsis', tone: 'neutral', label: 'RSVP: No response' } },
  attended: { label: 'Attended', badge: { icon: 'fa-solid fa-check', tone: 'success', label: 'Attended' } },
  absent: { label: 'Absent', badge: { icon: 'fa-solid fa-xmark', tone: 'danger', label: 'Absent' } },
};

export const MEETING_GUEST_ROLE_LABELS: Record<MeetingGuestRoleKey, string> = { organizer: 'Organizer', host: 'Host', guest: 'Guest' };

/** Voting statuses the Voting Reps filter keeps. */
export const MEETING_GUEST_VOTING_REP_STATUSES: readonly string[] = [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP];

/** Voting statuses not shown on a guest row. */
export const MEETING_GUEST_HIDDEN_VOTING_STATUSES: readonly string[] = [CommitteeMemberVotingStatus.OBSERVER, CommitteeMemberVotingStatus.NONE];
