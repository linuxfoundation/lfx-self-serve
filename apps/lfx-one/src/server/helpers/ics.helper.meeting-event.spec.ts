// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The real shared ICS util transitively loads @angular/common/http, which needs the JIT compiler under Vitest.
import '@angular/compiler';

import type { MeetingCalendarEvent } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));
// The `@lfx-one/shared/*` alias isn't wired into vitest: point the barrel at the real implementation file.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/meeting-ics.utils')),
  addMinutesToDate: vi.fn(),
}));

const { buildMeetingIcs, buildMeetingVEvent } = await import('./ics.helper');

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

describe('buildMeetingIcs', () => {
  it('emits one VEVENT with UTC instants converted from the start offset', () => {
    const { lines, props } = parseIcs(buildMeetingIcs(FIXTURE, NOW));

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(props['UID']).toBe('92867066227@lfx.linuxfoundation.org');
    expect(props['DTSTAMP']).toBe('20261102T200000Z');
    expect(props['DTSTART']).toBe('20261105T190000Z');
    expect(props['DTEND']).toBe('20261105T200000Z');
    expect(props['SUMMARY']).toBe('Technical Steering Committee');
    expect(props['URL']).toBe('https://app.lfx.dev/meetings/92867066227');
    expect(props['DESCRIPTION']).toBe('Example Project\\nhttps://app.lfx.dev/meetings/92867066227');
  });

  it('emits neither VTIMEZONE nor RRULE', () => {
    expect(buildMeetingIcs(FIXTURE, NOW)).not.toMatch(/VTIMEZONE|RRULE|TZID/);
  });

  it('resolves the same wall-clock hour to different UTC instants either side of the US DST change', () => {
    // 2026-11-01 02:00 PDT falls back to 01:00 PST: 09:00 local is -07:00 the day before and -08:00 the day after.
    const before = parseIcs(buildMeetingIcs({ ...FIXTURE, start: '2026-10-31T09:00:00-07:00' }, NOW)).props['DTSTART'];
    const after = parseIcs(buildMeetingIcs({ ...FIXTURE, start: '2026-11-02T09:00:00-08:00' }, NOW)).props['DTSTART'];
    expect(before).toBe('20261031T160000Z');
    expect(after).toBe('20261102T170000Z');
  });

  it('adds the duration to the instant (not to wall-clock time), crossing midnight and year boundaries', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, start: '2026-12-31T23:30:00Z', durationMinutes: 90 }, NOW));
    expect(props['DTSTART']).toBe('20261231T233000Z');
    expect(props['DTEND']).toBe('20270101T010000Z');
  });

  it('gives each recurring occurrence its own UID so downloads do not overwrite one another', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, occurrenceId: '1762369200' }, NOW));
    expect(props['UID']).toBe('92867066227-1762369200@lfx.linuxfoundation.org');
  });

  it('escapes TEXT (including semicolons) and cannot be injected with extra properties', () => {
    const ics = buildMeetingIcs({ ...FIXTURE, title: 'A, B; C\\D\r\nATTENDEE:mailto:x@example.com', projectName: 'P\nDTSTART:19700101T000000Z' }, NOW);
    const { lines, props } = parseIcs(ics);
    expect(props['SUMMARY']).toBe(String.raw`A\, B\; C\\D\nATTENDEE:mailto:x@example.com`);
    expect(lines.some((l) => l.startsWith('ATTENDEE'))).toBe(false);
    expect(lines.filter((l) => l.startsWith('DTSTART'))).toHaveLength(1);
  });

  it('strips non-printing control characters from TEXT values', () => {
    const { props } = parseIcs(buildMeetingIcs({ ...FIXTURE, title: 'A\u0000B\u0007C\tD' }, NOW));
    expect(props['SUMMARY']).toBe('ABC\tD');
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

  it('throws on an invalid start', () => {
    expect(() => buildMeetingVEvent({ ...FIXTURE, start: 'nope' }, NOW)).toThrow(RangeError);
  });

  it('never carries registrant, passcode, host-key or Zoom fields (the input type has no slot for them)', () => {
    expect(buildMeetingIcs(FIXTURE, NOW)).not.toMatch(/zoom|passcode|password|host_key|ATTENDEE|ORGANIZER/i);
  });
});
