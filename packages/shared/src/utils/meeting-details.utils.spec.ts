// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils (imported transitively) needs the Angular JIT compiler facade outside an Angular bootstrap.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { MeetingVisibility, RecurrenceType } from '../enums';
import type { Meeting, MeetingOccurrence } from '../interfaces';
import {
  canViewMeetingGuests,
  formatMeetingDetailsDate,
  formatMeetingDetailsTime,
  getMeetingDetailsFeatures,
  getMeetingDetailsOccurrenceIndex,
  getMeetingDetailsOccurrenceOptions,
  getMeetingDetailsOrganizers,
  getMeetingDetailsRecurrence,
  getMeetingDetailsState,
  getMeetingScheduledZoneLabel,
  getMeetingShareUrl,
  hasMeetingFullAccess,
} from './meeting-details.utils';

const START = '2026-11-05T17:00:00Z';
const at = (iso: string) => new Date(iso);

describe('getMeetingDetailsState', () => {
  it('is far before the join window, soon inside it, live while under way and ended after', () => {
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T16:49:00Z'))).toBe('far');
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T16:50:00Z'))).toBe('soon');
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T17:00:00Z'))).toBe('live');
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T19:00:00Z'))).toBe('ended');
  });

  it('stays live through the 40 minute end buffer, as the list and Join do', () => {
    // 17:00 + 30 min + 40 min buffer = 18:10.
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T17:30:00Z'))).toBe('live');
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T18:10:00Z'))).toBe('live');
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T18:10:00.001Z'))).toBe('ended');
  });

  it('uses the meeting join window', () => {
    expect(getMeetingDetailsState(START, 30, at('2026-11-05T16:40:00Z'), { earlyJoinMinutes: 20 })).toBe('soon');
  });

  it('is always ended for a past meeting', () => {
    expect(getMeetingDetailsState(START, 30, at('2026-11-01T00:00:00Z'), { past: true })).toBe('ended');
  });

  it('is far when the start is not a date', () => {
    expect(getMeetingDetailsState('', 30, at('2026-11-05T17:00:00Z'))).toBe('far');
  });
});

describe('canViewMeetingGuests', () => {
  const shared = { meeting_type: 'Technical', restricted: false, show_meeting_attendees: true };

  it('always lets organizers see guests', () => {
    expect(canViewMeetingGuests({ ...shared, show_meeting_attendees: false }, { organizer: true, invited: false })).toBe(true);
  });

  it('lets invitees see a shared list only', () => {
    expect(canViewMeetingGuests(shared, { organizer: false, invited: true })).toBe(true);
    expect(canViewMeetingGuests({ ...shared, show_meeting_attendees: false }, { organizer: false, invited: true })).toBe(false);
    expect(canViewMeetingGuests(shared, { organizer: false, invited: false })).toBe(false);
  });

  it('never shares a Board or restricted list with invitees', () => {
    expect(canViewMeetingGuests({ ...shared, meeting_type: 'Board' }, { organizer: false, invited: true })).toBe(false);
    expect(canViewMeetingGuests({ ...shared, restricted: true }, { organizer: false, invited: true })).toBe(false);
  });
});

describe('hasMeetingFullAccess', () => {
  const open = { visibility: MeetingVisibility.PUBLIC, restricted: false };

  it('gives everyone a public meeting that is not restricted', () => {
    expect(hasMeetingFullAccess(open, { organizer: false, member: false })).toBe(true);
  });

  it('gives a private or restricted meeting to organizers and members only', () => {
    const closed = [
      { visibility: MeetingVisibility.PRIVATE, restricted: false },
      { visibility: MeetingVisibility.PUBLIC, restricted: true },
    ];
    for (const meeting of closed) {
      expect(hasMeetingFullAccess(meeting, { organizer: false, member: false })).toBe(false);
      expect(hasMeetingFullAccess(meeting, { organizer: true, member: false })).toBe(true);
      expect(hasMeetingFullAccess(meeting, { organizer: false, member: true })).toBe(true);
    }
  });
});

