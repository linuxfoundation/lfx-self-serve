// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils (imported by the builder) transitively loads @angular/common/http, which needs the JIT compiler under Vitest.
import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Meeting, MeetingCalendarEvent } from '../interfaces/meeting.interface';
import {
  buildGoogleCalendarUrl,
  buildMeetingCalendarDescription,
  buildMeetingIcsFileName,
  formatCalendarUtc,
  resolveMeetingCalendarOccurrence,
} from './meeting-ics.utils';

const NOW = new Date('2026-11-02T20:00:00Z');

const FIXTURE: MeetingCalendarEvent = {
  uid: '92867066227',
  title: 'Technical Steering Committee',
  start: '2026-11-05T11:00:00-08:00',
  durationMinutes: 60,
  projectName: 'Example Project',
  joinUrl: 'https://app.lfx.dev/meetings/92867066227',
};

function meeting(overrides: Partial<Meeting>): Meeting {
  return { id: '1', title: 'T', start_time: '2026-11-05T19:00:00Z', duration: 60, timezone: 'America/Los_Angeles', ...overrides } as Meeting;
}

describe('resolveMeetingCalendarOccurrence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('uses the meeting start for a one-time meeting', () => {
    expect(resolveMeetingCalendarOccurrence(meeting({}))).toEqual({ start: '2026-11-05T19:00:00Z', durationMinutes: 60, occurrenceId: null });
  });

  it('resolves a recurring meeting to its next active occurrence, not the series start', () => {
    const m = meeting({
      start_time: '2026-01-01T19:00:00Z',
      occurrences: [
        { occurrence_id: 'a', start_time: '2026-10-29T19:00:00Z', duration: 30 },
        { occurrence_id: 'b', start_time: '2026-11-03T19:00:00Z', duration: 45, status: 'cancel' },
        { occurrence_id: 'c', start_time: '2026-11-10T19:00:00Z', duration: 45 },
      ],
    });
    expect(resolveMeetingCalendarOccurrence(m)).toEqual({ start: '2026-11-10T19:00:00Z', durationMinutes: 45, occurrenceId: 'c' });
  });

  it('honours an explicit occurrence that matches an active occurrence', () => {
    const m = meeting({
      occurrences: [
        { occurrence_id: 'a', start_time: '2026-11-03T19:00:00Z', duration: 30 },
        { occurrence_id: 'b', start_time: '2026-11-10T19:00:00Z', duration: 45 },
      ],
    });
    expect(resolveMeetingCalendarOccurrence(m, Date.parse('2026-11-10T19:00:00Z'))?.start).toBe('2026-11-10T19:00:00Z');
    expect(resolveMeetingCalendarOccurrence(m, 12345)?.start).toBe('2026-11-03T19:00:00Z');
  });

  it('returns null when a recurring meeting has no remaining occurrence', () => {
    const m = meeting({ occurrences: [{ occurrence_id: 'a', start_time: '2026-10-01T19:00:00Z', duration: 30 }] });
    expect(resolveMeetingCalendarOccurrence(m)).toBeNull();
  });

  it('returns null for an unusable start and defaults a missing duration to an hour', () => {
    expect(resolveMeetingCalendarOccurrence(meeting({ start_time: '' }))).toBeNull();
    expect(resolveMeetingCalendarOccurrence(meeting({ duration: 0 }))?.durationMinutes).toBe(60);
  });
});

describe('buildGoogleCalendarUrl', () => {
  it('builds a prefilled template URL from the same fields', () => {
    const url = new URL(buildGoogleCalendarUrl(FIXTURE));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(FIXTURE.title);
    expect(url.searchParams.get('dates')).toBe('20261105T190000Z/20261105T200000Z');
    expect(url.searchParams.get('details')).toBe('Example Project\nhttps://app.lfx.dev/meetings/92867066227');
  });

  it('throws on an invalid start', () => {
    expect(() => buildGoogleCalendarUrl({ ...FIXTURE, start: 'x' })).toThrow(RangeError);
  });
});

describe('buildMeetingCalendarDescription', () => {
  it('joins the project name and page URL, skipping a missing project', () => {
    expect(buildMeetingCalendarDescription(FIXTURE)).toBe('Example Project\nhttps://app.lfx.dev/meetings/92867066227');
    expect(buildMeetingCalendarDescription({ ...FIXTURE, projectName: ' ' })).toBe('https://app.lfx.dev/meetings/92867066227');
  });
});

describe('buildMeetingIcsFileName / formatCalendarUtc', () => {
  it('slugs the title and never returns an empty name', () => {
    expect(buildMeetingIcsFileName('TSC: Weekly Sync / Q4')).toBe('tsc-weekly-sync-q4.ics');
    expect(buildMeetingIcsFileName('!!!')).toBe('meeting.ics');
    expect(buildMeetingIcsFileName('')).toBe('meeting.ics');
  });

  it('formats an instant without separators or milliseconds', () => {
    expect(formatCalendarUtc(Date.parse('2026-11-05T19:00:00.123Z'))).toBe('20261105T190000Z');
  });
});
