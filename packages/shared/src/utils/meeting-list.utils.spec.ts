// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils (imported transitively) needs the Angular JIT compiler facade outside an Angular bootstrap.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { DEFAULT_MEETING_TYPE_CONFIG, MEETING_TYPE_CONFIGS, MEETING_VISIBILITY_INFO, MEETINGS_HOME_DEFAULT_FILTERS } from '../constants';
import { MeetingVisibility, MeetingVisibilityKind, RecurrenceType } from '../enums';
import type { Meeting, MeetingHomeRow, MeetingOccurrence, MeetingRsvp, MeetingsHomeFilters, PastMeeting } from '../interfaces';
import {
  buildMeetingFilterChips,
  countAppliedMeetingFilters,
  expandMeetingOccurrences,
  filterMeetingsHome,
  formatMeetingDateTime,
  formatMeetingTimeRange,
  formatMeetingWhen,
  formatMeetingWhenFull,
  getMeetingWhenParts,
  getMeetingDayBucket,
  getMeetingGroupNames,
  getMeetingHomeRowLink,
  getMeetingHomeRowOrganizers,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingProjectUrl,
  getMeetingRecurrenceLabel,
  getMeetingRecurrenceTooltip,
  getMeetingRsvpToastMessage,
  getMeetingStartsInLabel,
  getMeetingVisibilityBadges,
  groupMeetingsByDayBucket,
  isMeetingHomeRowPendingRsvp,
  isMeetingPendingRsvp,
  toPastMeetingHomeRow,
} from './meeting-list.utils';

// Thursday, Oct 1 2026, 09:00 in the runner's local zone; buckets are local-calendar based.
const NOW = new Date(2026, 9, 1, 9, 0);
const local = (month: number, day: number, hour = 10, minute = 0, year = 2026): Date => new Date(year, month - 1, day, hour, minute);
const seconds = (date: Date): string => String(Math.floor(date.getTime() / 1000));
const WEEKLY = { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '5' };

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Project One',
    start_time: local(10, 8).toISOString(),
    duration: 60,
    timezone: 'America/Los_Angeles',
    title: 'Weekly Sync',
    description: '',
    recurrence: null,
    committees: [],
    meeting_type: 'Technical',
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
    is_invite_responses_enabled: true,
    ...overrides,
  };
}

function occurrence(start: Date, duration = 60): MeetingOccurrence {
  return { occurrence_id: seconds(start), start_time: start.toISOString(), duration };
}

function weeklyOccurrences(first: Date, count: number): MeetingOccurrence[] {
  return Array.from({ length: count }, (_, week) =>
    occurrence(new Date(first.getFullYear(), first.getMonth(), first.getDate() + week * 7, first.getHours(), first.getMinutes()))
  );
}

