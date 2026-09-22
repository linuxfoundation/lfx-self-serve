// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SHOW_MEETING_ATTENDEES_LOCKED_NOTE } from '../constants/meeting.constants';
import { MeetingType } from '../enums';

/**
 * Whether the show-attendees-in-calendar-invites toggle is locked off.
 * @description Locked for `meeting_type === Board` or `restricted === true` (invite-only).
 * `visibility === private` is a separate axis and is not locked here — a private unrestricted
 * meeting can still share its guest list in invites if the organizer opts in. The lock tracks
 * the meeting's current type and restricted flag on each write; changing `meeting_type` away
 * from Board lifts it. A Board meeting stays locked if the organizer only turns `restricted`
 * off.
 *
 * Both inputs are normalized, because neither is schema-validated on the way in: they reach us
 * from v1 through the ITX proxy, which does not normalize casing, trim, or coerce types. A
 * stored `"board"`, a request body carrying `"Board "`, and a stringified `"true"` for
 * `restricted` all have to lock the same as their canonical forms — failing open on any of
 * those differences would share exactly the guest list this guards.
 *
 * Values outside the declared contract come from an unvalidated request body, so they are read
 * defensively rather than trusted: a non-string `meeting_type` is compared as "not Board"
 * instead of being passed to `.trim()` (which would turn a malformed body into a 500 on the
 * BFF), and a non-string `restricted` locks on anything truthy.
 *
 * This lives apart from the other meeting-privacy helpers because the BFF enforces the same
 * rule on write: everything here imports enums and constants only, so the server can load the
 * real predicate — in tests as well as at runtime — without pulling `@angular/common/http` in
 * through `meeting.utils`.
 */
export function isShowMeetingAttendeesLocked(meetingType: string | null | undefined, restricted: boolean | string | null | undefined): boolean {
  const restrictedValue = typeof restricted === 'string' ? restricted.trim().toLowerCase() === 'true' : !!restricted;
  if (restrictedValue) {
    return true;
  }
  if (typeof meetingType !== 'string') {
    return false;
  }
  return meetingType.trim().toLowerCase() === MeetingType.BOARD.toLowerCase();
}

/**
 * The note explaining why the attendees toggle is unavailable, or `null` when it is available.
 * @description Both surfaces that render the toggle — the composer's Guests section and the
 * manage page's registrants manager — show the same note under the same condition, so the
 * condition and the copy live together here rather than being restated in each component.
 */
export function getShowMeetingAttendeesLockedNote(meetingType: string | null | undefined, restricted: boolean | string | null | undefined): string | null {
  return isShowMeetingAttendeesLocked(meetingType, restricted) ? SHOW_MEETING_ATTENDEES_LOCKED_NOTE : null;
}