describe('getMeetingDetailsFeatures', () => {
  const all = { recording_enabled: true, transcript_enabled: true, youtube_upload_enabled: true, ai_summary_enabled: true };
  const labels = (features: { label: string }[]) => features.map((feature) => feature.label);

  it('follows the settings before the meeting, never with AI Summary', () => {
    expect(labels(getMeetingDetailsFeatures(all, null))).toEqual(['Recording', 'Transcripts', 'YouTube Upload']);
    expect(labels(getMeetingDetailsFeatures({ ...all, recording_enabled: null, transcript_enabled: false }, null))).toEqual(['YouTube Upload']);
  });

  it('shows Recording, Transcripts and AI Summary once ended only when each exists', () => {
    expect(labels(getMeetingDetailsFeatures(all, { recording: true, transcript: false, summary: true }))).toEqual([
      'Recording',
      'YouTube Upload',
      'AI Summary',
    ]);
    expect(labels(getMeetingDetailsFeatures({ ...all, youtube_upload_enabled: false }, { recording: false, transcript: true, summary: false }))).toEqual([
      'Transcripts',
    ]);
  });
});

describe('getMeetingScheduledZoneLabel', () => {
  it('names the meeting zone and its abbreviation at the start when it differs from the viewer zone', () => {
    expect(getMeetingScheduledZoneLabel('America/New_York', '2026-01-15T15:00:00Z', 'Europe/Ljubljana')).toBe('Scheduled in America/New_York (EST)');
    expect(getMeetingScheduledZoneLabel('America/New_York', '2026-07-15T15:00:00Z', 'Europe/Ljubljana')).toBe('Scheduled in America/New_York (EDT)');
  });

  it('is null in the viewer zone or without a zone', () => {
    expect(getMeetingScheduledZoneLabel('America/New_York', '2026-01-15T15:00:00Z', 'America/New_York')).toBeNull();
    expect(getMeetingScheduledZoneLabel(null, '2026-01-15T15:00:00Z', 'UTC')).toBeNull();
  });
});

describe('getMeetingDetailsOrganizers', () => {
  const mailto = { meetingTitle: 'Synthetic sync', meetingDate: 'Nov 5, 2026', detailUrl: 'https://app.example/meetings/mtg-1' };
  const meeting: Pick<Meeting, 'created_by' | 'owner' | 'organizers'> = {
    created_by: { name: 'Owner Person', username: 'owner', email: 'owner@acme.example' },
    organizers: ['owner', 'editor', 'helper@acme.example'],
  };

  it('lists the owner, then hosts by name, then the other organizers, with a mailto for each email', () => {
    const hosts = [
      { first_name: 'Zed', last_name: 'Host', username: 'zed', email: 'zed@acme.example', host: true },
      { first_name: 'Amy', last_name: 'Host', username: 'amy', email: 'not an email', host: true },
      { first_name: 'Guest', last_name: 'Only', username: 'guest', email: 'guest@acme.example', host: false },
    ];
    const people = getMeetingDetailsOrganizers(meeting, hosts, null, mailto);

    expect(people.map((person) => person.label)).toEqual(['Owner Person', 'Amy Host', 'Zed Host', 'editor', 'helper']);
    expect(people[0].mailto).toBe(
      `mailto:owner@acme.example?subject=${encodeURIComponent('Synthetic sync — Nov 5, 2026')}&body=${encodeURIComponent(mailto.detailUrl)}`
    );
    expect(people[1].mailto).toBeNull();
    expect(people[3].mailto).toBeNull();
    expect(people[4].mailto).toContain('mailto:helper@acme.example');
  });

  it('names the viewer You, with no mailto', () => {
    const [owner] = getMeetingDetailsOrganizers(meeting, [], 'OWNER', mailto);

    expect(owner.label).toBe('You');
    expect(owner.mailto).toBeNull();
  });

  it('never names an email-only organizer You from its local part', () => {
    const helper = getMeetingDetailsOrganizers(meeting, [], 'helper', mailto).find((person) => person.name === 'helper');

    expect(helper?.label).toBe('helper');
    expect(helper?.mailto).toContain('mailto:helper@acme.example');
  });
});