function rsvp(overrides: Partial<MeetingRsvp>): MeetingRsvp {
  return {
    id: 'r-1',
    meeting_id: 'm-1',
    registrant_id: 'reg-1',
    username: 'viewer',
    email: 'viewer@example.test',
    response_type: 'accepted',
    scope: 'all',
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function row({ meeting = buildMeeting(), ...overrides }: Partial<MeetingHomeRow> & { meeting?: Meeting } = {}): MeetingHomeRow {
  return {
    key: meeting.id,
    meeting,
    occurrence: null,
    title: meeting.title,
    occurrenceId: null,
    startTime: local(10, 8).toISOString(),
    durationMinutes: 60,
    myRsvp: null,
    ...overrides,
  };
}

const filters = (overrides: Partial<MeetingsHomeFilters> = {}): MeetingsHomeFilters => ({ ...MEETINGS_HOME_DEFAULT_FILTERS, ...overrides });

describe('isMeetingPendingRsvp', () => {
  it.each<[string, Partial<Meeting>, boolean]>([
    ['RSVPs loaded and none applies', { my_rsvp: null }, true],
    ['live registration', { my_rsvp: null, my_registrant_ids: ['reg-1'] }, true],
    ['RSVPs not loaded', { my_rsvp: undefined }, false],
    ['no live registration', { my_rsvp: null, my_registrant_ids: [] }, false],
    ['invite responses off', { my_rsvp: null, is_invite_responses_enabled: false }, false],
    ['an applicable RSVP', { my_rsvp: rsvp({}) }, false],
  ])('%s → %s', (_, overrides, pending) => {
    expect(isMeetingPendingRsvp(buildMeeting(overrides))).toBe(pending);
  });

  it('is pending when the only RSVP answers a different date of the series', () => {
    // Far-future dates: the legacy resolver reads the real clock.
    const meeting = buildMeeting({
      recurrence: WEEKLY,
      occurrences: weeklyOccurrences(local(10, 8, 10, 0, 2030), 2),
      my_rsvp: rsvp({ scope: 'single', occurrence_id: seconds(local(10, 15, 10, 0, 2030)) }),
    });
    expect(isMeetingPendingRsvp(meeting)).toBe(true);
  });

  it('applies the same rule to a row', () => {
    expect(isMeetingHomeRowPendingRsvp(row({ myRsvp: null }))).toBe(true);
    expect(isMeetingHomeRowPendingRsvp(row({ myRsvp: undefined }))).toBe(false);
    expect(isMeetingHomeRowPendingRsvp(row({ myRsvp: rsvp({}) }))).toBe(false);
  });
});

describe('expandMeetingOccurrences', () => {
  it('lists every active date of a series that has not ended, however far out', () => {
    // Sep 24 ended; Oct 1 08:30 is in progress at 09:00; weekly through Feb 2027.
    const meeting = buildMeeting({ recurrence: WEEKLY, occurrences: weeklyOccurrences(local(9, 24, 8, 30), 20) });
    const rows = expandMeetingOccurrences([meeting], NOW);
    expect(rows).toHaveLength(19);
    expect(rows[0].startTime).toBe(local(10, 1, 8, 30).toISOString());
    expect(rows.at(-1)?.startTime).toBe(local(2, 4, 8, 30, 2027).toISOString());
    expect(rows[1].key).toBe(`m-1:${seconds(local(10, 8, 8, 30))}`);
    expect(rows[1].occurrenceId).toBe(seconds(local(10, 8, 8, 30)));
  });

  it('skips dates cancelled either way, with no fallback once all are cancelled', () => {
    const [first, second, third] = weeklyOccurrences(local(10, 8), 3);
    const occurrences = [first, second, { ...third, status: 'cancel' }];
    const meeting = buildMeeting({
      recurrence: WEEKLY,
      occurrences,
      cancelled_occurrences: [second.occurrence_id],
      next_occurrence_start_time: second.start_time,
    });
    expect(expandMeetingOccurrences([meeting], NOW).map((item) => item.occurrenceId)).toEqual([first.occurrence_id]);
    expect(expandMeetingOccurrences([{ ...meeting, cancelled_occurrences: [first.occurrence_id, second.occurrence_id] }], NOW)).toEqual([]);
    expect(expandMeetingOccurrences([{ ...meeting, occurrences: [] }], NOW)).toEqual([]);
  });

  it('uses the occurrence title when it has one', () => {
    const [first, second] = weeklyOccurrences(local(10, 8), 2);
    const meeting = buildMeeting({ recurrence: WEEKLY, occurrences: [{ ...first, title: 'Kickoff' }, second] });
    expect(expandMeetingOccurrences([meeting], NOW).map((item) => item.title)).toEqual(['Kickoff', 'Weekly Sync']);
  });

  it('falls back to the next start when a series has no usable occurrence list', () => {
    const next = local(10, 8);
    const meeting = buildMeeting({
      recurrence: WEEKLY,
      occurrences: [],
      start_time: local(1, 1).toISOString(),
      next_occurrence_start_time: next.toISOString(),
    });
    const rows = expandMeetingOccurrences([meeting], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startTime: next.toISOString(), occurrence: null, occurrenceId: seconds(next), durationMinutes: 60 });
  });

  it('lists a one-time meeting once, wherever it falls, and drops it once ended', () => {
    const later = buildMeeting({ id: 'later', start_time: local(3, 1, 10, 0, 2027).toISOString() });
    const ended = buildMeeting({ id: 'ended', start_time: local(9, 30).toISOString() });
    const rows = expandMeetingOccurrences([later, ended], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'later', occurrenceId: null });
  });

  it('sorts rows from every meeting by start', () => {
    const series = buildMeeting({ id: 'series', recurrence: WEEKLY, occurrences: weeklyOccurrences(local(10, 2), 2) });
    const oneTime = buildMeeting({ id: 'one', start_time: local(10, 5).toISOString() });
    expect(expandMeetingOccurrences([series, oneTime], NOW).map((item) => item.meeting.id)).toEqual(['series', 'one', 'series']);
  });

  describe('RSVP per date', () => {
    const dates = weeklyOccurrences(local(10, 1, 12), 4);

    it('resolves each date from my_rsvps', () => {
      const meeting = buildMeeting({
        recurrence: WEEKLY,
        occurrences: dates,
        my_rsvp: null,
        my_rsvps: [
          rsvp({ id: 'single', response_type: 'declined', scope: 'single', occurrence_id: dates[1].occurrence_id, created_at: '2026-09-02T00:00:00Z' }),
          // ms-based anchor: RSVP rows store milliseconds, occurrences seconds
          rsvp({ id: 'following', response_type: 'maybe', scope: 'this_and_following', occurrence_id: `${dates[2].occurrence_id}000` }),
        ],
      });
      const responses = expandMeetingOccurrences([meeting], NOW).map((item) => item.myRsvp?.response_type ?? null);
      expect(responses).toEqual([null, 'declined', 'maybe', 'maybe']);
    });

    it('leaves the RSVP unknown when the feed did not load RSVPs', () => {
      const meeting = buildMeeting({ recurrence: WEEKLY, occurrences: dates });
      expect(expandMeetingOccurrences([meeting], NOW).every((item) => item.myRsvp === undefined)).toBe(true);
    });

    it('applies a series-wide my_rsvp to every date when my_rsvps is absent', () => {
      const meeting = buildMeeting({ recurrence: WEEKLY, occurrences: dates, my_rsvp: rsvp({ response_type: 'accepted', scope: 'all' }) });
      expect(expandMeetingOccurrences([meeting], NOW).every((item) => item.myRsvp?.response_type === 'accepted')).toBe(true);
    });

    it('lets a newer my_rsvp overlay win over an older my_rsvps entry', () => {
      const meeting = buildMeeting({
        recurrence: WEEKLY,
        occurrences: dates,
        my_rsvps: [rsvp({ id: 'old', response_type: 'declined', scope: 'all', created_at: '2026-09-01T00:00:00Z' })],
        my_rsvp: rsvp({ id: 'new', response_type: 'accepted', scope: 'single', occurrence_id: dates[0].occurrence_id, created_at: '2026-09-20T00:00:00Z' }),
      });
      const responses = expandMeetingOccurrences([meeting], NOW).map((item) => item.myRsvp?.response_type);
      expect(responses).toEqual(['accepted', 'declined', 'declined', 'declined']);
    });

    it('keeps a confirmed rewrite that reuses its row id', () => {
      const stored = rsvp({ id: 'same', response_type: 'declined', created_at: '2026-09-01T00:00:00Z' });
      const meeting = buildMeeting({ recurrence: WEEKLY, occurrences: dates, my_rsvps: [stored], my_rsvp: { ...stored, response_type: 'accepted' } });
      expect(expandMeetingOccurrences([meeting], NOW).every((item) => item.myRsvp?.response_type === 'accepted')).toBe(true);
    });

    it('uses the newest RSVP for a one-time meeting', () => {
      const meeting = buildMeeting({
        my_rsvps: [
          rsvp({ id: 'a', response_type: 'declined', created_at: '2026-09-01T00:00:00Z' }),
          rsvp({ id: 'b', response_type: 'maybe', created_at: '2026-09-10T00:00:00Z' }),
        ],
      });
      expect(expandMeetingOccurrences([meeting], NOW)[0].myRsvp?.id).toBe('b');
    });

    it('treats dates a date-scoped my_rsvp does not cover as unknown, except the next one', () => {
      const meeting = buildMeeting({
        recurrence: WEEKLY,
        occurrences: dates,
        my_rsvp: rsvp({ response_type: 'accepted', scope: 'single', occurrence_id: dates[2].occurrence_id }),
      });
      const responses = expandMeetingOccurrences([meeting], NOW).map((item) => (item.myRsvp === undefined ? 'unknown' : (item.myRsvp?.response_type ?? null)));
      expect(responses).toEqual([null, 'unknown', 'accepted', 'unknown']);
    });
  });
});

