// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils (imported transitively) needs the Angular JIT compiler facade outside an Angular bootstrap.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { MEETINGS_HOME_CALENDAR_WEEKDAY_NAMES } from '../constants/meeting-list.constants';
import { MeetingVisibility } from '../enums';
import type { Meeting, MeetingHomeRow, PastMeeting } from '../interfaces';
import {
  buildMeetingCalendarDialogDays,
  formatMeetingCalendarHourLabel,
  buildMeetingMiniCalendarWeeks,
  formatMeetingCalendarWeekRange,
  getMeetingCalendarMonthDates,
  getMeetingCalendarTypeColor,
  getMeetingCalendarWeekStart,
  layoutMeetingCalendarWeekDay,
  toMeetingCalendarChip,
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

const typed = (key: string, start: Date, type = 'Board', durationMinutes = 60): MeetingHomeRow =>
  row(key, start, buildMeeting({ id: key, meeting_type: type }), durationMinutes);

function row(key: string, start: Date, meeting: Meeting = buildMeeting({ id: key }), durationMinutes = 60): MeetingHomeRow {
  return {
    key,
    meeting,
    occurrence: null,
    title: key,
    occurrenceId: null,
    startTime: start.toISOString(),
    durationMinutes,
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

  it('lists a day before today on Upcoming while one of its meetings, running past midnight, has not ended', () => {
    const now = new Date(2026, 9, 10, 0, 15);
    const days = groupMeetingCalendarEntries([row('overnight', new Date(2026, 9, 9, 23, 30))], []);
    const day = buildMeetingMiniCalendarWeeks(now, days, now)
      .flatMap((week) => week.days)
      .find((cell) => cell.key === '2026-10-09');

    expect(day?.tab).toBe('upcoming');
  });

  it.each([
    ['spring forward', new Date(2026, 2, 1)],
    ['fall back', new Date(2026, 10, 1)],
  ])('keys every day of a month with a clock change (%s) once, in order', (_, month) => {
    const keys = buildMeetingMiniCalendarWeeks(month, new Map(), month)
      .flatMap((week) => week.days)
      .filter((day) => day.inMonth)
      .map((day) => day.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toHaveLength(new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate());
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

  describe('calendar dialog', () => {
    it('starts weeks on Sunday and names the second month only when it differs', () => {
      expect(getMeetingCalendarWeekStart(new Date(2026, 9, 1, 15))).toEqual(new Date(2026, 8, 27));
      expect(formatMeetingCalendarWeekRange(new Date(2026, 8, 27))).toBe('Sep 27 – Oct 3, 2026');
      expect(formatMeetingCalendarWeekRange(new Date(2026, 9, 4))).toBe('Oct 4 – 10, 2026');
      expect(getMeetingCalendarMonthDates(new Date(2026, 9, 1))).toHaveLength(35);
      // A week across New Year names both years.
      expect(formatMeetingCalendarWeekRange(new Date(2026, 11, 27))).toBe('Dec 27, 2026 – Jan 2, 2027');
    });

    it('ends a meeting across a clock change at its real end time', () => {
      const zone = process.env['TZ'];
      process.env['TZ'] = 'America/New_York';
      try {
        // 2026-03-08 springs forward at 2:00 AM: an hour from 1:30 AM ends at 3:30 AM on the clock.
        const [event] = layoutMeetingCalendarWeekDay([{ row: typed('dst', new Date(2026, 2, 8, 1, 30), 'Board', 60), past: false }]);
        expect([event.top, event.height]).toEqual([72, 94]);
      } finally {
        process.env['TZ'] = zone;
      }
    });

    it('keeps a carry-over from the day before to its real end, so it shares no lane with a meeting after it', () => {
      const days = groupMeetingCalendarEntries(
        [typed('overnight', new Date(2026, 9, 3, 23, 50), 'Board', 15), typed('early', new Date(2026, 9, 4, 0, 10), 'Board', 60)],
        []
      );

      const [sunday] = buildMeetingCalendarDialogDays([new Date(2026, 9, 4)], days, new Date(2026, 9, 1), null, 0);

      expect(sunday.events.map((event) => [event.key, event.top, event.lane, event.lanes])).toEqual([
        ['overnight', 0, 0, 1],
        ['early', 8, 0, 1],
      ]);
    });

    it('does not carry a short meeting that ends by midnight into the next day', () => {
      const days = groupMeetingCalendarEntries([typed('short', new Date(2026, 9, 3, 23, 45), 'Board', 15)], []);

      const [, sunday] = buildMeetingCalendarDialogDays([new Date(2026, 9, 3), new Date(2026, 9, 4)], days, new Date(2026, 9, 1), null, 0);

      expect(sunday.events).toEqual([]);
    });

    it('shows a meeting that crosses midnight on both days of the week, clipped to each', () => {
      const days = groupMeetingCalendarEntries([typed('late', new Date(2026, 9, 3, 23, 30), 'Board', 60)], []);
      const dates = [new Date(2026, 9, 3), new Date(2026, 9, 4)];

      const [saturday, sunday] = buildMeetingCalendarDialogDays(dates, days, new Date(2026, 9, 1), null, 0);

      expect(saturday.events.map((event) => [event.key, event.top, event.height])).toEqual([['late', 1128, 22]]);
      expect(sunday.events.map((event) => [event.key, event.top, event.height])).toEqual([['late', 0, 22]]);
    });

    it('colours chips by type, faded for past meetings, and falls back to Other', () => {
      expect(getMeetingCalendarTypeColor('board')).toBe('var(--ui-danger-500)');
      expect(getMeetingCalendarTypeColor('Unknown')).toBe('var(--ui-neutral-500)');
      expect(getMeetingCalendarTypeColor(null)).toBe('var(--ui-neutral-500)');

      const upcoming = toMeetingCalendarChip({ row: typed('a', new Date(2026, 9, 1, 10)), past: false });
      expect(upcoming).toMatchObject({
        time: '10:00 AM',
        background: 'color-mix(in srgb, var(--ui-danger-500) 16%, var(--ui-white))',
        ink: 'color-mix(in srgb, var(--ui-danger-500) 75%, var(--ui-black))',
        bar: 'var(--ui-danger-500)',
        detail: 'Thu, Oct 1 · 10:00 AM · Board',
      });
      const past = toMeetingCalendarChip({ row: typed('b', new Date(2026, 9, 1, 10), ''), past: true });
      expect(past).toMatchObject({
        background: 'color-mix(in srgb, var(--ui-neutral-500) 7%, var(--ui-white))',
        ink: 'color-mix(in srgb, var(--ui-neutral-500) 50%, var(--ui-white))',
        bar: 'color-mix(in srgb, var(--ui-neutral-500) 35%, var(--ui-white))',
        detail: 'Thu, Oct 1 · 10:00 AM · Other · Past',
      });
    });

    it('places week events by time and puts overlapping ones in greedy lanes', () => {
      const events = layoutMeetingCalendarWeekDay([
        { row: typed('late', new Date(2026, 9, 1, 11), 'Board', 60), past: false },
        { row: typed('early', new Date(2026, 9, 1, 9), 'Board', 120), past: false },
        { row: typed('short', new Date(2026, 9, 1, 9, 30), 'Board', 10), past: false },
        { row: typed('alone', new Date(2026, 9, 1, 14), 'Board', 60), past: false },
      ]);

      expect(events.map((event) => [event.key, event.top, event.height, event.lane, event.lanes])).toEqual([
        ['early', 432, 94, 0, 2],
        ['short', 456, 22, 1, 2],
        ['late', 528, 46, 0, 1],
        ['alone', 672, 46, 0, 1],
      ]);
    });

    it('gives every meeting of a chain of overlaps the same lane count', () => {
      const events = layoutMeetingCalendarWeekDay([
        { row: typed('E', new Date(2026, 9, 1, 9), 'Board', 60), past: false },
        { row: typed('F', new Date(2026, 9, 1, 9), 'Board', 120), past: false },
        { row: typed('G', new Date(2026, 9, 1, 10), 'Board', 90), past: false },
        { row: typed('H', new Date(2026, 9, 1, 10, 30), 'Board', 60), past: false },
      ]);

      // E and H never overlap, but F and G link them: all four share three lanes.
      expect(events.map((event) => [event.key, event.lane, event.lanes])).toEqual([
        ['E', 0, 3],
        ['F', 1, 3],
        ['G', 0, 3],
        ['H', 2, 3],
      ]);
    });

    it('labels the hour gutter and the weekdays', () => {
      expect([0, 1, 11, 12, 13, 23].map(formatMeetingCalendarHourLabel)).toEqual(['', '1 AM', '11 AM', '12 PM', '1 PM', '11 PM']);
      expect(MEETINGS_HOME_CALENDAR_WEEKDAY_NAMES).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    });

    it('keeps three chips per month cell and counts the rest', () => {
      const entries = groupMeetingCalendarEntries(
        [8, 9, 10, 11, 12].map((hour) => typed(`m${hour}`, new Date(2026, 9, 1, hour))),
        []
      );
      const [first, outside] = buildMeetingCalendarDialogDays([new Date(2026, 9, 1), new Date(2026, 10, 1)], entries, new Date(2026, 9, 1), 9, 3);

      expect(first).toMatchObject({ key: '2026-10-01', label: 'Thu, Oct 1', inMonth: true, today: true, more: 2, events: [] });
      expect(first.chips.map((chip) => chip.key)).toEqual(['m8', 'm9', 'm10']);
      expect(outside.inMonth).toBe(false);
    });
  });
});
