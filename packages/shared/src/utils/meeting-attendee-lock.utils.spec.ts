// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { COMPOSER_ATTENDEE_LOCK, SHOW_MEETING_ATTENDEES_BOARD_LOCKED_NOTE, SHOW_MEETING_ATTENDEES_LOCKED_NOTE } from '../constants/meeting.constants';
import { MeetingType } from '../enums';
import type { Meeting } from '../interfaces';
import {
  getSavedAttendeeVisibility,
  getShowMeetingAttendeesLockedNote,
  isMeetingAttendeeListShared,
  isShowMeetingAttendeesLocked,
  shouldPreserveStoredAttendeeVisibility,
} from './meeting-attendee-lock.utils';

describe('isShowMeetingAttendeesLocked', () => {
  it('locks board meetings even when unrestricted', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.BOARD, false)).toBe(true);
  });

  it('locks board meetings regardless of type casing', () => {
    expect(isShowMeetingAttendeesLocked('board', false)).toBe(true);
    expect(isShowMeetingAttendeesLocked('BOARD', false)).toBe(true);
  });

  it('locks board meetings submitted with surrounding whitespace', () => {
    // Nothing validates meeting_type before it is forwarded, so a direct API caller could
    // otherwise send "Board " and persist show_meeting_attendees on a board meeting.
    expect(isShowMeetingAttendeesLocked('Board ', false)).toBe(true);
    expect(isShowMeetingAttendeesLocked('  board\t', false)).toBe(true);
  });

  it('locks restricted meetings of any type', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, true)).toBe(true);
  });

  it('locks a restricted meeting whose flag arrived as a string', () => {
    // Nothing coerces this field between v1 and here, so a stringified boolean must not
    // fail open on the one branch that is meant to be strictest. The same casing and
    // whitespace variance that meeting_type has to absorb applies here too.
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, 'true')).toBe(true);
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, 'True')).toBe(true);
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, ' TRUE ')).toBe(true);
  });

  it('does not treat other strings as restricted', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, 'false')).toBe(false);
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, '')).toBe(false);
  });

  it('is unlocked for unrestricted non-board meetings', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, false)).toBe(false);
    expect(isShowMeetingAttendeesLocked('', false)).toBe(false);
    expect(isShowMeetingAttendeesLocked(null, null)).toBe(false);
  });

  it('does not lock private unrestricted non-board meetings', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.LEGAL, false)).toBe(false);
    expect(isShowMeetingAttendeesLocked(MeetingType.MAINTAINERS, false)).toBe(false);
  });
});

describe('getSavedAttendeeVisibility', () => {
  const meeting = (overrides: Partial<Meeting>) => ({ meeting_type: MeetingType.TECHNICAL, restricted: false, ...overrides }) as Meeting;

  it('has no decision to report for a meeting that does not exist yet', () => {
    expect(getSavedAttendeeVisibility(null)).toBeNull();
    expect(getSavedAttendeeVisibility(undefined)).toBeNull();
  });

  it('reads an omitted flag as off rather than as undecided', () => {
    // The upstream serializer drops the field when it is false, so absence is how a meeting the
    // organizer switched sharing off actually arrives. Reading it as undecided lets a group
    // default turn sharing back on for exactly those meetings.
    expect(getSavedAttendeeVisibility(meeting({ show_meeting_attendees: undefined }))).toBe(false);
    expect(getSavedAttendeeVisibility(meeting({ show_meeting_attendees: false }))).toBe(false);
  });

  it('reports a saved opt-in', () => {
    expect(getSavedAttendeeVisibility(meeting({ show_meeting_attendees: true }))).toBe(true);
  });

  it('reports no decision for a locked meeting, whatever it was saved with', () => {
    // Board rows written before the lock existed still carry `true`, and hydration shows their
    // toggle off. Neither value was the organizer's choice, so neither may be restored when they
    // later switch the meeting to an unlocked type.
    expect(getSavedAttendeeVisibility(meeting({ meeting_type: MeetingType.BOARD, show_meeting_attendees: true }))).toBeNull();
    expect(getSavedAttendeeVisibility(meeting({ restricted: true, show_meeting_attendees: true }))).toBeNull();
    expect(getSavedAttendeeVisibility(meeting({ meeting_type: MeetingType.BOARD, show_meeting_attendees: false }))).toBeNull();
  });

  it("reports a restricted meeting's stored choice under the composer lock, keeping board undecided", () => {
    expect(getSavedAttendeeVisibility(meeting({ restricted: true, show_meeting_attendees: true }), COMPOSER_ATTENDEE_LOCK)).toBe(true);
    expect(getSavedAttendeeVisibility(meeting({ restricted: true, show_meeting_attendees: undefined }), COMPOSER_ATTENDEE_LOCK)).toBe(false);
    expect(
      getSavedAttendeeVisibility(meeting({ meeting_type: MeetingType.BOARD, restricted: true, show_meeting_attendees: true }), COMPOSER_ATTENDEE_LOCK)
    ).toBeNull();
  });
});

