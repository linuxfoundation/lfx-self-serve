// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingRsvp, PastMeeting, PastMeetingRecording, PastMeetingSummary, PastMeetingTranscript } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeStore } from './meetings-home.store';

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number): Date => new Date(Date.now() + days * DAY_MS);
const seconds = (date: Date): string => String(Math.floor(date.getTime() / 1000));

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Project One',
    start_time: inDays(2).toISOString(),
    duration: 60,
    timezone: 'UTC',
    title: 'Sync',
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

function buildPastMeeting(id: string, start: Date): PastMeeting {
  return {
    ...buildMeeting({ id, title: `Past ${id}`, start_time: start.toISOString() }),
    scheduled_start_time: start.toISOString(),
    scheduled_end_time: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    meeting_id: 'm-past',
    occurrence_id: seconds(start),
    meeting_and_occurrence_id: `m-past-${id}`,
    platform_meeting_id: '',
    sessions: [],
  };
}

function weeklyMeeting(dates: Date[], overrides: Partial<Meeting> = {}): Meeting {
  return buildMeeting({
    recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '1' },
    occurrences: dates.map((date) => ({ occurrence_id: seconds(date), start_time: date.toISOString(), duration: 60 })),
    ...overrides,
  });
}

function rsvp(overrides: Partial<MeetingRsvp> = {}): MeetingRsvp {
  return {
    id: 'r-1',
    meeting_id: 'm-1',
    registrant_id: 'reg-1',
    username: 'viewer',
    email: 'viewer@example.test',
    response_type: 'accepted',
    scope: 'all',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('MeetingsHomeStore', () => {
  let upcoming$: Subject<Meeting[]>;
  let past$: Subject<PastMeeting[]>;
  let latestPast$: Subject<PastMeeting[]>;
  let summary$: Subject<PastMeetingSummary>;
  let meetingService: Record<string, unknown>;
  let identity: ReturnType<typeof signal<string>>;
  let confirmed: ReturnType<typeof signal<MeetingRsvp[]>>;
  let removed: ReturnType<typeof signal<ReadonlySet<string>>>;
  let userService: Record<string, unknown>;

  const create = (platform = 'browser'): MeetingsHomeStore => {
    TestBed.configureTestingModule({
      providers: [
        MeetingsHomeStore,
        { provide: PLATFORM_ID, useValue: platform },
        { provide: UserService, useValue: userService },
        { provide: MeetingService, useValue: meetingService },
      ],
    });
    const store = TestBed.inject(MeetingsHomeStore);
    TestBed.tick();
    return store;
  };

  beforeEach(() => {
    upcoming$ = new Subject();
    past$ = new Subject();
    latestPast$ = new Subject();
    summary$ = new Subject();
    identity = signal('viewer-a');
    confirmed = signal<MeetingRsvp[]>([]);
    removed = signal<ReadonlySet<string>>(new Set());
    meetingService = {
      removedRegistrationMeetingIds: removed,
      getPastMeetingSummary: vi.fn(() => summary$),
      getPastMeetingTranscript: vi.fn(() =>
        of({ recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://zoom.example/t.vtt' }] } as PastMeetingTranscript)
      ),
      getPastMeetingRecording: vi.fn(() =>
        of({
          sessions: [
            { share_url: 'https://zoom.example/small', total_size: 1 },
            { share_url: 'https://zoom.example/large', total_size: 9 },
          ],
        } as PastMeetingRecording)
      ),
    };
    userService = {
      meetingFeedIdentity: identity,
      viewerUsername: signal('viewer'),
      getUserMeetings: vi.fn(() => upcoming$),
      getUserPastMeetings: vi.fn(() => past$),
      getUserLatestPastMeetings: vi.fn(() => latestPast$),
      confirmedMeetingRsvps: vi.fn(() => confirmed()),
      isMeetingRsvpCurrent: vi.fn(() => true),
    };
  });

  describe('loading', () => {
    it('requests both feeds up front and stays loading until each one answers', () => {
      const store = create();

      expect(userService['getUserMeetings']).toHaveBeenCalledTimes(1);
      expect(userService['getUserPastMeetings']).toHaveBeenCalledTimes(1);
      expect(store.upcomingLoading()).toBe(true);
      expect(store.pastLoading()).toBe(true);

      upcoming$.next([buildMeeting()]);
      expect(store.upcomingLoading()).toBe(false);
      expect(store.loading()).toBe(false);
      expect(store.pastLoading()).toBe(true);

      past$.next([buildPastMeeting('a', inDays(-1))]);
      expect(store.pastLoading()).toBe(false);
      expect(store.upcomingRows()).toHaveLength(1);
      expect(store.pastRows()).toHaveLength(1);
    });

    it('flags a failed feed and loads it again on retry', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = create();

      upcoming$.error(new Error('down'));

      expect(store.upcomingLoading()).toBe(false);
      expect(store.failed()).toBe(true);
      expect(console.error).toHaveBeenCalled();

      const retried$ = new Subject<Meeting[]>();
      (userService['getUserMeetings'] as ReturnType<typeof vi.fn>).mockReturnValue(retried$);
      store.retry();
      retried$.next([buildMeeting()]);

      expect(store.failed()).toBe(false);
      expect(store.upcomingRows()).toHaveLength(1);
    });

    it('does not request anything during server rendering', () => {
      const store = create('server');

      expect(userService['getUserMeetings']).not.toHaveBeenCalled();
      expect(store.loading()).toBe(true);
    });
  });

  describe('merging', () => {
    it('drops removed registrations but keeps meetings the viewer organizes', () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'attendee' }), buildMeeting({ id: 'organized', organizer: true })]);

      removed.set(new Set(['attendee', 'organized']));

      expect(store.upcomingRows().map((row) => row.meeting.id)).toEqual(['organized']);
    });

    it('shows an answer confirmed this session on the date it applies to', () => {
      const first = inDays(2);
      const second = inDays(9);
      const store = create();
      upcoming$.next([
        buildMeeting({
          recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '1' },
          occurrences: [first, second].map((date) => ({ occurrence_id: seconds(date), start_time: date.toISOString(), duration: 60 })),
          my_rsvp: null,
          my_rsvps: [],
        }),
      ]);
      expect(store.upcomingRows().map((row) => row.myRsvp)).toEqual([null, null]);

      const answer = rsvp({ scope: 'single', occurrence_id: seconds(second), response_type: 'declined' });
      confirmed.set([answer]);

      expect(store.upcomingRows().map((row) => row.myRsvp)).toEqual([null, answer]);
    });

    it('drops answers from registrations that have ended', () => {
      const store = create();
      const ended = rsvp({ id: 'r-ended', registrant_id: 'reg-ended', response_type: 'declined' });
      (userService['isMeetingRsvpCurrent'] as ReturnType<typeof vi.fn>).mockImplementation((answer: MeetingRsvp) => answer.registrant_id !== 'reg-ended');

      upcoming$.next([buildMeeting({ my_rsvp: ended, my_rsvps: [ended] })]);

      expect(store.upcomingRows()[0].myRsvp).toBeNull();
    });

    it('drops a meeting once it ends while the page stays open', () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      try {
        const store = create();
        upcoming$.next([buildMeeting({ start_time: new Date().toISOString() })]);
        expect(store.upcomingRows()).toHaveLength(1);

        vi.advanceTimersByTime(2 * 60 * 60 * 1000);

        expect(store.upcomingRows()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('prefers the confirmation over an indexed copy of the same answer', () => {
      const [first, second] = [inDays(2), inDays(9)];
      const indexed = rsvp({ id: 'r-later', scope: 'single', occurrence_id: seconds(second), response_type: 'accepted' });
      const store = create();
      upcoming$.next([
        weeklyMeeting([first, second], { my_rsvp: rsvp({ response_type: 'maybe', created_at: inDays(-3).toISOString() }), my_rsvps: [indexed] }),
      ]);

      confirmed.set([{ ...indexed, response_type: 'declined' }]);

      expect(store.upcomingRows()[1].myRsvp?.response_type).toBe('declined');
    });

    it.each([true, false])('lets a same-time confirmation replace the overlay (indexed history: %s)', (withHistory) => {
      const indexed = rsvp({ id: 'r-x' });
      const store = create();
      confirmed.set([{ ...indexed, response_type: 'declined' }]);

      upcoming$.next([buildMeeting({ my_rsvp: indexed, my_rsvps: withHistory ? [indexed] : undefined })]);

      expect(store.upcomingRows()[0].myRsvp?.response_type).toBe('declined');
    });

    it('applies answers saved this session per date when indexed history is unavailable', () => {
      const [first, second] = [inDays(2), inDays(9)];
      const all = rsvp({ created_at: inDays(-2).toISOString() });
      const later = rsvp({ id: 'r-2', scope: 'single', occurrence_id: seconds(second), response_type: 'declined' });
      const store = create();
      confirmed.set([all, later]);

      upcoming$.next([weeklyMeeting([first, second], { my_rsvp: all, my_rsvps: undefined })]);

      expect(store.upcomingRows().map((row) => row.myRsvp?.response_type)).toEqual(['accepted', 'declined']);
    });

    it('maps past meetings to rows, most recent first, keyed by their resource id', () => {
      const store = create();
      past$.next([buildPastMeeting('older', inDays(-5)), buildPastMeeting('newer', inDays(-1))]);

      expect(store.pastRows().map((row) => row.key)).toEqual(['m-past-newer', 'm-past-older']);
      expect(store.pastRows()[0].occurrence).toBeNull();
    });

    it('skips cancelled dates and meetings that already ended', () => {
      const kept = inDays(3);
      const cancelled = inDays(10);
      const store = create();
      upcoming$.next([
        buildMeeting({
          id: 'series',
          recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '1' },
          occurrences: [
            { occurrence_id: seconds(kept), start_time: kept.toISOString(), duration: 60 },
            { occurrence_id: seconds(cancelled), start_time: cancelled.toISOString(), duration: 60, status: 'cancel' },
          ],
        }),
        buildMeeting({ id: 'ended', start_time: inDays(-1).toISOString() }),
      ]);

      expect(store.upcomingRows().map((row) => row.key)).toEqual([`series:${seconds(kept)}`]);
    });
  });

  describe('identity', () => {
    it("re-requests on a viewer change and never shows the previous viewer's rows", () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'theirs' })]);
      const next$ = new Subject<Meeting[]>();
      (userService['getUserMeetings'] as ReturnType<typeof vi.fn>).mockReturnValue(next$);

      identity.set('viewer-b');
      TestBed.tick();

      expect(userService['getUserMeetings']).toHaveBeenCalledTimes(2);
      expect(store.upcomingRows()).toEqual([]);
      expect(store.upcomingLoading()).toBe(true);

      next$.next([buildMeeting({ id: 'mine' })]);
      expect(store.upcomingRows().map((row) => row.meeting.id)).toEqual(['mine']);
    });
  });

  describe('grouping and paging', () => {
    const manyMeetings = (count: number): Meeting[] =>
      Array.from({ length: count }, (_, index) => buildMeeting({ id: `m-${index}`, title: `Meeting ${index}`, start_time: inDays(40 + index).toISOString() }));

    it('shows one page, counts every row per group and loads the next page on demand', () => {
      const store = create();
      upcoming$.next(manyMeetings(MEETINGS_HOME_PAGE_SIZE + 5));

      const shown = (): number => store.groups().reduce((total, group) => total + group.rows.length, 0);
      const counted = (): number => store.groups().reduce((total, group) => total + group.count, 0);
      expect(shown()).toBe(MEETINGS_HOME_PAGE_SIZE);
      expect(store.hasMore()).toBe(true);

      store.loadMore();

      expect(shown()).toBe(MEETINGS_HOME_PAGE_SIZE + 5);
      expect(counted()).toBe(MEETINGS_HOME_PAGE_SIZE + 5);
      expect(store.hasMore()).toBe(false);
    });

    it('goes back to the first page when the search changes', () => {
      const store = create();
      upcoming$.next(manyMeetings(MEETINGS_HOME_PAGE_SIZE * 2 + 1));
      store.loadMore();
      expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE * 2);

      store.setSearch('meeting');

      expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE);
    });

    it('searches titles case-insensitively', () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'a', title: 'Board Review' }), buildMeeting({ id: 'b', title: 'Tech Sync' })]);

      store.setSearch('board');

      expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['a']);
      expect(store.hasActiveQuery()).toBe(true);
    });
  });

  describe('tabs and reset', () => {
    it('clears filters but keeps the search on a tab switch', () => {
      const store = create();
      store.setSearch('sync');
      store.setFilters({ ...store.filters(), organizedByMe: true });

      store.setTab('past');

      expect(store.tab()).toBe('past');
      expect(store.filters().organizedByMe).toBe(false);
      expect(store.search()).toBe('sync');
    });

    it('builds one chip per applied filter and clears only the removed one', () => {
      const store = create();
      upcoming$.next([buildMeeting()]);
      store.setFilters({ ...store.filters(), project: 'p-1', organizedByMe: true });

      expect(store.filterChips()).toEqual([
        { key: 'project', label: 'Project: Project One' },
        { key: 'organizedByMe', label: 'Organized by me' },
      ]);

      store.clearFilter('project');

      expect(store.filters()).toEqual({ ...MEETINGS_HOME_DEFAULT_FILTERS, organizedByMe: true });
      expect(store.filterChips().map((chip) => chip.key)).toEqual(['organizedByMe']);
    });

    it('clears both filters and search on reset', () => {
      const store = create();
      store.setSearch('sync');
      store.setFilters({ ...store.filters(), hideDeclined: true });

      store.resetFilters();

      expect(store.search()).toBe('');
      expect(store.hasActiveQuery()).toBe(false);
    });
  });

  describe('last meeting', () => {
    const summary = { uid: 's-1', approved: true, requires_approval: false } as PastMeetingSummary;

    it('paints from the latest-past feed before the full past list answers', () => {
      const store = create();
      expect(store.lastMeetingLoading()).toBe(true);

      latestPast$.next([buildPastMeeting('b', inDays(-1)), buildPastMeeting('a', inDays(-3))]);

      expect(store.lastMeetingLoading()).toBe(false);
      expect(store.pastLoading()).toBe(true);
      expect(store.lastMeeting()?.key).toBe('m-past-b');
    });

    it('is null when the viewer has no past meetings', () => {
      const store = create();
      latestPast$.next([]);

      expect(store.lastMeeting()).toBeNull();
      expect(store.lastMeetingFailed()).toBe(false);
    });

    it('marks the feed failed instead of empty when it errors', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = create();
      latestPast$.error(new Error('down'));

      expect(store.lastMeetingFailed()).toBe(true);
      expect(store.lastMeeting()).toBeNull();
    });

    it("loads the last meeting's summary, transcript and recording", () => {
      const store = create();
      latestPast$.next([buildPastMeeting('b', inDays(-1))]);
      TestBed.tick();

      expect(meetingService['getPastMeetingSummary']).toHaveBeenCalledWith('m-past-b');
      expect(store.lastMeetingSummary()).toBeUndefined();
      expect(store.lastMeetingHasTranscript()).toBe(true);
      expect(store.lastMeetingRecordingUrl()).toBe('https://zoom.example/large');

      summary$.next(summary);
      expect(store.lastMeetingSummary()).toEqual(summary);

      store.setLastMeetingSummary({ ...summary, approved: false });
      expect(store.lastMeetingSummary()?.approved).toBe(false);
    });

    it('reads a missing or failed artifact lookup as none, logging only the failure', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      logged.mockClear();
      meetingService['getPastMeetingSummary'] = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 404 })));
      meetingService['getPastMeetingRecording'] = vi.fn(() => throwError(() => new Error('down')));
      const store = create();
      latestPast$.next([buildPastMeeting('b', inDays(-1))]);
      TestBed.tick();

      expect(store.lastMeetingSummary()).toBeNull();
      expect(store.lastMeetingRecordingUrl()).toBeNull();
      expect(store.lastMeetingHasTranscript()).toBe(true);
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });
});