describe('toPastMeetingHomeRow', () => {
  const pastMeeting = (overrides: Partial<PastMeeting> = {}): PastMeeting => ({
    ...buildMeeting({ id: '123-1759334400000', title: 'Sync', duration: 45 }),
    scheduled_start_time: '2025-10-01T16:00:00Z',
    scheduled_end_time: '2025-10-01T16:45:00Z',
    meeting_id: '123',
    occurrence_id: '1759334400',
    platform_meeting_id: '',
    sessions: [],
    meeting_and_occurrence_id: '123-1759334400000',
    ...overrides,
  });

  it('keys the row by the past meeting id and starts it at the scheduled start', () => {
    const meeting = pastMeeting();

    expect(toPastMeetingHomeRow(meeting)).toEqual({
      key: '123-1759334400000',
      meeting,
      occurrence: null,
      title: 'Sync',
      occurrenceId: '1759334400',
      startTime: '2025-10-01T16:00:00.000Z',
      durationMinutes: 45,
    });
  });

  it('returns null without a valid start', () => {
    expect(toPastMeetingHomeRow(pastMeeting({ scheduled_start_time: 'nope', start_time: '' }))).toBeNull();
  });
});

describe('getMeetingDayBucket', () => {
  it.each([
    [local(10, 1, 15), 'Today'],
    [local(9, 30, 23, 30), 'Today'],
    [local(10, 2), 'Tomorrow'],
    [local(10, 4), 'This week'],
    [local(10, 5), 'This month'],
    [local(11, 3), 'November'],
    [local(1, 5, 10, 0, 2027), 'January 2027'],
  ])('upcoming %s → %s', (date, label) => {
    expect(getMeetingDayBucket(date, NOW, 'upcoming')).toBe(label);
  });

  it('ends this week on Sunday', () => {
    const sunday = local(10, 4, 9);
    expect(getMeetingDayBucket(local(10, 5), sunday, 'upcoming')).toBe('Tomorrow');
    expect(getMeetingDayBucket(local(10, 6), sunday, 'upcoming')).toBe('This month');
  });

  it('lets this week run into the next month', () => {
    expect(getMeetingDayBucket(local(11, 1), local(10, 29, 9), 'upcoming')).toBe('This week');
    expect(getMeetingDayBucket(local(11, 2), local(10, 29, 9), 'upcoming')).toBe('November');
  });

  it.each([
    [local(10, 1, 7), 'Today'],
    [local(9, 30), 'Yesterday'],
    [local(9, 28), 'This week'],
    [local(9, 27), 'September'],
    [local(12, 1, 10, 0, 2025), 'December 2025'],
  ])('past %s → %s', (date, label) => {
    expect(getMeetingDayBucket(date, NOW, 'past')).toBe(label);
  });

  it('uses This month for earlier dates of the current month in the past view', () => {
    expect(getMeetingDayBucket(local(10, 5), local(10, 20, 9), 'past')).toBe('This month');
  });
});