describe('isMeetingAttendeeListShared', () => {
  const meeting = (overrides: Partial<Meeting>) => ({ meeting_type: MeetingType.TECHNICAL, restricted: false, ...overrides }) as Meeting;

  it('shares the list only when an unlocked meeting opted in', () => {
    expect(isMeetingAttendeeListShared(meeting({ show_meeting_attendees: true }))).toBe(true);
    expect(isMeetingAttendeeListShared(meeting({ show_meeting_attendees: false }))).toBe(false);
    expect(isMeetingAttendeeListShared(meeting({ show_meeting_attendees: undefined }))).toBe(false);
    expect(isMeetingAttendeeListShared(null)).toBe(false);
  });

  it('keeps a Board meeting private even when a legacy row still carries the opt-in', () => {
    expect(isMeetingAttendeeListShared(meeting({ meeting_type: MeetingType.BOARD, show_meeting_attendees: true }))).toBe(false);
    expect(isMeetingAttendeeListShared(meeting({ meeting_type: MeetingType.BOARD, restricted: true, show_meeting_attendees: true }))).toBe(false);
  });

  it('honours the opt-in on a restricted (invite-only) meeting, as the composer writes it (#5438)', () => {
    expect(isMeetingAttendeeListShared(meeting({ restricted: true, show_meeting_attendees: true }))).toBe(true);
    expect(isMeetingAttendeeListShared(meeting({ restricted: true, show_meeting_attendees: false }))).toBe(false);
  });
});

describe('allowRestricted (meeting v2 composer rule)', () => {
  const meeting = (overrides: Partial<Meeting>) => ({ meeting_type: MeetingType.TECHNICAL, restricted: false, ...overrides }) as Meeting;

  it('unlocks restricted meetings, keeps board locked', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, true, { allowRestricted: true })).toBe(false);
    expect(isShowMeetingAttendeesLocked(MeetingType.BOARD, true, { allowRestricted: true })).toBe(true);
  });

  it('leaves the default rule unchanged', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, true)).toBe(true);
    expect(getSavedAttendeeVisibility(meeting({ restricted: true, show_meeting_attendees: true }))).toBeNull();
  });

  it('shows the board-only note under the composer rule and the existing note otherwise', () => {
    expect(getShowMeetingAttendeesLockedNote(MeetingType.BOARD, false, { allowRestricted: true })).toBe(SHOW_MEETING_ATTENDEES_BOARD_LOCKED_NOTE);
    expect(getShowMeetingAttendeesLockedNote(MeetingType.TECHNICAL, true, { allowRestricted: true })).toBeNull();
    expect(getShowMeetingAttendeesLockedNote(MeetingType.TECHNICAL, true)).toBe(SHOW_MEETING_ATTENDEES_LOCKED_NOTE);
  });
});

describe('shouldPreserveStoredAttendeeVisibility (pre-v2 wizard save, #5438)', () => {
  it('preserves the stored value on an invite-only meeting that stays invite-only', () => {
    expect(shouldPreserveStoredAttendeeVisibility({ restricted: true }, MeetingType.TECHNICAL, true)).toBe(true);
    expect(shouldPreserveStoredAttendeeVisibility({ restricted: 'true' as unknown as boolean }, 'Other', 'true')).toBe(true);
  });

  it('writes the form value for a create, an open meeting, or an edit that turns restricted on', () => {
    expect(shouldPreserveStoredAttendeeVisibility(null, MeetingType.TECHNICAL, true)).toBe(false);
    expect(shouldPreserveStoredAttendeeVisibility({ restricted: false }, MeetingType.TECHNICAL, false)).toBe(false);
    expect(shouldPreserveStoredAttendeeVisibility({ restricted: false }, MeetingType.TECHNICAL, true)).toBe(false);
  });

  it('writes the form value when the meeting becomes Board or open', () => {
    expect(shouldPreserveStoredAttendeeVisibility({ restricted: true }, MeetingType.BOARD, true)).toBe(false);
    expect(shouldPreserveStoredAttendeeVisibility({ restricted: true }, MeetingType.TECHNICAL, false)).toBe(false);
  });
});
