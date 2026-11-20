// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils (imported transitively) needs the Angular JIT compiler facade outside an Angular bootstrap.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { MeetingVisibility } from '../enums';
import type { Meeting, MeetingHomeRow, PastMeeting } from '../interfaces';
import {
  buildMeetingMiniCalendarWeeks,
  formatMeetingCalendarDay,
  formatMeetingCalendarMonth,
  formatMeetingCalendarTime,
  getLocalDayKey,
  groupMeetingCalendarEntries,
} from './meetings-home-calendar.utils';

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    start_time: new Date(2026, 9, 1, 10).toISOString(),
    duration: 60,
    timezone: 'UTC',
    title: 'Sync',
    description: '',
    recurrence: null,
    committees: [],
    meeting_type: 'Board',
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: null,
    invited: true,
    occurrences: [],
    ...overrides,
  };
}

function row(key: string, start: Date, meeting: Meeting = buildMeeting({ id: key })): MeetingHomeRow {
  return {
    key,
    meeting,
    occurrence: null,
    title: key,
    occurrenceId: null,
    startTime: start.toISOString(),
    durationMinutes: 60,
  };
}

describe('meetings home calendar utils', () => {
  it('keys and formats dates in local time', () => {
    const date = new Date(2026, 9, 1, 10, 0);
    expect(getLocalDayKey(date)).toBe('2026-10-01');
    expect(getLocalDayKey(date.toISOString())).toBe('2026-10-01');
    expect(formatMeetingCalendarDay(date)).toBe('Thu, Oct 1');
    expect(formatMeetingCalendarTime(date)).toBe('10:00 AM');
    expect(formatMeetingCalendarMonth(date)).toBe('October 2026');
  });

  it('buckets upcoming and past rows by local day, soonest first', () => {
    const days = groupMeetingCalendarEntries(
      [row('late', new Date(2026, 9, 1, 15)), row('next', new Date(2026, 9, 2, 9))],
      [row('early', new Date(2026, 9, 1, 9))]
    );

    expect([...days.keys()]).toEqual(['2026-10-01', '2026-10-02']);
    expect(days.get('2026-10-01')?.map((entry) => [entry.row.key, entry.past])).toEqual([
      ['early', true],
      ['late', false],
    ]);
  });

  it('builds full Sunday-first weeks, with meetings on in-month days only', () => {
    const days = groupMeetingCalendarEntries([row('in', new Date(2026, 9, 2, 9)), row('out', new Date(2026, 10, 1, 9))], []);
    const weeks = buildMeetingMiniCalendarWeeks(new Date(2026, 9, 15), days, new Date(2026, 9, 1, 8));

    // October 2026 starts on a Thursday and ends on a Saturday: five weeks from Sep 27 to Oct 31.
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(weeks[0].days[0]).toMatchObject({ key: '2026-09-27', day: 27, inMonth: false });
    const today = weeks[0].days[4];
    expect(today).toMatchObject({ key: '2026-10-01', today: true, label: 'Thu, Oct 1' });
    expect(weeks[0].days[5].entries.map((entry) => entry.row.key)).toEqual(['in']);

    // Nov 1 falls after October's last full week, so its meeting shows nowhere in October.
    const october = buildMeetingMiniCalendarWeeks(new Date(2026, 9, 1), days, new Date(2026, 9, 1));
    expect(october.flatMap((week) => week.days).some((day) => day.entries.some((entry) => entry.row.key === 'out'))).toBe(false);
  });

  it('lists a day before today on Past, and today on Upcoming unless all its meetings have ended', () => {
    const now = new Date(2026, 9, 10, 12);
    const days = groupMeetingCalendarEntries([row('soon', new Date(2026, 9, 10, 15))], [row('ended', new Date(2026, 9, 9, 9))]);
    const all = buildMeetingMiniCalendarWeeks(now, days, now).flatMap((week) => week.days);
    const tab = (key: string) => all.find((day) => day.key === key)?.tab;

    expect(tab('2026-10-09')).toBe('past');
    expect(tab('2026-10-10')).toBe('upcoming');
    expect(tab('2026-10-12')).toBe('upcoming');

    const onlyEnded = groupMeetingCalendarEntries([], [row('earlier', new Date(2026, 9, 10, 8))]);
    expect(
      buildMeetingMiniCalendarWeeks(now, onlyEnded, now)
        .flatMap((week) => week.days)
        .find((day) => day.today)?.tab
    ).toBe('past');
  });

  it('keeps a date that is in both lists once, as past', () => {
    const start = new Date(2026, 9, 1, 9);
    const upcoming = row('series-1-occ', start, buildMeeting({ id: 'series-1' }));
    const pastMeeting: PastMeeting = {
      ...buildMeeting({ id: 'series-1-1790000000000' }),
      meeting_id: 'series-1',
      occurrence_id: '',
      scheduled_start_time: start.toISOString(),
      scheduled_end_time: '',
      meeting_and_occurrence_id: '',
      platform_meeting_id: '',
      sessions: [],
    };
    const days = groupMeetingCalendarEntries([upcoming, row('other', start)], [row('series-1-past', start, pastMeeting)]);

    expect(days.get('2026-10-01')?.map((entry) => [entry.row.key, entry.past])).toEqual([
      ['other', false],
      ['series-1-past', true],
    ]);
  });

  it('gives each day one dot per meeting, three at most', () => {
    const days = groupMeetingCalendarEntries(
      [1, 2, 3, 4].map((hour) => row(`m${hour}`, new Date(2026, 9, 2, 8 + hour))),
      []
    );
    const day = buildMeetingMiniCalendarWeeks(new Date(2026, 9, 1), days, new Date(2026, 9, 1))[0].days[5];

    expect(day.dots).toEqual(['m1', 'm2', 'm3']);
  });
});