describe('groupMeetingsByDayBucket', () => {
  const rows = [local(10, 1, 12), local(10, 1, 15), local(10, 2), local(10, 3), local(10, 4)].map((start, index) =>
    row({ key: `r${index}`, startTime: start.toISOString() })
  );

  it('groups rows with bucket totals', () => {
    const groups = groupMeetingsByDayBucket(rows, 'upcoming', NOW);
    expect(groups.map((group) => [group.label, group.count, group.rows.length])).toEqual([
      ['Today', 2, 2],
      ['Tomorrow', 1, 1],
      ['This week', 2, 2],
    ]);
  });

  it('places only the loaded page into groups but keeps full counts', () => {
    const groups = groupMeetingsByDayBucket(rows, 'upcoming', NOW, 4);
    expect(groups.map((group) => [group.label, group.count, group.rows.map((item) => item.key)])).toEqual([
      ['Today', 2, ['r0', 'r1']],
      ['Tomorrow', 1, ['r2']],
      ['This week', 2, ['r3']],
    ]);
  });
});

describe('filterMeetingsHome', () => {
  const ada = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };
  const tsc = buildMeeting({ id: 'tsc', title: 'TSC Weekly', committees: [{ uid: 'c-1', name: 'Technical Steering Committee' }], created_by: ada });
  const board = buildMeeting({ id: 'board', title: 'Board Sync', project_uid: 'p-2', project_name: 'Project Two', meeting_type: 'Board' });
  const quiet = buildMeeting({ id: 'quiet', title: 'Office Hours', is_invite_responses_enabled: false });

  const rows = [
    row({ key: 'tsc-1', meeting: tsc, myRsvp: rsvp({ response_type: 'declined' }) }),
    row({ key: 'tsc-2', meeting: tsc, myRsvp: rsvp({ response_type: 'declined' }) }),
    row({ key: 'board-1', meeting: board, myRsvp: rsvp({ response_type: 'declined' }) }),
    row({ key: 'board-2', meeting: board, myRsvp: rsvp({ response_type: 'accepted' }) }),
    row({ key: 'board-3', meeting: board, myRsvp: null }),
    row({ key: 'quiet-1', meeting: quiet, myRsvp: rsvp({ response_type: 'maybe' }) }),
  ];
  const keys = (result: MeetingHomeRow[]): string[] => result.map((item) => item.key);

  it('returns every row with no filters or search', () => {
    expect(filterMeetingsHome(rows, filters(), '', null)).toHaveLength(rows.length);
  });

  it('searches titles case-insensitively, trimmed, and committee names', () => {
    expect(keys(filterMeetingsHome(rows, filters(), '  board SYNC ', null))).toEqual(['board-1', 'board-2', 'board-3']);
    expect(keys(filterMeetingsHome(rows, filters(), 'steering', null))).toEqual(['tsc-1', 'tsc-2']);
    expect(keys(filterMeetingsHome([row({ key: 'occ', title: 'Release Kickoff' })], filters(), 'kickoff', null))).toEqual(['occ']);
  });

  it('filters by project and meeting type', () => {
    expect(keys(filterMeetingsHome(rows, filters({ project: 'p-2' }), '', null))).toEqual(['board-1', 'board-2', 'board-3']);
    expect(keys(filterMeetingsHome(rows, filters({ meetingType: 'Technical' }), '', null))).toEqual(['tsc-1', 'tsc-2', 'quiet-1']);
    const lower = row({ key: 'lower', meeting: buildMeeting({ id: 'lower', meeting_type: ' technical ' }) });
    expect(keys(filterMeetingsHome([lower], filters({ meetingType: 'Technical' }), '', null))).toEqual(['lower']);
  });

  it('filters by foundation: its own meetings and its non-foundation children, with a project taking precedence', () => {
    const foundationRows = [
      row({ key: 'f', meeting: buildMeeting({ id: 'f', project_uid: 'f-1', is_foundation: true }) }),
      row({ key: 'child', meeting: buildMeeting({ id: 'child', project_uid: 'p-3', parent_project_uid: 'f-1' }) }),
      row({ key: 'sub', meeting: buildMeeting({ id: 'sub', project_uid: 'f-2', parent_project_uid: 'f-1', is_foundation: true }) }),
      row({ key: 'other', meeting: buildMeeting({ id: 'other', project_uid: 'p-4', parent_project_uid: 'f-2' }) }),
    ];
    expect(keys(filterMeetingsHome(foundationRows, filters({ foundation: 'f-1' }), '', null))).toEqual(['f', 'child']);
    expect(keys(filterMeetingsHome(foundationRows, filters({ foundation: 'f-1', project: 'p-3' }), '', null))).toEqual(['child']);
  });

  it('filters by the RSVP for each date', () => {
    expect(keys(filterMeetingsHome(rows, filters({ rsvp: 'pending' }), '', null))).toEqual(['board-3']);
    expect(keys(filterMeetingsHome(rows, filters({ rsvp: 'accepted' }), '', null))).toEqual(['board-2']);
    expect(keys(filterMeetingsHome(rows, filters({ rsvp: 'declined' }), '', null))).toEqual(['tsc-1', 'tsc-2', 'board-1']);
  });

  it('ignores RSVPs on meetings without invite responses', () => {
    expect(filterMeetingsHome(rows, filters({ rsvp: 'maybe' }), '', null)).toEqual([]);
  });

  it('keeps only meetings the viewer organizes', () => {
    expect(keys(filterMeetingsHome(rows, filters({ organizedByMe: true }), '', 'alovelace'))).toEqual(['tsc-1', 'tsc-2']);
    expect(filterMeetingsHome(rows, filters({ organizedByMe: true }), '', null)).toEqual([]);
  });

  it('counts co-organizers as organizers for Organized by me and Hide declined', () => {
    const declined = rsvp({ response_type: 'declined' });
    const grace = { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' };
    const coRows = [
      row({ key: 'flag-1', meeting: buildMeeting({ id: 'flag', created_by: grace, organizer: true }), myRsvp: declined }),
      row({ key: 'listed-1', meeting: buildMeeting({ id: 'listed', created_by: grace, organizers: ['auth0|ALovelace'] }), myRsvp: declined }),
      row({ key: 'other-1', meeting: buildMeeting({ id: 'other', created_by: grace, organizers: ['ghopper'] }), myRsvp: declined }),
    ];
    expect(keys(filterMeetingsHome(coRows, filters({ hideDeclined: true }), '', 'alovelace'))).toEqual(['flag-1', 'listed-1']);
    expect(keys(filterMeetingsHome(coRows, filters({ organizedByMe: true }), '', 'alovelace'))).toEqual(['flag-1', 'listed-1']);
  });

  it('hides a series only when every listed date is declined', () => {
    expect(keys(filterMeetingsHome(rows, filters({ hideDeclined: true }), '', null))).toEqual(['board-1', 'board-2', 'board-3', 'quiet-1']);
  });

  it('never hides organizer or responses-off meetings, and is ignored under Not going', () => {
    const declined = rsvp({ response_type: 'declined' });
    const extra = [
      row({ key: 'own-1', meeting: buildMeeting({ id: 'own', created_by: ada }), myRsvp: declined }),
      row({ key: 'other-1', meeting: buildMeeting({ id: 'other' }), myRsvp: declined }),
      row({ key: 'off-1', meeting: buildMeeting({ id: 'off', is_invite_responses_enabled: false }), myRsvp: declined }),
    ];
    expect(keys(filterMeetingsHome(extra, filters({ hideDeclined: true }), '', 'alovelace'))).toEqual(['own-1', 'off-1']);
    expect(keys(filterMeetingsHome(rows, filters({ hideDeclined: true, rsvp: 'declined' }), '', null))).toEqual(['tsc-1', 'tsc-2', 'board-1']);
  });

  it('combines search and filters', () => {
    expect(keys(filterMeetingsHome(rows, filters({ project: 'p-2', rsvp: 'declined' }), 'board', null))).toEqual(['board-1']);
    expect(filterMeetingsHome(rows, filters({ project: 'p-2' }), 'steering', null)).toEqual([]);
  });
});

