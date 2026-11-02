// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils (imported by the builder) transitively loads @angular/common/http, which needs the JIT compiler under Vitest.
import '@angular/compiler';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Meeting, MeetingCalendarEvent } from '../interfaces/meeting.interface';
import { buildGoogleCalendarUrl, buildMeetingIcs, buildMeetingIcsFileName, formatCalendarUtc, resolveMeetingCalendarOccurrence } from './meeting-ics.utils';

const NOW = new Date('2026-11-02T20:00:00Z');

const FIXTURE: MeetingCalendarEvent = {
  uid: '92867066227',
  title: 'Technical Steering Committee',
  start: '2026-11-05T11:00:00-08:00',
  durationMinutes: 60,
  projectName: 'Example Project',
  joinUrl: 'https://app.lfx.dev/meetings/92867066227',
};

/** Minimal RFC 5545 reader: unfolds lines and returns the VEVENT properties. */
function parseIcs(ics: string): { lines: string[]; props: Record<string, string> } {
  expect(ics.endsWith('\r\n')).toBe(true);
  const unfolded = ics
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter(Boolean);
  const props: Record<string, string> = {};
  for (const line of unfolded) {
    const idx = line.indexOf(':');
    props[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return { lines: unfolded, props };
}

function meeting(overrides: Partial<Meeting>): Meeting {
  return { id: '1', title: 'T', start_time: '2026-11-05T19:00:00Z', duration: 60, timezone: 'America/Los_Angeles', ...overrides } as Meeting;
}

describe('buildMeetingIcs', () => {
  it('emits one VEVENT with UTC instants converted from the start offset', () => {
    const { lines, props } = parseIcs(buildMeetingIcs(FIXTURE, NOW));

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(props['UID']).toBe('92867066227@lfx.dev');
    expect(props['DTSTAMP']).toBe('20261102T200000Z');
    expect(props['DTSTART']).toBe('20261105T190000Z');
    expect(props['DTEND']).toBe('20261105T200000Z');
    expect(props['SUMMARY']).toBe('Technical Steering Committee');
    expect(props['URL']).toBe('https://app.lfx.dev/meetings/92867066227');
    expect(props['DESCRIPTION']).toBe('Example Project\\nhttps://app.lfx.dev/meetings/92867066227');
  });

  it('emits neither VTIMEZONE nor RRULE', () => {
    const ics = buildMeetingIcs(FIXTURE, NOW);
    expect(ics).not.toMatch(/VTIMEZONE|RRULE|TZID/);
  });

  it('resolves the same wall-clock hour to different UTC instants either side of the US DST change', () => {
    // 2026-11-01 02:00 PDT falls back to 01:00 PST: 09:00 local is -07:00 the day before and -08:00 the day after.
    const before = parseIcs(buildMeetingIcs({ ...FIXTURE, start: '2026-10-31T09:00:00-07:00' }, NOW)).props['DTSTART'];
    const after = parseIcs(buildMeetingIcs({ ...FIXTURE, start: '2026-11-02T09:00:00-08:00' }, NOW)).props['DTSTART'];
    expect(before).toBe('20261031T160000Z');
    expect(after).toBe('20261102T170000Z');
  });

  it('crosses midnight and month boundaries in DTEND', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, start: '2026-12-31T23:30:00Z', durationMinutes: 90 }, NOW));
    expect(props['DTSTART']).toBe('20261231T233000Z');
    expect(props['DTEND']).toBe('20270101T010000Z');
  });

  it('escapes TEXT and cannot be injected with extra properties', () => {
    const ics = buildMeetingIcs({ ...FIXTURE, title: 'A, B; C\\D\r\nATTENDEE:mailto:x@example.com', projectName: 'P\nDTSTART:19700101T000000Z' }, NOW);
    const { lines, props } = parseIcs(ics);
    expect(props['SUMMARY']).toBe('A\\, B\\; C\\\\D\\nATTENDEE:mailto:x@example.com');
    expect(lines.some((l) => l.startsWith('ATTENDEE'))).toBe(false);
    expect(lines.filter((l) => l.startsWith('DTSTART'))).toHaveLength(1);
  });

  it('escapes a semicolon in TEXT as backslash-semicolon (RFC 5545 section 3.3.11)', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, title: 'TSC; Weekly' }, NOW));
    expect(props['SUMMARY']).toBe(String.raw`TSC\; Weekly`);
  });

  it('folds long lines at 75 octets without splitting multi-byte characters', () => {
    const title = 'Ünïcødé 会議 '.repeat(20);
    const ics = buildMeetingIcs({ ...FIXTURE, title }, NOW);
    const encoder = new TextEncoder();
    for (const physical of ics.split('\r\n')) {
      expect(encoder.encode(physical).length).toBeLessThanOrEqual(75);
    }
    expect(parseIcs(ics).props['SUMMARY']).toBe(title);
  });

  it('strips control characters from the URL value', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, joinUrl: 'https://app.lfx.dev/meetings/1\r\nX-EVIL:1' }, NOW));
    expect(props['URL']).toBe('https://app.lfx.dev/meetings/1X-EVIL:1');
    expect(props['X-EVIL']).toBeUndefined();
  });

  it('omits the project line when the project name is unknown', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, projectName: null }, NOW));
    expect(props['DESCRIPTION']).toBe('https://app.lfx.dev/meetings/92867066227');
  });

  it('gives each recurring occurrence its own UID so downloads do not overwrite one another', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, occurrenceId: '1762369200' }, NOW));
    expect(props['UID']).toBe('92867066227-1762369200@lfx.dev');
  });

  it('strips non-printing control characters from TEXT values', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, title: 'A\u0000B\u0007C\tD' }, NOW));
    expect(props['SUMMARY']).toBe('ABC\tD');
  });

  it('throws on an invalid start', () => {
    expect(() => buildMeetingIcs({ ...FIXTURE, start: 'nope' }, NOW)).toThrow(RangeError);
  });

  it('never carries registrant, passcode, host-key or Zoom fields (the input type has no slot for them)', () => {
    const ics = buildMeetingIcs(FIXTURE, NOW);
    expect(ics).not.toMatch(/zoom|passcode|password|host_key|ATTENDEE|ORGANIZER/i);
  });
});

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
