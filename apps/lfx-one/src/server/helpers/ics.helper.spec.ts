// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { warning: vi.fn() },
}));
// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config, and the
// real barrel pulls in Angular-dependent code that fails to JIT-compile outside the browser build.
vi.mock('@lfx-one/shared/utils', () => ({
  addMinutesToDate: vi.fn((iso: string) => ({ toISOString: () => iso })),
  isSameOccurrenceId: (a?: string | null, b?: string | null) => !!a && !!b && String(a) === String(b),
}));

import { Meeting } from '@lfx-one/shared/interfaces';

import { buildMeetingCalendarEvents, buildVCalendar, buildVEvent, ICS_UID_DOMAIN } from './ics.helper';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meeting-1',
    title: 'Weekly Sync',
    start_time: '2026-01-15T14:00:00Z',
    duration: 30,
    description: 'Discuss roadmap',
    occurrences: [],
    ...overrides,
  } as Meeting;
}

describe('buildVCalendar', () => {
  it('omits X-WR-CALNAME when no calname is provided', () => {
    const ics = buildVCalendar(['BEGIN:VEVENT\r\nEND:VEVENT'], '-//LFX//Calendar//EN');

    expect(ics).not.toContain('X-WR-CALNAME');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });

  it('emits an escaped X-WR-CALNAME line right after PRODID/CALSCALE/METHOD when calname is provided', () => {
    const ics = buildVCalendar(['BEGIN:VEVENT\r\nEND:VEVENT'], '-//LFX//Project Calendar//EN', 'CNCF, Inc.');

    const lines = ics.split('\r\n');
    expect(lines).toContain('X-WR-CALNAME:CNCF\\, Inc.');
    // Comes after the fixed header block and before the events.
    expect(lines.indexOf('X-WR-CALNAME:CNCF\\, Inc.')).toBeGreaterThan(lines.indexOf('METHOD:PUBLISH'));
    expect(lines.indexOf('X-WR-CALNAME:CNCF\\, Inc.')).toBeLessThan(lines.indexOf('BEGIN:VEVENT'));
  });

  it('folds a long calendar name per RFC 5545 line-length limits', () => {
    const longName = 'A'.repeat(100);
    const ics = buildVCalendar([], '-//LFX//Calendar//EN', longName);

    const rawLines = ics.split('\r\n');
    const calnameStart = rawLines.findIndex((line) => line.startsWith('X-WR-CALNAME:'));
    expect(calnameStart).toBeGreaterThanOrEqual(0);
    // Folded continuation lines are prefixed with a single space.
    expect(rawLines[calnameStart + 1].startsWith(' ')).toBe(true);
  });
});

describe('buildVEvent', () => {
  it('falls back to the title for DESCRIPTION when no extras are given', () => {
    const vevent = buildVEvent('uid-1', 'Weekly Sync', '2026-01-15T14:00:00Z', 30);

    expect(vevent).toContain('DESCRIPTION:Weekly Sync');
    expect(vevent).not.toContain('URL:');
  });

  it('appends the join link to DESCRIPTION and sets URL when joinUrl is given', () => {
    const vevent = buildVEvent('uid-1', 'Weekly Sync', '2026-01-15T14:00:00Z', 30, {
      description: 'Discuss roadmap',
      joinUrl: 'https://zoom.us/j/123',
    });

    expect(vevent).toContain('DESCRIPTION:Discuss roadmap\\n\\nJoin: https://zoom.us/j/123');
    expect(vevent).toContain('URL:https://zoom.us/j/123');
  });
});

describe('buildMeetingCalendarEvents', () => {
  it('builds a single event for a non-recurring meeting regardless of scope', () => {
    const meeting = makeMeeting();

    const events = buildMeetingCalendarEvents(meeting, { scope: 'series', joinUrl: 'https://zoom.us/j/123' });

    expect(events).toHaveLength(1);
    expect(events[0]).toContain(`UID:meeting-1@${ICS_UID_DOMAIN}`);
    expect(events[0]).toContain('URL:https://zoom.us/j/123');
  });

  it('builds only the requested occurrence when scope is "occurrence"', () => {
    const meeting = makeMeeting({
      occurrences: [
        { occurrence_id: 'occ-1', start_time: '2026-01-15T14:00:00Z', duration: 30 },
        { occurrence_id: 'occ-2', start_time: '2026-01-22T14:00:00Z', duration: 30 },
      ] as Meeting['occurrences'],
    });

    const events = buildMeetingCalendarEvents(meeting, { scope: 'occurrence', occurrenceId: 'occ-2' });

    expect(events).toHaveLength(1);
    expect(events[0]).toContain(`UID:meeting-1-occ-2@${ICS_UID_DOMAIN}`);
  });

  it('expands every non-cancelled occurrence when scope is "series"', () => {
    const meeting = makeMeeting({
      recurrence: {} as Meeting['recurrence'],
      occurrences: [
        { occurrence_id: 'occ-1', start_time: '2026-01-15T14:00:00Z', duration: 30 },
        { occurrence_id: 'occ-2', start_time: '2026-01-22T14:00:00Z', duration: 30, status: 'cancel' },
        { occurrence_id: 'occ-3', start_time: '2026-01-29T14:00:00Z', duration: 30 },
      ] as Meeting['occurrences'],
    });

    const events = buildMeetingCalendarEvents(meeting, { scope: 'series' });

    expect(events).toHaveLength(2);
    expect(events[0]).toContain(`UID:meeting-1-occ-1@${ICS_UID_DOMAIN}`);
    expect(events[1]).toContain(`UID:meeting-1-occ-3@${ICS_UID_DOMAIN}`);
  });

  it('returns no events when every occurrence of a recurring series is cancelled, rather than falling back to the series start (GH-3505)', () => {
    const meeting = makeMeeting({
      recurrence: {} as Meeting['recurrence'],
      occurrences: [
        { occurrence_id: 'occ-1', start_time: '2026-01-15T14:00:00Z', duration: 30, status: 'cancel' },
        { occurrence_id: 'occ-2', start_time: '2026-01-22T14:00:00Z', duration: 30, status: 'cancel' },
      ] as Meeting['occurrences'],
    });

    const events = buildMeetingCalendarEvents(meeting, { scope: 'series' });

    expect(events).toHaveLength(0);
  });

  it('falls back to the meeting start/duration when occurrenceId is not found', () => {
    const meeting = makeMeeting({
      occurrences: [{ occurrence_id: 'occ-1', start_time: '2026-01-15T14:00:00Z', duration: 30 }] as Meeting['occurrences'],
    });

    const events = buildMeetingCalendarEvents(meeting, { scope: 'occurrence', occurrenceId: 'does-not-exist' });

    expect(events).toHaveLength(1);
    expect(events[0]).toContain(`UID:meeting-1@${ICS_UID_DOMAIN}`);
  });

  it('matches an occurrence whose id differs by seconds vs milliseconds units via isSameOccurrenceId (GH-3505)', () => {
    const meeting = makeMeeting({
      occurrences: [{ occurrence_id: '1700000000', start_time: '2026-01-15T14:00:00Z', duration: 30 }] as Meeting['occurrences'],
    });

    const events = buildMeetingCalendarEvents(meeting, { scope: 'occurrence', occurrenceId: '1700000000' });

    expect(events).toHaveLength(1);
    expect(events[0]).toContain(`UID:meeting-1-1700000000@${ICS_UID_DOMAIN}`);
  });
});
