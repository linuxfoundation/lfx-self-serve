// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingRsvp, PastMeeting, PastMeetingRecording, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
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
  let meetingsRefresh$: Subject<void>;
  let pastMeetingsRefresh$: Subject<void>;
  let toast: { show: ReturnType<typeof vi.fn>; toasts: ReturnType<typeof signal<{ id: string }[]>> };

  const create = (platform = 'browser'): MeetingsHomeStore => {
    TestBed.configureTestingModule({
      providers: [
        MeetingsHomeStore,
        { provide: PLATFORM_ID, useValue: platform },
        { provide: UserService, useValue: userService },
        { provide: MeetingService, useValue: meetingService },
        { provide: UiToastService, useValue: toast },
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
    meetingsRefresh$ = new Subject();
    pastMeetingsRefresh$ = new Subject();
    const toasts = signal<{ id: string }[]>([]);
    toast = {
      toasts,
      show: vi.fn(() => {
        toasts.update((items) => [...items, { id: `toast-${items.length}` }]);
        return { id: `toast-${toasts().length - 1}`, dismiss: vi.fn() };
      }),
    };
    meetingService = {
      removedRegistrationMeetingIds: removed,
      getPublicMeetingJoinUrl: vi.fn(() => of({ link: 'https://zoom.example.test/j/1' })),
      getPastMeetingSummary: vi.fn(() => summary$),
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
      meetingsRefresh$,
      pastMeetingsRefresh$,
      confirmedMeetingRsvps: vi.fn(() => confirmed()),
      isMeetingRsvpCurrent: vi.fn(() => true),
      authenticated: signal(true),
      meetingJoinIdentity: signal({ name: 'Real Viewer', email: 'real@example.test' }),
    };
  });

  describe('loading', () => {
    it('requests both feeds up front and stays loading until each one answers', () => {
      const store = create();

      expect(userService['getUserMeetings']).toHaveBeenCalledTimes(1);
      expect(userService['getUserPastMeetings']).toHaveBeenCalledTimes(1);
      expect(userService['getUserMeetings']).toHaveBeenCalledWith({ includeAttendance: true });
      expect(userService['getUserPastMeetings']).toHaveBeenCalledWith({ includeArtifactsAndAttendance: true });
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

    it('keeps the loaded rows on a failed refresh, shows one toast and takes the next refresh', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = create();
      upcoming$.next([buildMeeting({ id: 'kept' })]);
      past$.next([buildPastMeeting('a', inDays(-1))]);

      upcoming$.error(new Error('down'));
      past$.error(new Error('down'));

      expect(store.upcomingRows().map((row) => row.meeting.id)).toEqual(['kept']);
      expect(store.pastRows()).toHaveLength(1);
      expect(store.nextRow()?.meeting.id).toBe('kept');
      expect(store.upcomingFailed()).toBe(false);
      expect(store.pastFailed()).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Failed to load meetings for the meetings home page:', expect.any(Error));
      expect(toast.show).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', position: 'bottom-center' }));

      const refreshed$ = new Subject<Meeting[]>();
      (userService['getUserMeetings'] as ReturnType<typeof vi.fn>).mockReturnValue(refreshed$);
      meetingsRefresh$.next();
      refreshed$.next([buildMeeting({ id: 'fresh' })]);

      expect(userService['getUserMeetings']).toHaveBeenCalledTimes(2);
      expect(store.upcomingRows().map((row) => row.meeting.id)).toEqual(['fresh']);
    });

    it('takes the next refresh after a failed first load and clears the error', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = create();
      upcoming$.error(new Error('down'));
      expect(store.upcomingFailed()).toBe(true);

      const refreshed$ = new Subject<Meeting[]>();
      (userService['getUserMeetings'] as ReturnType<typeof vi.fn>).mockReturnValue(refreshed$);
      meetingsRefresh$.next();
      refreshed$.next([buildMeeting()]);

      expect(store.upcomingFailed()).toBe(false);
      expect(store.upcomingRows()).toHaveLength(1);
      expect(toast.show).not.toHaveBeenCalled();
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
      const [organized] = store.upcomingRows();
      expect(organized.meeting).toMatchObject({ invited: false, my_registrant_ids: [], my_rsvp: null });
      expect(organized.myRsvp ?? null).toBeNull();
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

  describe('pending RSVPs', () => {
    it('lists every unanswered date the viewer can answer, whatever the search and filters', () => {
      const [first, second] = [inDays(2), inDays(9)];
      const store = create();
      upcoming$.next([
        weeklyMeeting([first, second], { id: 'series', my_rsvp: null, my_rsvps: [] }),
        buildMeeting({ id: 'answered', my_rsvp: rsvp({ meeting_id: 'answered' }), my_rsvps: [] }),
        buildMeeting({ id: 'not-invited', invited: false, organizer: true, my_rsvp: null, my_rsvps: [] }),
        buildMeeting({ id: 'responses-off', is_invite_responses_enabled: false, my_rsvp: null, my_rsvps: [] }),
        buildMeeting({ id: 'removed', organizer: true, my_rsvp: null, my_rsvps: [] }),
      ]);
      removed.set(new Set(['removed']));
      store.setSearch('no match');

      expect(store.pendingRsvpRows().map((row) => row.key)).toEqual([`series:${seconds(first)}`, `series:${seconds(second)}`]);
    });

    it('drops a date once answered, and every covered date after a recurring answer', () => {
      const [first, second, third] = [inDays(2), inDays(9), inDays(16)];
      const store = create();
      upcoming$.next([weeklyMeeting([first, second, third], { id: 'series', my_rsvp: null, my_rsvps: [] })]);

      confirmed.set([rsvp({ meeting_id: 'series', scope: 'single', occurrence_id: seconds(first) })]);
      expect(store.pendingRsvpRows()).toHaveLength(2);

      confirmed.update((answers) => [...answers, rsvp({ id: 'r-2', meeting_id: 'series', scope: 'this_and_following', occurrence_id: seconds(second) })]);
      expect(store.pendingRsvpRows()).toEqual([]);
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

    it('resets the search, filters and page on a viewer change', () => {
      const store = create();
      upcoming$.next(Array.from({ length: MEETINGS_HOME_PAGE_SIZE * 2 }, (_, index) => buildMeeting({ id: `m-${index}` })));
      store.loadMore();
      store.setSearch('sync');
      store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-1' });

      identity.set('viewer-b');
      TestBed.tick();

      expect(store.search()).toBe('');
      expect(store.filters()).toEqual(MEETINGS_HOME_DEFAULT_FILTERS);
      expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE);
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
      upcoming$.next([buildMeeting({ id: 'a', title: 'Board Review' }), buildMeeting({ id: 'b', title: 'Tech Sync', start_time: inDays(1).toISOString() })]);

      store.setSearch('board');

      expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['a']);
      expect(store.hasActiveQuery()).toBe(true);
    });
  });

  describe('next meeting', () => {
    it('is the soonest date, whatever the search, and stays in the Upcoming list', () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'later', start_time: inDays(3).toISOString() }), buildMeeting({ id: 'soon', start_time: inDays(1).toISOString() })]);

      expect(store.nextRow()?.meeting.id).toBe('soon');
      expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['soon', 'later']);

      store.setSearch('nothing matches');
      expect(store.nextRow()?.meeting.id).toBe('soon');
      expect(store.filteredRows()).toEqual([]);
    });

    it('is the first date of a series', () => {
      const store = create();
      const series = weeklyMeeting([inDays(1), inDays(8)]);
      upcoming$.next([series]);

      expect(store.nextRow()?.occurrenceId).toBe(seconds(inDays(1)));
      expect(store.filteredRows()).toHaveLength(2);
    });

    it('passes over a date that is over but still in its join buffer for the one starting next', () => {
      const store = create();
      const ended = new Date(Date.now() - 70 * 60_000);
      upcoming$.next([buildMeeting({ id: 'over', start_time: ended.toISOString() }), buildMeeting({ id: 'up' })]);

      expect(store.upcomingRows().map((row) => row.meeting.id)).toEqual(['over', 'up']);
      expect(store.nextRow()?.meeting.id).toBe('up');
      expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['over', 'up']);
    });

    it('builds the join link for the real viewer inside the join window only', () => {
      const store = create();
      upcoming$.next([buildMeeting({ password: 'pw' })]);
      TestBed.tick();
      expect(store.nextRowJoinable()).toBe(false);
      expect(meetingService['getPublicMeetingJoinUrl']).not.toHaveBeenCalled();

      upcoming$.next([buildMeeting({ password: 'pw', start_time: new Date(Date.now() + 5 * 60_000).toISOString() })]);
      TestBed.tick();

      expect(store.nextRowJoinable()).toBe(true);
      expect(meetingService['getPublicMeetingJoinUrl']).toHaveBeenCalledWith('m-1', 'pw', { email: 'real@example.test' });
      expect(store.nextRowJoinUrl()).toMatch(/^https:\/\/zoom\.example\.test\/j\/1\?uname=Real%20Viewer&un=/);
    });

    it("never offers the previous meeting's join link while the next one's loads", () => {
      const pending$ = new Subject<{ link: string }>();
      const store = create();
      const soon = new Date(Date.now() + 5 * 60_000).toISOString();
      upcoming$.next([buildMeeting({ start_time: soon })]);
      TestBed.tick();
      expect(store.nextRowJoinUrl()).toMatch(/^https:\/\/zoom\.example\.test\/j\/1/);

      (meetingService['getPublicMeetingJoinUrl'] as ReturnType<typeof vi.fn>).mockReturnValueOnce(pending$);
      upcoming$.next([buildMeeting({ id: 'm-2', start_time: soon })]);
      TestBed.tick();
      expect(store.nextRowJoinUrl()).toBeNull();

      pending$.next({ link: 'https://zoom.example.test/j/2' });
      expect(store.nextRowJoinUrl()).toMatch(/^https:\/\/zoom\.example\.test\/j\/2/);
    });

    it('never lets the viewer join a restricted meeting they are not invited to', () => {
      const store = create();
      upcoming$.next([buildMeeting({ restricted: true, invited: false, start_time: new Date(Date.now() + 5 * 60_000).toISOString() })]);
      TestBed.tick();

      expect(store.nextRowJoinable()).toBe(false);
      expect(store.nextRowJoinUrl()).toBeNull();
    });

    it('pages the card through the dates that overlap the next one, keeping all of them listed and joining the one shown', () => {
      const store = create();
      const start = Date.now() + 5 * 60_000;
      const at = (minutes: number): string => new Date(start + minutes * 60_000).toISOString();
      upcoming$.next([
        buildMeeting({ id: 'first', start_time: at(0) }),
        buildMeeting({ id: 'overlap', start_time: at(59) }),
        buildMeeting({ id: 'after', start_time: at(60) }),
      ]);
      TestBed.tick();

      expect(store.concurrentNextRows().map((row) => row.meeting.id)).toEqual(['first', 'overlap']);
      expect(store.nextCardIndex()).toBe(0);
      expect(store.nextCardRow()?.meeting.id).toBe('first');
      expect(store.nextRowJoinable()).toBe(true);

      store.stepNextCard(-1);
      expect(store.nextCardRow()?.meeting.id).toBe('first');

      store.stepNextCard(1);
      store.stepNextCard(1);
      expect(store.nextCardIndex()).toBe(1);
      expect(store.nextCardRow()?.meeting.id).toBe('overlap');
      expect(store.nextRow()?.meeting.id).toBe('first');
      expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['first', 'overlap', 'after']);
      expect(store.nextRowJoinable()).toBe(false);
    });

    it('keeps the picked date across a refetch, and falls back to the first one once it is gone', () => {
      const store = create();
      const start = inDays(1).getTime();
      const at = (minutes: number): string => new Date(start + minutes * 60_000).toISOString();
      const first = buildMeeting({ id: 'first', start_time: at(0) });
      const second = buildMeeting({ id: 'second', start_time: at(0) });
      upcoming$.next([first, second]);
      store.stepNextCard(1);

      upcoming$.next([first, second, buildMeeting({ id: 'third', start_time: at(30) })]);
      expect(store.nextCardRow()?.meeting.id).toBe('second');
      expect(store.concurrentNextRows()).toHaveLength(3);

      upcoming$.next([first]);
      expect(store.concurrentNextRows()).toHaveLength(1);
      expect(store.nextCardRow()?.meeting.id).toBe('first');
    });

    it("starts a new viewer on the first concurrent date, not the previous viewer's pick", () => {
      const store = create();
      const start = inDays(1).toISOString();
      const meetings = [buildMeeting({ id: 'first', start_time: start }), buildMeeting({ id: 'second', start_time: start })];
      upcoming$.next(meetings);
      store.stepNextCard(1);
      expect(store.nextCardRow()?.meeting.id).toBe('second');

      identity.set('viewer-b');
      upcoming$.next(meetings);

      expect(store.nextCardRow()?.meeting.id).toBe('first');
    });

    it('leaves an overlapping date that is already over out of the pager', () => {
      const store = create();
      const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
      upcoming$.next([buildMeeting({ id: 'over', start_time: ago(70) }), buildMeeting({ id: 'live', start_time: ago(30), duration: 90 })]);

      expect(store.nextRow()?.meeting.id).toBe('live');
      expect(store.concurrentNextRows().map((row) => row.meeting.id)).toEqual(['live']);
    });

    it('is null without upcoming dates and keeps the Past list whole', () => {
      const store = create();
      upcoming$.next([]);
      past$.next([buildPastMeeting('p1', inDays(-1))]);
      store.setTab('past');

      expect(store.nextRow()).toBeNull();
      expect(store.filteredRows()).toHaveLength(1);
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
        { key: 'project', prefix: 'Project:', label: 'Project One' },
        { key: 'organizedByMe', label: 'Organized by me' },
      ]);

      store.clearFilter('project');

      expect(store.filters()).toEqual({ ...MEETINGS_HOME_DEFAULT_FILTERS, organizedByMe: true });
      expect(store.filterChips().map((chip) => chip.key)).toEqual(['organizedByMe']);
    });

    it('names the foundation chip and keeps the project when the foundation chip is removed', () => {
      const store = create();
      upcoming$.next([
        buildMeeting({ id: 'f', project_uid: 'f-1', project_name: 'Foundation One', is_foundation: true }),
        buildMeeting({ parent_project_uid: 'f-1' }),
      ]);
      store.setFilters({ ...store.filters(), foundation: 'f-1', project: 'p-1' });

      expect(store.filterChips().map((chip) => chip.label)).toEqual(['Foundation One', 'Project One']);

      store.clearFilter('foundation');

      expect(store.filters()).toEqual({ ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-1' });
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

  describe('deleted and cancelled', () => {
    it('drops every row of a deleted meeting, keeping upcoming ones out after a refetch and past ones until their feed answers', () => {
      const store = create();
      const pastOfIt = { ...buildPastMeeting('a', inDays(-1)), meeting_id: 'm-1' };
      const emit = (): void => {
        upcoming$.next([weeklyMeeting([inDays(1)]), buildMeeting({ id: 'm-2' })]);
        past$.next([pastOfIt]);
        latestPast$.next([pastOfIt]);
      };
      emit();
      store.removeMeeting('m-1');

      expect(store.pastRows()).toEqual([]);
      expect(store.lastMeeting()).toBeNull();
      emit();

      expect(store.upcomingRows().map((row) => row.meeting.id)).toEqual(['m-2']);
      expect(store.pastRows().map((row) => row.key)).toEqual(['m-past-a']);
      expect(store.lastMeeting()?.key).toBe('m-past-a');
    });

    it('drops only the cancelled date of a series and marks it cancelled for the pickers', () => {
      const store = create();
      const [first, second] = [inDays(1), inDays(8)];
      upcoming$.next([weeklyMeeting([first, second])]);

      store.removeOccurrence('m-1', seconds(first));

      expect(store.upcomingRows().map((row) => row.occurrenceId)).toEqual([seconds(second)]);
      expect(store.upcomingRows()[0].meeting.cancelled_occurrences).toEqual([seconds(first)]);
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

    it("takes the attendance counts from the full past feed's record of the same meeting", () => {
      const store = create();
      const latest = buildPastMeeting('b', inDays(-1));
      latestPast$.next([latest]);
      expect(store.lastMeeting()?.meeting).not.toHaveProperty('attendance_summary');

      past$.next([{ ...latest, attendance_summary: { invited: 8, attended: 3 } }]);

      expect((store.lastMeeting()?.meeting as PastMeeting).attendance_summary).toEqual({ invited: 8, attended: 3 });
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

    it("loads the last meeting's summary and recording", () => {
      const store = create();
      latestPast$.next([buildPastMeeting('b', inDays(-1))]);
      TestBed.tick();

      expect(meetingService['getPastMeetingSummary']).toHaveBeenCalledWith('m-past-b');
      expect(store.lastMeetingSummary()).toBeUndefined();
      expect(store.lastMeetingRecordingUrl()).toBe('https://zoom.example/large');

      summary$.next(summary);
      expect(store.lastMeetingSummary()).toEqual(summary);

      store.applySummaryChange(store.lastMeeting()?.key ?? '', { ...summary, approved: false });
      expect(store.lastMeetingSummary()?.approved).toBe(false);
    });

    it('lets an approval confirmed this session outrank the index, for that summary only', () => {
      const store = create();
      latestPast$.next([buildPastMeeting('b', inDays(-1))]);
      TestBed.tick();
      const key = store.lastMeeting()?.key ?? '';
      store.applySummaryChange(key, { ...summary, uid: 'sum-a', requires_approval: true, approved: true });

      summary$.next({ ...summary, uid: 'sum-a', requires_approval: true, approved: false });
      expect(store.lastMeetingSummary()?.approved).toBe(true);
      summary$.next({ ...summary, uid: 'sum-b', requires_approval: true, approved: false });
      expect(store.lastMeetingSummary()?.approved).toBe(false);
    });

    it('records approvals against the row the dialog came from, and leaves the Last card alone for another row', () => {
      const store = create();
      latestPast$.next([buildPastMeeting('b', inDays(-1))]);
      TestBed.tick();
      summary$.next(summary);

      store.applySummaryChange('other-row', { ...summary, uid: 'sum-x', requires_approval: true, approved: false });
      expect(store.approvedSummaries().has('other-row')).toBe(false);
      store.applySummaryChange('other-row', { ...summary, uid: 'sum-x', requires_approval: true, approved: true });
      expect(store.approvedSummaries().get('other-row')).toBe('sum-x');
      expect(store.lastMeetingSummary()).toEqual(summary);
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
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });
});
