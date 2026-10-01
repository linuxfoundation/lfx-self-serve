// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// isHostKeyVisibleForJoinWindow pulls meeting.utils, which transitively imports
// @angular/common/http (HttpParams) — its declarations need the Angular JIT compiler when loaded
// outside an Angular bootstrap (as under Vitest). Importing the compiler first provides that facade.
import '@angular/compiler';

import { FormControl, FormGroup } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingType, MeetingVisibility } from '../enums';
import type { Meeting } from '../interfaces';
import { syncShowMeetingAttendeesLock } from './form.utils';
import { getMeetingPrivacyIcon, getMeetingPrivacyLabel, isHostKeyVisible, isHostKeyVisibleForJoinWindow, isWithinHostKeyWindow } from './meeting-privacy.utils';

describe('getMeetingPrivacyLabel', () => {
  it('returns "Public" for public + unrestricted', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PUBLIC, false)).toBe('Public');
  });

  it('returns "Private" for private + unrestricted', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PRIVATE, false)).toBe('Private');
  });

  it('returns "Private (Restricted)" for private + restricted', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PRIVATE, true)).toBe('Private (Restricted)');
  });

  it('returns "Public" when visibility is null', () => {
    expect(getMeetingPrivacyLabel(null, false)).toBe('Public');
  });

  it('returns "Public" when both fields are null', () => {
    expect(getMeetingPrivacyLabel(null, null)).toBe('Public');
  });

  it('returns "Public (Restricted)" for public + restricted (edge case)', () => {
    expect(getMeetingPrivacyLabel(MeetingVisibility.PUBLIC, true)).toBe('Public (Restricted)');
  });
});

describe('getMeetingPrivacyIcon', () => {
  it('returns globe icon for public + unrestricted', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PUBLIC, false)).toBe('fa-light fa-globe');
  });

  it('returns shield icon for private + unrestricted', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PRIVATE, false)).toBe('fa-light fa-shield');
  });

  it('returns lock icon when restricted is true', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PRIVATE, true)).toBe('fa-light fa-lock');
  });

  it('returns lock icon when public + restricted (edge case)', () => {
    expect(getMeetingPrivacyIcon(MeetingVisibility.PUBLIC, true)).toBe('fa-light fa-lock');
  });
});

describe('isHostKeyVisible', () => {
  it('is true when the viewer is authorized and a key is present', () => {
    expect(isHostKeyVisible({ can_view_host_key: true, host_key: '123456' })).toBe(true);
  });

  it('is false when authorized but no key was supplied', () => {
    expect(isHostKeyVisible({ can_view_host_key: true, host_key: undefined })).toBe(false);
    expect(isHostKeyVisible({ can_view_host_key: true, host_key: '' })).toBe(false);
  });

  it('is false when a key is present but the viewer is not authorized (defense in depth)', () => {
    expect(isHostKeyVisible({ can_view_host_key: false, host_key: '123456' })).toBe(false);
    expect(isHostKeyVisible({ host_key: '123456' })).toBe(false);
  });

  it('is false for null/undefined meetings', () => {
    expect(isHostKeyVisible(null)).toBe(false);
    expect(isHostKeyVisible(undefined)).toBe(false);
  });
});

