// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingType } from '../enums';
import { isShowMeetingAttendeesLocked } from './meeting-attendee-lock.utils';

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