describe('countAppliedMeetingFilters', () => {
  it('counts each applied filter', () => {
    expect(countAppliedMeetingFilters(MEETINGS_HOME_DEFAULT_FILTERS)).toBe(0);
    expect(
      countAppliedMeetingFilters(filters({ foundation: 'f-1', project: 'p-1', meetingType: 'Board', rsvp: 'pending', organizedByMe: true, hideDeclined: true }))
    ).toBe(6);
    expect(countAppliedMeetingFilters(filters({ rsvp: 'maybe' }))).toBe(1);
  });
});

describe('buildMeetingFilterChips', () => {
  const rows = [row(), row({ meeting: buildMeeting({ id: 'f', project_uid: 'f-1', project_name: 'Foundation One', is_foundation: true }) })];

  it('returns no chips for the defaults', () => {
    expect(buildMeetingFilterChips(MEETINGS_HOME_DEFAULT_FILTERS, rows)).toEqual([]);
  });

  it('labels every applied filter in popover order', () => {
    const chips = buildMeetingFilterChips(
      filters({ foundation: 'f-1', project: 'p-1', meetingType: 'Technical', rsvp: 'declined', organizedByMe: true, hideDeclined: true }),
      rows
    );
    expect(chips).toEqual([
      { key: 'foundation', prefix: 'Foundation:', label: 'Foundation One' },
      { key: 'project', prefix: 'Project:', label: 'Project One' },
      { key: 'meetingType', prefix: 'Meeting type:', label: 'Technical' },
      { key: 'rsvp', prefix: 'RSVP:', label: 'Not going' },
      { key: 'organizedByMe', label: 'Organized by me' },
      { key: 'hideDeclined', label: 'Hiding declined series' },
    ]);
  });

  it('falls back to the foundation or project UID and uses the RSVP option labels', () => {
    expect(buildMeetingFilterChips(filters({ foundation: 'f-9' }), rows)).toEqual([{ key: 'foundation', prefix: 'Foundation:', label: 'f-9' }]);
    expect(buildMeetingFilterChips(filters({ project: 'p-9' }), rows)).toEqual([{ key: 'project', prefix: 'Project:', label: 'p-9' }]);
    expect(buildMeetingFilterChips(filters({ rsvp: 'pending' }), rows)[0].label).toBe('Needs response');
    expect(buildMeetingFilterChips(filters({ rsvp: 'accepted' }), rows)[0].label).toBe('Going');
  });

  it('prefixes the Foundation/Project chip with Foundation when its pick is a foundation', () => {
    expect(buildMeetingFilterChips(filters({ project: 'f-1' }), rows)).toEqual([{ key: 'project', prefix: 'Foundation:', label: 'Foundation One' }]);
  });
});