describe('isHostKeyVisibleForJoinWindow', () => {
  // Fixed meeting: starts 12:00Z, 60 min long, 10 min early-join.
  // Join window (per canJoinMeeting) = [11:50Z, 13:40Z] (end + 40 min buffer).
  const START = '2026-01-01T12:00:00.000Z';

  function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
    return {
      start_time: START,
      duration: 60,
      early_join_time_minutes: 10,
      can_view_host_key: true,
      host_key: '123456',
      ...overrides,
    } as Meeting;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is hidden before the early-join window opens', () => {
    vi.setSystemTime(new Date('2026-01-01T11:00:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(false);
  });

  it('is visible during the early-join window (before start)', () => {
    vi.setSystemTime(new Date('2026-01-01T11:55:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(true);
  });

  it('is visible while the meeting is in progress', () => {
    vi.setSystemTime(new Date('2026-01-01T12:30:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(true);
  });

  it('is hidden after the meeting ends', () => {
    vi.setSystemTime(new Date('2026-01-01T14:00:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting())).toBe(false);
  });

  it('is hidden inside the window when the viewer is not authorized', () => {
    vi.setSystemTime(new Date('2026-01-01T12:30:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting({ can_view_host_key: false }))).toBe(false);
  });

  it('is hidden inside the window when no host_key was supplied', () => {
    vi.setSystemTime(new Date('2026-01-01T12:30:00.000Z'));
    expect(isHostKeyVisibleForJoinWindow(buildMeeting({ host_key: undefined }))).toBe(false);
  });

  it('is false for null/undefined meetings', () => {
    expect(isHostKeyVisibleForJoinWindow(null)).toBe(false);
    expect(isHostKeyVisibleForJoinWindow(undefined)).toBe(false);
  });
});

describe('isWithinHostKeyWindow', () => {
  const MIN = 60_000;
  // Pin a fixed reference point so boundary assertions are fully deterministic.
  const NOW = new Date('2025-06-01T12:00:00.000Z');
  const nowMs = NOW.getTime();

  function iso(offsetMs: number): string {
    return new Date(nowMs + offsetMs).toISOString();
  }

  it('returns true when now is exactly at the window start (start_time − 70 min)', () => {
    // start_time = now + 70 min → windowStart = now exactly
    expect(isWithinHostKeyWindow({ start_time: iso(70 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns false when now is one ms before the window start', () => {
    const oneMsBefore = new Date(nowMs - 1);
    expect(isWithinHostKeyWindow({ start_time: iso(70 * MIN), duration: 60 }, oneMsBefore)).toBe(false);
  });

  it('returns true during the meeting itself', () => {
    // start_time = 15 min ago; now is 15 min past start, well inside window
    expect(isWithinHostKeyWindow({ start_time: iso(-15 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns true up to 40 min after meeting end', () => {
    // start_time = 90 min ago, duration = 60 → end = 30 min ago, tail ends at now + 10 min
    expect(isWithinHostKeyWindow({ start_time: iso(-90 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns false when now is exactly at the window end (start + duration + 40 min)', () => {
    // windowEnd = start + 60 + 40 = now → exclusive upper bound, must be false
    expect(isWithinHostKeyWindow({ start_time: iso(-(60 + 40) * MIN), duration: 60 }, NOW)).toBe(false);
  });

  it('returns false when now is just past the window end', () => {
    expect(isWithinHostKeyWindow({ start_time: iso(-(60 + 41) * MIN), duration: 60 }, NOW)).toBe(false);
  });

  it('returns false when the meeting is more than 70 min away', () => {
    expect(isWithinHostKeyWindow({ start_time: iso(71 * MIN), duration: 60 }, NOW)).toBe(false);
  });

  it('prefers next_occurrence_start_time over start_time for recurring meetings', () => {
    // series start_time is 30 days in the past (window long closed)
    // next_occurrence_start_time is 30 min from now (inside window)
    expect(
      isWithinHostKeyWindow(
        {
          start_time: iso(-30 * 24 * 60 * MIN),
          next_occurrence_start_time: iso(30 * MIN),
          duration: 60,
        },
        NOW
      )
    ).toBe(true);
  });

  it('falls back to start_time when next_occurrence_start_time is absent', () => {
    // start_time is 30 min from now — inside window
    expect(isWithinHostKeyWindow({ start_time: iso(30 * MIN), duration: 60 }, NOW)).toBe(true);
  });

  it('returns false when start_time is absent', () => {
    expect(isWithinHostKeyWindow({ start_time: '', duration: 60 }, NOW)).toBe(false);
  });

  it('returns false when start_time is not a valid date', () => {
    expect(isWithinHostKeyWindow({ start_time: 'not-a-date', duration: 60 }, NOW)).toBe(false);
  });
});

describe('syncShowMeetingAttendeesLock', () => {
  const buildForm = (meetingType: string, restricted: boolean, showAttendees: boolean) =>
    new FormGroup({
      meeting_type: new FormControl(meetingType),
      restricted: new FormControl(restricted),
      show_meeting_attendees: new FormControl(showAttendees),
    });

  it('disables and clears the control for board meetings', () => {
    const form = buildForm(MeetingType.BOARD, false, true);
    syncShowMeetingAttendeesLock(form);
    expect(form.get('show_meeting_attendees')?.disabled).toBe(true);
    expect(form.get('show_meeting_attendees')?.value).toBe(false);
  });

  it('re-enables the control when leaving a locked state', () => {
    const form = buildForm(MeetingType.BOARD, false, false);
    syncShowMeetingAttendeesLock(form);
    form.get('meeting_type')?.setValue(MeetingType.TECHNICAL);
    syncShowMeetingAttendeesLock(form);
    expect(form.get('show_meeting_attendees')?.enabled).toBe(true);
  });
});
