// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingType } from '../enums';
import type { Meeting } from '../interfaces';
import { getSavedAttendeeVisibility, isMeetingAttendeeListShared, isShowMeetingAttendeesLocked } from './meeting-attendee-lock.utils';

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

  it('leaves restricted meetings unlocked by default — sharing is the organizer\'s choice', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, true)).toBe(false);
  });

  it('still locks a restricted meeting of any type under the pre-v2 rule', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, true, { restrictedLocks: true })).toBe(true);
  });

  it('locks a restricted meeting whose flag arrived as a string under the pre-v2 rule', () => {
    // Nothing coerces this field between v1 and here, so a stringified boolean must not
    // fail open on the one branch that is meant to be strictest. The same casing and
    // whitespace variance that meeting_type has to absorb applies here too.
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, 'true', { restrictedLocks: true })).toBe(true);
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, 'True', { restrictedLocks: true })).toBe(true);
    expect(isShowMeetingAttendeesLocked(MeetingType.TECHNICAL, ' TRUE ', { restrictedLocks: true })).toBe(true);
  });

  it('keeps a restricted Board meeting locked either way', () => {
    expect(isShowMeetingAttendeesLocked(MeetingType.BOARD, true)).toBe(true);
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
    expect(getSavedAttendeeVisibility(meeting({ meeting_type: MeetingType.BOARD, show_meeting_attendees: false }))).toBeNull();
    expect(getSavedAttendeeVisibility(meeting({ restricted: true, show_meeting_attendees: true }), { restrictedLocks: true })).toBeNull();
  });

  it("reports a restricted meeting's saved decision under the current rule", () => {
    expect(getSavedAttendeeVisibility(meeting({ restricted: true, show_meeting_attendees: true }))).toBe(true);
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

  it('keeps a locked meeting private even when a legacy row still carries the opt-in', () => {
    expect(isMeetingAttendeeListShared(meeting({ meeting_type: MeetingType.BOARD, show_meeting_attendees: true }))).toBe(false);
  });

  it('shares a restricted meeting\'s guest list when its organizer opted in', () => {
    expect(isMeetingAttendeeListShared(meeting({ restricted: true, show_meeting_attendees: true }))).toBe(true);
    expect(isMeetingAttendeeListShared(meeting({ restricted: true, show_meeting_attendees: false }))).toBe(false);
  });
});