describe('getMeetingGroupNames', () => {
  it('lists the group names in order, without blanks or repeats', () => {
    const committees = [
      { uid: 'c-1', name: 'TOC' },
      { uid: 'c-2' },
      { uid: 'c-3', name: '  ' },
      { uid: 'c-4', name: 'Security WG' },
      { uid: 'c-5', name: 'TOC' },
    ];

    expect(getMeetingGroupNames({ committees })).toEqual(['TOC', 'Security WG']);
    expect(getMeetingGroupNames({ committees: [] })).toEqual([]);
  });
});

describe('getMeetingRecurrenceLabel', () => {
  const base = { start_time: '2026-10-01T13:30:00Z', timezone: 'America/Los_Angeles' };

  it('names the cadence without the "Repeats" prefix', () => {
    expect(getMeetingRecurrenceLabel({ ...base, recurrence: WEEKLY })).toBe('Weekly on Thursday');
    expect(getMeetingRecurrenceLabel({ ...base, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 2, weekly_days: '2' } })).toBe(
      'Every 2 weeks on Monday'
    );
  });

  it('returns null for one-time meetings', () => {
    expect(getMeetingRecurrenceLabel({ ...base, recurrence: null })).toBeNull();
    expect(getMeetingRecurrenceLabel({ ...base, recurrence: { ...WEEKLY, end_times: 1 } })).toBeNull();
  });
});

describe('getMeetingRecurrenceTooltip', () => {
  const base = { start_time: '2026-10-01T13:30:00Z', timezone: 'America/Los_Angeles' };

  it('describes daily, weekly and bi-weekly series', () => {
    expect(getMeetingRecurrenceTooltip({ ...base, recurrence: { type: RecurrenceType.DAILY, repeat_interval: 1 } })).toBe('Repeats daily');
    expect(getMeetingRecurrenceTooltip({ ...base, recurrence: WEEKLY })).toBe('Repeats weekly on Thursday');
    expect(getMeetingRecurrenceTooltip({ ...base, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 2, weekly_days: '4' } })).toBe(
      'Repeats every 2 weeks on Wednesday'
    );
  });

  it('falls back to the start weekday in the meeting zone when weekly days are empty', () => {
    // 03:00 UTC Friday is still Thursday evening in Los Angeles
    const meeting = { start_time: '2026-10-02T03:00:00Z', timezone: 'America/Los_Angeles', recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 } };
    expect(getMeetingRecurrenceTooltip(meeting)).toBe('Repeats weekly on Thursday');
  });

  it('prefers the occurrence recurrence override', () => {
    const override: MeetingOccurrence = {
      ...occurrence(local(10, 15)),
      recurrence: { type: RecurrenceType.MONTHLY, repeat_interval: 3, monthly_day: 15 },
    };
    expect(getMeetingRecurrenceTooltip({ ...base, recurrence: WEEKLY }, override)).toBe('Repeats quarterly on day 15');
  });

  it('returns null for one-time meetings', () => {
    expect(getMeetingRecurrenceTooltip({ ...base, recurrence: null })).toBeNull();
    expect(getMeetingRecurrenceTooltip({ ...base, recurrence: { ...WEEKLY, end_times: 1 } })).toBeNull();
  });
});

describe('formatMeetingDateTime', () => {
  it('shows the day with the time range, or with the start time alone without a duration', () => {
    expect(formatMeetingDateTime('2026-10-01T13:30:00Z', 60, 'America/Los_Angeles')).toBe('Thu, Oct 1 · 6:30 – 7:30 AM PDT');
    expect(formatMeetingDateTime('2026-10-01T13:30:00Z', undefined, 'America/Los_Angeles')).toBe('Thu, Oct 1 · 6:30 AM PDT');
    expect(formatMeetingDateTime('not-a-date', 60)).toBe('');
  });
});

describe('formatMeetingWhen', () => {
  it('shows the day, the start time without a zone and the minutes', () => {
    expect(formatMeetingWhen('2026-11-05T17:00:00Z', 60, 'America/Los_Angeles')).toBe('Thu, Nov 5 · 9:00 AM · 60 min');
    expect(formatMeetingWhen('2026-10-01T13:30:00Z', 90, 'UTC')).toBe('Thu, Oct 1 · 1:30 PM · 90 min');
    expect(formatMeetingWhen('not-a-date', 60)).toBe('');
  });
});

describe('getMeetingWhenParts', () => {
  it('returns the day, the start time without a zone and the minutes, and nothing for an invalid start', () => {
    expect(getMeetingWhenParts('2026-11-05T17:00:00Z', 60, 'America/Los_Angeles')).toEqual(['Thu, Nov 5', '9:00 AM', '60 min']);
    expect(getMeetingWhenParts('not-a-date', 60)).toEqual([]);
  });
});

describe('formatMeetingWhenFull', () => {
  it('adds the cadence of a recurring date and nothing for a one-time meeting', () => {
    const series = buildMeeting({ recurrence: WEEKLY });
    expect(formatMeetingWhenFull(row({ meeting: series }))).toBe(`${formatMeetingWhen(local(10, 8).toISOString(), 60)} · Weekly on Thursday`);
    expect(formatMeetingWhenFull(row({ durationMinutes: 30 }))).toBe(formatMeetingWhen(local(10, 8).toISOString(), 30));
  });
});