describe('getMeetingShareUrl', () => {
  it('links a meeting with its passcode', () => {
    expect(getMeetingShareUrl('https://app.example', 'mtg-1', 'secret')).toBe('https://app.example/meetings/mtg-1?password=secret');
  });

  it('links a past meeting record without a passcode', () => {
    expect(getMeetingShareUrl('https://app.example', 'mtg-1-1762362000000')).toBe('https://app.example/meetings/mtg-1-1762362000000');
  });

  it('leaves out an empty passcode', () => {
    expect(getMeetingShareUrl('https://app.example', 'mtg-1', null)).toBe('https://app.example/meetings/mtg-1');
  });

  it('is null for an invalid base URL', () => {
    expect(getMeetingShareUrl('not a url', 'mtg-1', 'secret')).toBeNull();
  });
});

describe('formatMeetingDetailsDate and formatMeetingDetailsTime', () => {
  it('spells out the weekday and year, then the start and the minutes without a zone', () => {
    expect(formatMeetingDetailsDate(START, 'UTC')).toBe('Thursday, Nov 5, 2026');
    expect(formatMeetingDetailsTime(START, 45, 'UTC')).toBe('5:00 PM · 45 min');
  });

  it('is empty for an invalid start', () => {
    expect(formatMeetingDetailsDate('nope')).toBe('');
    expect(formatMeetingDetailsTime('nope', 30)).toBe('');
  });
});

describe('getMeetingDetailsRecurrence', () => {
  const weekly = { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '5' };
  const meeting = { start_time: START, timezone: 'UTC', recurrence: weekly };

  it('keeps the end of the series', () => {
    expect(getMeetingDetailsRecurrence({ ...meeting, recurrence: { ...weekly, end_times: 6 } })).toBe('Weekly on Thursday, for 6 occurrences');
  });

  it("prefers the shown date's own rule", () => {
    const occurrence: MeetingOccurrence = {
      occurrence_id: '1',
      start_time: START,
      duration: 30,
      recurrence: { type: RecurrenceType.DAILY, repeat_interval: 1 },
    };
    expect(getMeetingDetailsRecurrence(meeting, occurrence)).toBe('Daily');
  });

  it('reads a single-date rule as a one-time meeting, and no rule as nothing', () => {
    expect(getMeetingDetailsRecurrence({ ...meeting, recurrence: { ...weekly, end_times: 1 } })).toBe('One-time meeting');
    expect(getMeetingDetailsRecurrence({ ...meeting, recurrence: null })).toBeNull();
  });
});

describe('occurrence navigation', () => {
  const date = (day: number, duration = 30): MeetingOccurrence => ({
    occurrence_id: String(Date.UTC(2026, 10, day, 17) / 1000),
    start_time: new Date(Date.UTC(2026, 10, day, 17)).toISOString(),
    duration,
  });
  const timeline = [date(1), date(8), date(15)];

  it('finds the shown date, else the next one after it, else the last', () => {
    expect(getMeetingDetailsOccurrenceIndex(timeline, date(8).start_time)).toBe(1);
    expect(getMeetingDetailsOccurrenceIndex(timeline, date(5).start_time)).toBe(1);
    expect(getMeetingDetailsOccurrenceIndex(timeline, date(20).start_time)).toBe(2);
    expect(getMeetingDetailsOccurrenceIndex([], START)).toBe(-1);
  });

  it('splits the menu into upcoming dates with the cancelled ones and past dates newest first', () => {
    const { upcoming, past } = getMeetingDetailsOccurrenceOptions([date(1), date(2), date(15)], [date(8), date(15)], at('2026-11-05T12:00:00Z'));

    expect(upcoming.map((item) => [item.occurrence.start_time, item.cancelled, item.next])).toEqual([
      [date(8).start_time, true, false],
      [date(15).start_time, false, true],
    ]);
    expect(past.map((item) => item.occurrence.start_time)).toEqual([date(2).start_time, date(1).start_time]);
  });

  it('keeps a date upcoming until 40 minutes after its end', () => {
    const { upcoming } = getMeetingDetailsOccurrenceOptions([date(5)], [], at('2026-11-05T18:10:00Z'));
    expect(upcoming).toHaveLength(1);
  });

  it("gives a date without its own duration the series' duration", () => {
    expect(getMeetingDetailsOccurrenceOptions([date(5, 0)], [], at('2026-11-05T18:30:00Z'), 60).upcoming).toHaveLength(1);
    expect(getMeetingDetailsOccurrenceOptions([date(5, 0)], [], at('2026-11-05T18:30:00Z')).upcoming).toHaveLength(0);
  });
});
