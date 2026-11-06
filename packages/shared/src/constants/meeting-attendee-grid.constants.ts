// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingAttendeeStatus, MeetingAttendeeStatusInfo, RsvpResponse } from '../interfaces';

/** Rows of avatars the attendee grid shows before it fades and offers "View all". */
export const MEETING_ATTENDEE_GRID_MAX_ROWS = 2;

/** Grid and stats order: upcoming Yes → Maybe → No → No response, past Attended → Absent. */
export const MEETING_ATTENDEE_STATUS_ORDER: readonly MeetingAttendeeStatus[] = ['yes', 'maybe', 'no', 'no_response', 'attended', 'absent'];

/** Attendee status for each RSVP answer; no answer is `no_response`. */
export const MEETING_ATTENDEE_RSVP_STATUS: Record<RsvpResponse, MeetingAttendeeStatus> = {
  accepted: 'yes',
  maybe: 'maybe',
  declined: 'no',
};

/** Label and dot fills per attendee status. */
export const MEETING_ATTENDEE_STATUS_INFO: Record<MeetingAttendeeStatus, MeetingAttendeeStatusInfo> = {
  yes: { label: 'Yes', dotClass: 'bg-emerald-500', legendDotClass: 'bg-emerald-500' },
  maybe: { label: 'Maybe', dotClass: 'bg-amber-500', legendDotClass: 'bg-amber-500' },
  no: { label: 'No', dotClass: 'bg-red-500', legendDotClass: 'bg-red-500' },
  no_response: { label: 'No response', dotClass: 'bg-gray-400', legendDotClass: 'bg-gray-300' },
  attended: { label: 'Attended', dotClass: 'bg-emerald-500', legendDotClass: 'bg-emerald-500' },
  absent: { label: 'Absent', dotClass: 'bg-red-500', legendDotClass: 'bg-red-500' },
};