describe('formatMeetingTimeRange', () => {
  it.each([
    ['2026-10-01T13:30:00Z', 60, 'America/Los_Angeles', '6:30 – 7:30 AM PDT'],
    ['2026-10-01T18:30:00Z', 60, 'America/Los_Angeles', '11:30 AM – 12:30 PM PDT'],
    ['2026-12-01T14:00:00Z', 30, 'America/Los_Angeles', '6:00 – 6:30 AM PST'],
    ['2026-10-01T13:30:00Z', 60, 'UTC', '1:30 – 2:30 PM UTC'],
    ['2026-11-01T08:30:00Z', 60, 'America/Los_Angeles', '1:30 AM PDT – 1:30 AM PST'],
    ['not-a-date', 60, 'UTC', ''],
  ])('%s +%i min in %s → %s', (start, duration, zone, label) => {
    expect(formatMeetingTimeRange(start, duration, zone)).toBe(label);
  });
});

describe('getMeetingStartsInLabel', () => {
  const inMs = (ms: number): Date => new Date(NOW.getTime() + ms);

  it('counts minutes under an hour, rounding up', () => {
    expect(getMeetingStartsInLabel(inMs(4 * 60_000), NOW)).toBe('Meeting starts in 4 min');
    expect(getMeetingStartsInLabel(inMs(30_000), NOW)).toBe('Meeting starts in 1 min');
  });

  it('counts whole hours under a day', () => {
    expect(getMeetingStartsInLabel(inMs(59.5 * 60_000), NOW)).toBe('Meeting starts in 1 h');
    expect(getMeetingStartsInLabel(inMs(3 * 3_600_000 + 10 * 60_000), NOW)).toBe('Meeting starts in 3 h');
  });

  it('hides beyond a day, once started, and for invalid input', () => {
    expect(getMeetingStartsInLabel(inMs(24 * 3_600_000), NOW)).toBeNull();
    expect(getMeetingStartsInLabel(inMs(-60_000), NOW)).toBeNull();
    expect(getMeetingStartsInLabel('not-a-date', NOW)).toBeNull();
  });
});

describe('getMeetingVisibilityBadges', () => {
  it.each<[MeetingVisibility | null, boolean | null, MeetingVisibilityKind[]]>([
    [MeetingVisibility.PUBLIC, false, [MeetingVisibilityKind.PUBLIC]],
    [null, null, [MeetingVisibilityKind.PUBLIC]],
    [MeetingVisibility.PRIVATE, null, [MeetingVisibilityKind.PRIVATE]],
    [MeetingVisibility.PUBLIC, true, [MeetingVisibilityKind.RESTRICTED]],
    [MeetingVisibility.PRIVATE, true, [MeetingVisibilityKind.RESTRICTED, MeetingVisibilityKind.PRIVATE]],
  ])('%s, restricted %s → %j', (visibility, restricted, kinds) => {
    expect(getMeetingVisibilityBadges({ visibility, restricted })).toEqual(kinds.map((kind) => MEETING_VISIBILITY_INFO[kind]));
  });

  it('carries the tooltip copy', () => {
    expect(MEETING_VISIBILITY_INFO[MeetingVisibilityKind.PUBLIC]).toMatchObject({ title: 'Public', description: null, icon: 'fa-solid fa-globe' });
    expect(MEETING_VISIBILITY_INFO[MeetingVisibilityKind.RESTRICTED]).toMatchObject({ title: 'Restricted', description: 'Only invited people can join' });
  });
});

describe('getMeetingHomeRowLink', () => {
  const upcomingRow = (meeting: Meeting, start: Date): MeetingHomeRow => ({
    key: meeting.id,
    meeting,
    occurrence: null,
    title: meeting.title,
    occurrenceId: null,
    startTime: start.toISOString(),
    durationMinutes: 60,
  });
  const pastRow = (overrides: Partial<PastMeeting>): MeetingHomeRow => {
    const meeting: PastMeeting = {
      ...buildMeeting({ id: '123' }),
      scheduled_start_time: '2025-10-01T16:00:00Z',
      scheduled_end_time: '2025-10-01T17:00:00Z',
      meeting_id: '123',
      occurrence_id: '1759334400',
      platform_meeting_id: '',
      sessions: [],
      meeting_and_occurrence_id: '123-1759334400000',
      ...overrides,
    };
    return {
      key: '123-1759334400000',
      meeting,
      occurrence: null,
      title: meeting.title,
      occurrenceId: null,
      startTime: '2025-10-01T16:00:00Z',
      durationMinutes: 60,
    };
  };
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  it('opens an upcoming date in a new tab with its password and date', () => {
    const link = getMeetingHomeRowLink(upcomingRow(buildMeeting({ id: '123', password: 'p w' }), future), 'upcoming');

    expect(link).toEqual({ url: `/meetings/123?password=p+w&occurrence=${future.getTime()}`, newTab: true });
  });

  it('leaves the password out when the meeting has none', () => {
    expect(getMeetingHomeRowLink(upcomingRow(buildMeeting({ id: '123' }), future), 'upcoming').url).toBe(`/meetings/123?occurrence=${future.getTime()}`);
  });

  it('opens a past meeting in place on its meeting page for invitees', () => {
    expect(getMeetingHomeRowLink(pastRow({ organizer: false }), 'past')).toEqual({ url: '/meetings/123-1759334400000', newTab: false });
  });

  it('opens a past meeting on the admin details page with the project for organizers', () => {
    expect(getMeetingHomeRowLink(pastRow({ organizer: true, is_foundation: false, project_slug: 'kubernetes' }), 'past')).toEqual({
      url: '/project/meetings/123-1759334400000/details?project=kubernetes',
      newTab: false,
    });
    expect(getMeetingHomeRowLink(pastRow({ organizer: true, is_foundation: true, project_slug: 'cncf' }), 'past').url).toBe(
      '/foundation/meetings/123-1759334400000/details?project=cncf'
    );
  });

  it('falls back to the flat details route when the tier is unknown', () => {
    expect(getMeetingHomeRowLink(pastRow({ organizer: true }), 'past').url).toBe('/meetings/123-1759334400000/details');
  });
});

