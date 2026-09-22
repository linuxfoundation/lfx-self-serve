// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SHOW_MEETING_ATTENDEES_LOCKED_NOTE } from '../constants/meeting.constants';
import { MeetingType, MeetingVisibility } from '../enums';
import type { Meeting, MeetingOccurrence } from '../interfaces';
import { canJoinMeeting } from './meeting.utils';

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

/**
 * Returns a human-readable label for the combined meeting privacy state.
 * @description Maps the two independent privacy fields (`visibility` + `restricted`)
 * to a single display string matching the PCC privacy matrix:
 * - Public + unrestricted → "Public"
 * - Private + unrestricted → "Private"
 * - Private + restricted  → "Private (Restricted)"
 * - Public + restricted   → "Public (Restricted)"
 */
export function getMeetingPrivacyLabel(visibility: MeetingVisibility | null, restricted: boolean | null): string {
  if (visibility === MeetingVisibility.PRIVATE && restricted) {
    return 'Private (Restricted)';
  }
  if (restricted) {
    return 'Public (Restricted)';
  }
  if (visibility === MeetingVisibility.PRIVATE) {
    return 'Private';
  }
  return 'Public';
}

/**
 * Returns the Font Awesome icon class for the combined meeting privacy state.
 * @description Icon prioritizes restriction state over visibility: `restricted=true` always
 * shows a lock regardless of visibility, matching the PCC join-access model. This differs
 * from `getMeetingPrivacyLabel`, which prioritizes visibility in its primary branches.
 */
export function getMeetingPrivacyIcon(visibility: MeetingVisibility | null, restricted: boolean | null): string {
  if (restricted) {
    return 'fa-light fa-lock';
  }
  if (visibility === MeetingVisibility.PRIVATE) {
    return 'fa-light fa-shield';
  }
  return 'fa-light fa-globe';
}

/**
 * Whether the current viewer may see a meeting's Zoom host key.
 * @description The BFF is the single source of truth for the host-key audience
 * (organizer OR project writer OR committee writer): it sets `can_view_host_key` and strips
 * `host_key` for anyone unauthorized. The UI must not re-derive that audience — it renders the
 * host key only when the BFF both marks the viewer authorized AND supplies a key. Callers gate
 * on the meeting's join window separately (see {@link isHostKeyVisibleForJoinWindow}).
 */
export function isHostKeyVisible(meeting: Pick<Meeting, 'host_key' | 'can_view_host_key'> | null | undefined): boolean {
  return !!meeting?.can_view_host_key && !!meeting?.host_key;
}

/**
 * Whether the host-key chip should render on the meeting detail/join page.
 * @description Combines the authorization gate ({@link isHostKeyVisible}) with the meeting's
 * join window: the chip renders only from the early-join time (`start − early_join_time_minutes`)
 * through the end of the meeting — the exact same window as the Join button and the early-join
 * banner ({@link canJoinMeeting}), not merely "any upcoming meeting".
 *
 * Rationale: Zoom host keys belong to the shared license account and may be rotated per
 * occurrence, so displaying the key before the meeting is joinable is both wider exposure and
 * potentially stale. Gating on the join window mirrors PCC's posture.
 */
export function isHostKeyVisibleForJoinWindow(meeting: Meeting | null | undefined, occurrence?: MeetingOccurrence | null): boolean {
  return !!meeting && canJoinMeeting(meeting, occurrence) && isHostKeyVisible(meeting);
}