describe('getMeetingProjectUrl', () => {
  it('links to the project or foundation overview', () => {
    expect(getMeetingProjectUrl({ project_slug: 'kubernetes', is_foundation: false })).toBe('/project/overview?project=kubernetes');
    expect(getMeetingProjectUrl({ project_slug: 'cncf', is_foundation: true })).toBe('/foundation/overview?project=cncf');
  });

  it('has no link without a slug', () => {
    expect(getMeetingProjectUrl({ project_slug: undefined, is_foundation: true })).toBeNull();
  });
});

describe('getMeetingHomeRowProject', () => {
  it('names the project with its logo, link and accessible label', () => {
    expect(getMeetingHomeRowProject({ project_name: ' cncf ', project_logo_url: 'logo.svg', project_slug: 'cncf', is_foundation: true })).toEqual({
      name: 'cncf',
      logo: 'logo.svg',
      url: '/foundation/overview?project=cncf',
      label: 'Jump to foundation: cncf',
    });
  });

  it('is null without a project name', () => {
    expect(getMeetingHomeRowProject({ project_name: ' ' })).toBeNull();
  });
});

describe('getMeetingHomeRowType', () => {
  it.each<[string | null, { label: string; icon: string } | null]>([
    ['Technical', { label: 'Technical', icon: MEETING_TYPE_CONFIGS['technical'].icon }],
    ['Custom', { label: 'Custom', icon: DEFAULT_MEETING_TYPE_CONFIG.icon }],
    ['None', null],
    [null, null],
  ])('%s → %j', (type, expected) => {
    expect(getMeetingHomeRowType({ meeting_type: type })).toEqual(expected);
  });
});

describe('getMeetingHomeRowOrganizers', () => {
  const jane = { name: 'Jane Doe', username: 'jdoe', email: 'jane@example.org', profile_picture: 'https://example.org/jane.png' };
  const janeAvatar = { key: 'jdoe', label: 'Jane Doe', name: 'Jane Doe', photo: 'https://example.org/jane.png' };
  const labels = (meeting: Pick<Meeting, 'created_by' | 'owner' | 'organizers'>) => getMeetingHomeRowOrganizers(meeting, 'auth0|viewer').map((o) => o.label);

  it('puts the owner or creator first with their name and photo', () => {
    expect(getMeetingHomeRowOrganizers({ created_by: jane, organizers: [] }, 'auth0|viewer')).toEqual([janeAvatar]);
  });

  it('adds the other organizers by username, without the primary in either form or duplicates', () => {
    expect(getMeetingHomeRowOrganizers({ created_by: jane, organizers: ['Jane@Example.org', 'auth0|JDOE', 'auth0|ASmith', 'asmith', ' '] }, 'viewer')).toEqual([
      janeAvatar,
      { key: 'asmith', label: 'ASmith', name: 'ASmith', photo: '' },
    ]);
  });

  it.each<[Pick<Meeting, 'created_by' | 'owner' | 'organizers'>, string[]]>([
    [{ created_by: jane, organizers: ['bob@example.org'] }, ['Jane Doe', 'bob']],
    [{ created_by: { name: 'Viewer Person', username: 'viewer', email: '' }, organizers: ['viewer', 'asmith'] }, ['You', 'asmith']],
    [{ created_by: jane, organizers: ['viewer'] }, ['Jane Doe', 'You']],
    [{ owner: { name: 'Owen Owner', username: 'owen', email: '' }, created_by: jane, organizers: ['jdoe'] }, ['Owen Owner', 'jdoe']],
    [{ organizers: ['asmith'] }, []],
  ])('%j → %j', (meeting, expected) => {
    expect(labels(meeting)).toEqual(expected);
  });

  it('keeps the real name behind "You" for the initials', () => {
    expect(getMeetingHomeRowOrganizers({ created_by: { name: 'Viewer Person', username: 'viewer', email: '' }, organizers: [] }, 'viewer')[0]).toMatchObject({
      label: 'You',
      name: 'Viewer Person',
    });
  });
});

describe('getMeetingRsvpToastMessage', () => {
  it('names the answer and, for a series, the dates it covers', () => {
    expect(getMeetingRsvpToastMessage({ response_type: 'accepted', scope: 'single' }, true)).toBe('Meeting RSVP set to “Going” for this occurrence');
    expect(getMeetingRsvpToastMessage({ response_type: 'maybe', scope: 'this_and_following' }, true)).toBe(
      'Meeting RSVP set to “Maybe” for this and following occurrences'
    );
    expect(getMeetingRsvpToastMessage({ response_type: 'declined', scope: 'all' }, true)).toBe('Meeting RSVP set to “Not going” for all occurrences');
  });

  it('names no dates for a one-time meeting', () => {
    expect(getMeetingRsvpToastMessage({ response_type: 'accepted', scope: 'all' }, false)).toBe('Meeting RSVP set to “Going”');
  });
});
