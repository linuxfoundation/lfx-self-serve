// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_NO_PAST_FILTERS, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import {
  Meeting,
  MeetingRollupFilterOptions,
  MeetingRsvp,
  MeetingsHomePastFilters,
  MeetingsHomePastPage,
  PastMeeting,
  PastMeetingRecording,
  PastMeetingSummary,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { getLocalDayKey } from '@lfx-one/shared/utils';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeFeed, UserMeetingsHomeFeed } from './meetings-home-feed';
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

function buildPastMeeting(id: string, start: Date, overrides: Partial<Meeting> = {}): PastMeeting {
  return {
    ...buildMeeting({ id, title: `Past ${id}`, start_time: start.toISOString(), ...overrides }),
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
        { provide: MeetingsHomeFeed, useClass: UserMeetingsHomeFeed },
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
      refreshUserMeetings: vi.fn(() => meetingsRefresh$.next()),
      meetingJoinIdentity: signal({ name: 'Real Viewer', email: 'real@example.test' }),
    };
  });

  describe('self-invite reconciliation', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
    afterEach(() => {
      TestBed.resetTestingModule();
      vi.useRealTimers();
    });

    it.each([[], ['reg-new']])('recovers from a stale initial refresh without an unrelated mutation: %j', (...uids) => {
      const store = create();
      const stale = buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] });
      upcoming$.next([stale]);
      store.markSelfInvited('organized', uids);
      upcoming$.next([stale]);
      TestBed.tick();
      const refresh = userService['refreshUserMeetings'] as ReturnType<typeof vi.fn>;
      refresh.mockImplementation(() =>
        upcoming$.next([{ ...stale, invited: true, my_registrant_ids: refresh.mock.calls.length === 1 ? undefined : ['reg-new'] }])
      );

      vi.advanceTimersByTime(1000);
      TestBed.tick();
      expect(store.selfInviteOf('organized')).toEqual(uids);
      vi.advanceTimersByTime(4000);
      TestBed.tick();
      expect(store.selfInviteOf('organized')).toBeUndefined();
      vi.advanceTimersByTime(60000);
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(toast.show).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Invitation syncing' }));
    });

    it('bounds stale confirmation reads and lets an explicit retry start a new bounded window', () => {
      const store = create();
      const stale = buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] });
      upcoming$.next([stale]);
      store.markSelfInvited('organized', []);
      TestBed.tick();
      const refresh = userService['refreshUserMeetings'] as ReturnType<typeof vi.fn>;
      refresh.mockImplementation(() => upcoming$.next([stale]));

      for (const delay of [1000, 4000, 10000]) {
        vi.advanceTimersByTime(delay);
        TestBed.tick();
      }
      expect(refresh).toHaveBeenCalledTimes(3);
      expect(store.selfInviteOf('organized')).toEqual([]);
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invitation syncing', actions: [expect.objectContaining({ label: 'Refresh invitation' })] })
      );
      vi.advanceTimersByTime(60000);
      expect(refresh).toHaveBeenCalledTimes(3);

      store.retrySelfInvites();
      expect(refresh).toHaveBeenCalledTimes(4);
      for (const delay of [1000, 4000, 10000]) {
        vi.advanceTimersByTime(delay);
        TestBed.tick();
      }
      expect(refresh).toHaveBeenCalledTimes(7);
      vi.advanceTimersByTime(60000);
      expect(refresh).toHaveBeenCalledTimes(7);
    });

    it.each(['removal', 'deletion', 'viewer', 'destruction'])('stops delayed work after %s', (change) => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] })]);
      store.markSelfInvited('organized', ['reg-new']);
      TestBed.tick();
      if (change === 'removal') removed.set(new Set(['organized']));
      if (change === 'deletion') store.removeMeeting('organized');
      if (change === 'viewer') identity.set('viewer-b');
      if (change === 'destruction') TestBed.resetTestingModule();
      else TestBed.tick();
      if (change !== 'destruction') expect(store.selfInviteOf('organized')).toBeUndefined();
      vi.advanceTimersByTime(60000);
      expect(userService['refreshUserMeetings']).not.toHaveBeenCalled();
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('does not schedule or retry confirmation reads during SSR', () => {
      const store = create('server');
      store.markSelfInvited('organized', []);
      store.retrySelfInvites();
      vi.advanceTimersByTime(60000);
      expect(userService['refreshUserMeetings']).not.toHaveBeenCalled();
    });
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

    it('reports a past day on the whole feed after a retry made with a search', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = create();
      upcoming$.next([]);
      store.setTab('past');
      past$.error(new Error('down'));
      const retried$ = new Subject<PastMeeting[]>();
      (userService['getUserPastMeetings'] as ReturnType<typeof vi.fn>).mockReturnValue(retried$);
      store.setSearch('board');
      store.retry();
      retried$.next([buildPastMeeting('a', inDays(-1))]);
      TestBed.tick();
      const day = getLocalDayKey(inDays(-1));

      store.showDay(day, 'past');
      TestBed.tick();

      expect(store.revealedDay()).toBe(day);
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

    it('keeps a self-invited meeting invited, with its new registration, while a refetch still misses it', () => {
      const store = create();
      const organized = buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] });
      upcoming$.next([organized]);

      store.markSelfInvited('organized', ['reg-self']);
      upcoming$.next([organized]);

      expect(store.upcomingRows()[0].meeting).toMatchObject({ invited: true, my_registrant_ids: ['reg-self'] });
    });

    it('lets invited decide when the self-invite returned no registration uid', () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] })]);

      store.markSelfInvited('organized', []);

      expect(store.upcomingRows()[0].meeting.invited).toBe(true);
      expect(store.upcomingRows()[0].meeting.my_registrant_ids).toBeUndefined();
    });

    it('lets a later removal win over a self-invite', () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] })]);

      store.markSelfInvited('organized', ['reg-self']);
      removed.set(new Set(['organized']));

      expect(store.upcomingRows()[0].meeting).toMatchObject({ invited: false, my_registrant_ids: [] });
      expect(store.selfInviteOf('organized')).toBeUndefined();
      removed.set(new Set());
      store.markSelfInvited('organized', ['reg-readded']);
      expect(store.selfInviteOf('organized')).toEqual(['reg-readded']);
      expect(store.upcomingRows()[0].meeting).toMatchObject({ invited: true, my_registrant_ids: ['reg-readded'] });
    });

    it('retires a self-invite once the feed lists it, so a later feed decides again', () => {
      const store = create();
      const organized = buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] });
      upcoming$.next([organized]);
      store.markSelfInvited('organized', ['reg-self']);

      upcoming$.next([{ ...organized, invited: true, my_registrant_ids: ['reg-self'] }]);
      expect(store.selfInviteOf('organized')).toBeUndefined();
      upcoming$.next([organized]);

      expect(store.upcomingRows()[0].meeting).toMatchObject({ invited: false, my_registrant_ids: [] });
    });

    it('keeps a self-invite without a uid until the feed lists a registration of the viewer', () => {
      const store = create();
      const organized = buildMeeting({ id: 'organized', organizer: true, invited: true, my_registrant_ids: [] });
      upcoming$.next([organized]);
      store.markSelfInvited('organized', []);

      upcoming$.next([organized]);
      expect(store.selfInviteOf('organized')).toEqual([]);
      upcoming$.next([{ ...organized, my_registrant_ids: ['reg-self'] }]);

      expect(store.selfInviteOf('organized')).toBeUndefined();
    });

    it('does not confirm a no-UID invitation from unknown registration enrichment', () => {
      const store = create();
      const organized = buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] });
      upcoming$.next([organized]);
      store.markSelfInvited('organized', []);
      upcoming$.next([{ ...organized, invited: true, my_registrant_ids: undefined }]);
      expect(store.selfInviteOf('organized')).toEqual([]);
      upcoming$.next([{ ...organized, invited: true, my_registrant_ids: ['reg-confirmed'] }]);
      expect(store.selfInviteOf('organized')).toBeUndefined();
    });

    it('forgets the registrations the viewer removed from a self-invite', () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] })]);
      store.markSelfInvited('organized', ['reg-self', 'reg-other']);

      store.forgetSelfInvite('organized', ['reg-self']);
      expect(store.selfInviteOf('organized')).toEqual(['reg-other']);
      store.forgetSelfInvite('organized', ['reg-other']);

      expect(store.selfInviteOf('organized')).toBeUndefined();
      expect(store.upcomingRows()[0].meeting).toMatchObject({ invited: false, my_registrant_ids: [] });
    });

    it.each([
      ['reg-old', 'reg-new'],
      ['reg-new', 'reg-old'],
    ])('saves only active UIDs from a mixed re-invite roster: %j', (...uids) => {
      const store = create();
      const organized = buildMeeting({ id: 'organized', organizer: true, invited: true, my_registrant_ids: ['reg-old'] });
      upcoming$.next([organized]);
      // The removed registration can already have retired its self-invite override.
      store.forgetSelfInvite('organized', ['reg-old']);
      store.markSelfInvited('organized', uids);

      expect(store.selfInviteOf('organized')).toEqual(['reg-new']);
      expect(store.selfInviteOf('organized')?.at(-1)).toBe('reg-new');
      expect(store.upcomingRows()[0].meeting.my_registrant_ids).toEqual(['reg-new']);

      upcoming$.next([{ ...organized, my_registrant_ids: ['reg-new'] }]);
      expect(store.selfInviteOf('organized')).toBeUndefined();
      upcoming$.next([{ ...organized, my_registrant_ids: ['reg-old', 'reg-new'] }]);
      expect(store.upcomingRows()[0].meeting.my_registrant_ids).toEqual(['reg-new']);
    });

    it.each([{ ids: ['reg-old'] }, { ids: [] }, { ids: undefined }])('keeps a no-UID re-add pending without an active indexed UID: $ids', ({ ids }) => {
      const store = create();
      const organized = buildMeeting({ id: 'organized', organizer: true, invited: true, my_registrant_ids: ['reg-old'] });
      upcoming$.next([organized]);
      store.forgetSelfInvite('organized', ['reg-old']);
      removed.set(new Set(['organized']));
      expect(store.upcomingRows()[0].meeting.invited).toBe(false);

      removed.set(new Set());
      store.markSelfInvited('organized', []);
      upcoming$.next([{ ...organized, my_registrant_ids: ids }]);

      expect(store.selfInviteOf('organized')).toEqual([]);
      expect(store.upcomingRows()[0].meeting.invited).toBe(true);
      expect(store.upcomingRows()[0].meeting.my_registrant_ids).toBeUndefined();

      upcoming$.next([{ ...organized, my_registrant_ids: ['reg-old', 'reg-new'] }]);
      expect(store.selfInviteOf('organized')).toBeUndefined();
      expect(store.upcomingRows()[0].meeting.my_registrant_ids).toEqual(['reg-new']);
    });

    it("resets removed UIDs with the viewer instead of suppressing the next viewer's registration", () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, my_registrant_ids: ['reg-old'] })]);
      store.forgetSelfInvite('organized', ['reg-old']);
      identity.set('viewer-b');
      TestBed.tick();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] })]);
      store.markSelfInvited('organized', ['reg-old']);

      expect(store.selfInviteOf('organized')).toEqual(['reg-old']);
      expect(store.upcomingRows()[0].meeting.my_registrant_ids).toEqual(['reg-old']);
    });

    it('forgets a self-invite on a viewer change', () => {
      const store = create();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] })]);
      store.markSelfInvited('organized', ['reg-self']);

      identity.set('viewer-b');
      TestBed.tick();
      upcoming$.next([buildMeeting({ id: 'organized', organizer: true, invited: false, my_registrant_ids: [] })]);

      expect(store.upcomingRows()[0].meeting).toMatchObject({ invited: false, my_registrant_ids: [] });
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

  describe('paged past feed', () => {
    let pastPages: Subject<MeetingsHomePastPage>[];
    let past: ReturnType<typeof vi.fn<(search: string, filters: MeetingsHomePastFilters, pageToken?: string) => Subject<MeetingsHomePastPage>>>;
    let scope$: Subject<MeetingRollupFilterOptions>;

    const createPaged = (): MeetingsHomeStore => {
      pastPages = [];
      scope$ = new Subject();
      past = vi.fn<(search: string, filters: MeetingsHomePastFilters, pageToken?: string) => Subject<MeetingsHomePastPage>>(() => {
        const page$ = new Subject<MeetingsHomePastPage>();
        pastPages.push(page$);
        return page$;
      });
      const feed: MeetingsHomeFeed = {
        key: identity,
        scope: 'project',
        showsProject: signal(false),
        pagedPast: true,
        upcomingRefresh$: meetingsRefresh$,
        pastRefresh$: pastMeetingsRefresh$,
        upcoming: () => upcoming$,
        past,
        latestPast: () => latestPast$,
        filterOptions: () => scope$,
      };
      TestBed.configureTestingModule({
        providers: [
          MeetingsHomeStore,
          { provide: MeetingsHomeFeed, useValue: feed },
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: UserService, useValue: userService },
          { provide: MeetingService, useValue: meetingService },
          { provide: UiToastService, useValue: toast },
        ],
      });
      const store = TestBed.inject(MeetingsHomeStore);
      TestBed.tick();
      return store;
    };
    const olderPage = (prefix: string, fromDay: number, count: number, pageToken?: string): MeetingsHomePastPage => ({
      meetings: Array.from({ length: count }, (_, index) => buildPastMeeting(`${prefix}${index}`, inDays(-fromDay - index))),
      pageToken,
    });
    const pastPage = (prefix: string, count: number, pageToken?: string): MeetingsHomePastPage => ({
      meetings: Array.from({ length: count }, (_, index) => buildPastMeeting(`${prefix}${index}`, inDays(-1 - index))),
      pageToken,
    });

    it('loads the next server page once the loaded rows are shown, and stops when the cursor ends', () => {
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();

      expect(store.hasMore()).toBe(true);
      store.loadMore();
      TestBed.tick();
      expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');

      pastPages[1].next(pastPage('b', 5));
      TestBed.tick();
      expect(store.pastRows()).toHaveLength(MEETINGS_HOME_PAGE_SIZE + 5);
      expect(store.hasMore()).toBe(false);
    });

    it('reloads from the first page with the search, and drops a next page of the earlier query', async () => {
      vi.useFakeTimers();
      try {
        const store = createPaged();
        store.setTab('past');
        pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
        TestBed.tick();
        store.loadMore();
        TestBed.tick();
        TestBed.tick();

        store.setSearch(' weekly ');
        TestBed.tick();
        await vi.advanceTimersByTimeAsync(300);
        expect(past).toHaveBeenLastCalledWith('weekly', MEETINGS_HOME_NO_PAST_FILTERS);

        pastPages[1].next(pastPage('stale', 3));
        pastPages[2].next(pastPage('w', 2));
        TestBed.tick();
        expect(store.pastRows().map((row) => row.meeting.id)).toEqual(['w0', 'w1']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reloads a paged past feed from its first page on refresh', () => {
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();
      pastPages[1].next(pastPage('b', MEETINGS_HOME_PAGE_SIZE, 'cursor-2'));
      TestBed.tick();

      pastMeetingsRefresh$.next();
      pastPages[2].next(pastPage('c', 1));
      TestBed.tick();

      expect(past).toHaveBeenCalledTimes(3);
      expect(store.pastRows().map((row) => row.meeting.id)).toEqual(['c0']);
      expect(store.hasMore()).toBe(false);
    });

    describe('project filters', () => {
      const tsc = { uid: 'c-1', name: 'TSC' };
      const wg = { uid: 'c-2', name: 'Docs WG' };
      const loadPast = (store: MeetingsHomeStore): void => {
        store.setTab('past');
        pastPages[0].next({
          meetings: [
            buildPastMeeting('a', inDays(-1), { committees: [tsc] }),
            buildPastMeeting('b', inDays(-2), { committees: [wg], project_uid: 'p-2', project_name: 'Project Two', meeting_type: 'Board' }),
          ],
        });
        TestBed.tick();
      };

      it('reloads the past list from its first page with the filters the server can apply, and continues cursors with them', () => {
        const store = createPaged();
        scope$.next({ projects: [], groups: [{ uid: 'c-1', name: 'TSC', category: 'Technical Steering Committee', project_uid: 'p-1' }], complete: true });
        loadPast(store);

        store.setFilters({
          ...MEETINGS_HOME_DEFAULT_FILTERS,
          project: 'p-1',
          group: 'c-1',
          groupType: 'Technical Steering Committee',
          meetingType: 'Technical',
        });
        TestBed.tick();

        // With a group picked, its type stays on the client: the server would need the picked group itself to be of that type.
        const applied = { projectUid: 'p-1', committeeUid: 'c-1', groupType: null, meetingType: 'Technical' };
        expect(past).toHaveBeenLastCalledWith('', applied);
        pastPages[1].next({ meetings: [buildPastMeeting('c', inDays(-3), { committees: [tsc] })], pageToken: 'cursor-2' });
        TestBed.tick();
        expect(store.pastRows().map((row) => row.meeting.id)).toEqual(['c']);
        // Fewer rows than a list page, so the next server page loads on its own.
        expect(past).toHaveBeenLastCalledWith('', applied, 'cursor-2');
      });

      it('does not page the previous filters after a filtered reload fails', () => {
        const store = createPaged();
        store.setTab('past');
        pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
        TestBed.tick();

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, group: 'c-1' });
        TestBed.tick();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        pastPages[1].error(new Error('boom'));
        TestBed.tick();

        // The cursor belongs to the unfiltered query, so it is not paged under the new filters.
        expect(past).toHaveBeenCalledTimes(2);
        expect(store.pastRows()).toHaveLength(MEETINGS_HOME_PAGE_SIZE);
      });

      it('keeps a category on the client when an uncategorised group in scope reads as the same type', () => {
        const store = createPaged();
        scope$.next({
          projects: [],
          groups: [
            { uid: 'c-1', name: 'TSC', category: 'Working Group', project_uid: 'p-1' },
            { uid: 'c-2', name: 'Docs WG', category: null, project_uid: 'p-1' },
          ],
          complete: true,
        });
        loadPast(store);

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, groupType: 'Working Group' });
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(1);
        expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['a', 'b']);
      });

      it('filters a group type read from group names on the loaded rows only', () => {
        const store = createPaged();
        scope$.next({ projects: [], groups: [], complete: true });
        loadPast(store);

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, groupType: 'Working Group' });
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(1);
        expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['b']);
      });

      it('matches group types by category from the groups in scope', () => {
        const store = createPaged();
        scope$.next({ projects: [], groups: [{ uid: 'c-2', name: 'Docs WG', category: 'Special Interest Group', project_uid: 'p-1' }], complete: true });
        loadPast(store);

        expect(store.groupCategories()).toEqual(new Map([['c-2', 'Special Interest Group']]));
        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, groupType: 'Special Interest Group' });
        TestBed.tick();
        pastPages[1].next({ meetings: [buildPastMeeting('b', inDays(-2), { committees: [wg] })] });
        TestBed.tick();

        expect(past).toHaveBeenLastCalledWith('', { ...MEETINGS_HOME_NO_PAST_FILTERS, groupType: 'Special Interest Group' });
        expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['b']);
      });

      it('keeps the filter options and chip names of the last unfiltered past load while filters narrow it', () => {
        const store = createPaged();
        loadPast(store);

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-2', group: 'c-2' });
        TestBed.tick();
        pastPages[1].next({ meetings: [] });
        TestBed.tick();

        expect(store.filterOptionRows().map((row) => row.meeting.id)).toEqual(['a', 'b']);
        expect(store.filterChips()).toEqual([
          { key: 'project', prefix: 'Project:', label: 'Project Two' },
          { key: 'group', prefix: 'Group:', label: 'Docs WG' },
        ]);

        store.clearFilter('project');
        store.clearFilter('group');
        TestBed.tick();
        pastPages[2].next({ meetings: [buildPastMeeting('d', inDays(-4))] });
        TestBed.tick();
        expect(store.filterOptionRows().map((row) => row.meeting.id)).toEqual(['d']);
      });

      it('applies filters on the Upcoming tab without reloading the past list', () => {
        const store = createPaged();
        upcoming$.next([buildMeeting({ id: 'u1', committees: [tsc] }), buildMeeting({ id: 'u2', committees: [wg] })]);
        TestBed.tick();

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, group: 'c-2' });
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(1);
        expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['u2']);
      });

      it('keeps a meeting whose picked group and group type are on different groups, filtering the type on the client', () => {
        const store = createPaged();
        scope$.next({
          projects: [],
          groups: [
            { uid: 'c-1', name: 'TSC', category: 'Board', project_uid: 'p-1' },
            { uid: 'c-2', name: 'Docs WG', category: 'Working Group', project_uid: 'p-1' },
          ],
          complete: true,
        });
        loadPast(store);

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, group: 'c-1', groupType: 'Working Group' });
        TestBed.tick();
        expect(past).toHaveBeenLastCalledWith('', { ...MEETINGS_HOME_NO_PAST_FILTERS, committeeUid: 'c-1' });
        pastPages[1].next({ meetings: [buildPastMeeting('both', inDays(-1), { committees: [tsc, wg] })] });
        TestBed.tick();

        expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['both']);
      });

      it('keeps a category on the client while the scope is incomplete', () => {
        const store = createPaged();
        scope$.next({ projects: [], groups: [{ uid: 'c-2', name: 'Docs WG', category: 'Special Interest Group', project_uid: 'p-1' }], complete: false });
        loadPast(store);

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, groupType: 'Special Interest Group' });
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(1);
      });

      it('keeps a category on the client when an uncategorised group on the loaded rows reads as the same type', () => {
        const store = createPaged();
        scope$.next({ projects: [], groups: [{ uid: 'c-1', name: 'TSC', category: 'Working Group', project_uid: 'p-1' }], complete: true });
        loadPast(store);

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, groupType: 'Working Group' });
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(1);
        expect(store.filteredRows().map((row) => row.meeting.id)).toEqual(['a', 'b']);
      });

      it("drops the previous scope's filter options when the feed changes before its first past page loads", () => {
        const store = createPaged();
        loadPast(store);

        identity.set('viewer-b');
        TestBed.tick();
        store.setTab('past');
        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-2' });
        TestBed.tick();

        expect(store.filterOptionRows().map((row) => row.meeting.id)).toEqual([]);
      });

      it('offers values from the narrowed rows too, beside the last unfiltered load', () => {
        const store = createPaged();
        loadPast(store);

        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, project: 'p-2' });
        TestBed.tick();
        pastPages[1].next({ meetings: [buildPastMeeting('old', inDays(-30), { project_uid: 'p-2', project_name: 'Project Two' })] });
        TestBed.tick();

        expect(store.filterOptionRows().map((row) => row.meeting.id)).toEqual(['a', 'b', 'old']);
      });
    });

    it('keeps loading server pages while none of the loaded rows can be shown', () => {
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', 0, 'cursor-1'));
      TestBed.tick();

      expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');
      expect(store.loading()).toBe(true);
      pastPages[1].next(pastPage('b', 3));
      TestBed.tick();
      expect(store.pastRows()).toHaveLength(3);
      expect(store.loading()).toBe(false);
    });

    it('ignores a Load more while a page is loading', () => {
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();
      const count = store.visibleCount();

      store.loadMore();

      expect(store.visibleCount()).toBe(count);
      expect(past).toHaveBeenCalledTimes(2);
    });

    it('drops the failure of a next page the query has moved on from, and keeps the cursor when a reload fails', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();

      pastMeetingsRefresh$.next();
      pastPages[1].error(new Error('stale'));
      expect(toast.show).not.toHaveBeenCalled();
      pastPages[2].error(new Error('reload failed'));
      TestBed.tick();

      expect(store.pastRows()).toHaveLength(MEETINGS_HOME_PAGE_SIZE);
      expect(store.hasMore()).toBe(true);
    });

    it('drops the cursor when the viewer or scope changes, even if the new first page fails', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-a'));
      TestBed.tick();

      identity.set('viewer-b');
      TestBed.tick();
      pastPages[pastPages.length - 1].error(new Error('first page failed'));
      TestBed.tick();

      expect(past).not.toHaveBeenCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-a');
      expect(store.hasMore()).toBe(false);
    });

    it('shows the error state with Retry when a next page fails and no past rows are loaded', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', 0, 'cursor-1'));
      TestBed.tick();

      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();

      expect(store.failed()).toBe(true);
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('does not page the previous search while a new one is debouncing', () => {
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();

      store.setSearch('nothing loaded matches this');
      TestBed.tick();

      expect(past).toHaveBeenCalledTimes(1);
    });

    it('offers to load more after a next page fails with rows shown, and retries the same cursor', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();
      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();

      expect(store.pastPageFailed()).toBe(true);
      expect(store.hasMore()).toBe(false);
      expect(past).toHaveBeenCalledTimes(2);
      store.retryPastPage();
      TestBed.tick();
      expect(store.pastPageFailed()).toBe(false);
      expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');
    });

    it('keeps showing more upcoming rows while a past page is loading', () => {
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();
      store.setTab('upcoming');
      upcoming$.next(
        Array.from({ length: MEETINGS_HOME_PAGE_SIZE + 5 }, (_, index) => buildMeeting({ id: `u-${index}`, start_time: inDays(index + 1).toISOString() }))
      );
      TestBed.tick();

      store.loadMore();

      expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE * 2);
    });

    it('stays on the error state when Retry after a failed empty past list fails again', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', 0, 'cursor-1'));
      TestBed.tick();
      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();
      expect(store.failed()).toBe(true);

      store.retry();
      TestBed.tick();
      pastPages[pastPages.length - 1].error(new Error('reload failed'));
      TestBed.tick();

      expect(store.failed()).toBe(true);
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('shows the error state when a next page fails and the filters hide every loaded row', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      // A group type read from names, with no scope loaded, filters on the client, so the next page is a cursor page.
      store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, groupType: 'Working Group' });
      TestBed.tick();

      expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');
      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();

      expect(store.failed()).toBe(true);
    });

    it('offers no more rows while the cursor belongs to a search still debouncing', () => {
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();

      store.setSearch('Past a1');
      TestBed.tick();

      expect(store.hasMore()).toBe(false);
    });

    it('does not mark Past failed when its next page fails while Upcoming is shown', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();
      store.setTab('upcoming');
      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();

      store.setTab('past');
      TestBed.tick();

      expect(store.failed()).toBe(false);
      expect(store.pastPageFailed()).toBe(true);
    });

    it('keeps Retry on Upcoming from putting a loaded Past list into its error state', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();
      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();
      store.setTab('upcoming');
      upcoming$.error(new Error('upcoming failed'));
      TestBed.tick();

      store.retry();
      TestBed.tick();
      pastPages[pastPages.length - 1].error(new Error('past reload failed'));
      store.setTab('past');
      TestBed.tick();

      expect(store.failed()).toBe(false);
      expect(store.pastRows()).toHaveLength(MEETINGS_HOME_PAGE_SIZE);
    });

    it('shows no error while a new search debounces after a failed page', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
      TestBed.tick();
      store.loadMore();
      TestBed.tick();
      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();

      store.setSearch('nothing loaded matches this');
      TestBed.tick();

      expect(store.failed()).toBe(false);
    });

    it('treats the past count as unknown on any tab when a next page failed with nothing loaded', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const store = createPaged();
      store.setTab('past');
      pastPages[0].next(pastPage('a', 0, 'cursor-1'));
      TestBed.tick();
      pastPages[1].error(new Error('next page failed'));
      TestBed.tick();

      store.setTab('upcoming');
      TestBed.tick();

      expect(store.pastCountUnknown()).toBe(true);
    });

    it('keeps a meeting on a project list after the viewer removes their registration, without it', () => {
      const store = createPaged();
      upcoming$.next([buildMeeting({ id: 'public-1', organizer: false, my_rsvp: rsvp({ meeting_id: 'public-1' }) })]);
      removed.set(new Set(['public-1']));
      TestBed.tick();

      expect(store.upcomingRows().map((row) => row.meeting.id)).toEqual(['public-1']);
      expect(store.upcomingRows()[0].meeting.invited).toBe(false);
      expect(store.upcomingRows()[0].meeting.my_rsvp).toBeNull();
    });

    describe('showing a calendar day', () => {
      it('switches tab, clears search and filters, and loads older pages until the day is covered', () => {
        const store = createPaged();
        pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
        TestBed.tick();
        store.setSearch('board');
        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, meetingType: 'Board' });
        const day = getLocalDayKey(inDays(-25));

        store.showDay(day, 'past');
        TestBed.tick();

        expect(store.tab()).toBe('past');
        expect(store.search()).toBe('');
        expect(store.filters()).toEqual(MEETINGS_HOME_DEFAULT_FILTERS);
        expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');
        expect(store.revealedDay()).toBeNull();

        pastPages[1].next(olderPage('b', 21, 3, 'cursor-2'));
        TestBed.tick();
        expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-2');

        pastPages[2].next(olderPage('c', 24, 5, 'cursor-3'));
        TestBed.tick();
        expect(past).toHaveBeenCalledTimes(3);
        expect(store.revealedDay()).toBe(day);
        // Every row through the picked day shows, past the one-page limit.
        expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE + 3 + 2);

        store.completeReveal();
        expect(store.revealedDay()).toBeNull();
        expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE + 5);
      });

      it('waits for the first page of a cleared search before covering the day', async () => {
        vi.useFakeTimers();
        try {
          const store = createPaged();
          store.setTab('past');
          store.setSearch('board');
          TestBed.tick();
          await vi.advanceTimersByTimeAsync(300);
          pastPages[1].next(pastPage('s', 1));
          TestBed.tick();
          const day = getLocalDayKey(inDays(-1));

          store.showDay(day, 'past');
          TestBed.tick();
          expect(store.revealedDay()).toBeNull();

          await vi.advanceTimersByTimeAsync(300);
          expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS);
          pastPages[2].next(pastPage('a', 2));
          TestBed.tick();
          expect(store.revealedDay()).toBe(day);
        } finally {
          vi.useRealTimers();
        }
      });

      it('shows every upcoming row through the day at once', () => {
        const store = createPaged();
        const meetings = Array.from({ length: MEETINGS_HOME_PAGE_SIZE + 5 }, (_, index) =>
          buildMeeting({ id: `u-${index}`, start_time: inDays(40 + index).toISOString() })
        );
        upcoming$.next(meetings);
        const day = getLocalDayKey(inDays(40 + MEETINGS_HOME_PAGE_SIZE + 2));

        store.showDay(day, 'upcoming');
        TestBed.tick();

        expect(store.revealedDay()).toBe(day);
        expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE + 3);
        expect(past).toHaveBeenCalledTimes(1);
      });

      it('opens the list through a day with no meetings, up to its date', () => {
        const store = createPaged();
        const meetings = Array.from({ length: MEETINGS_HOME_PAGE_SIZE + 5 }, (_, index) =>
          buildMeeting({ id: `u-${index}`, start_time: inDays(40 + index * 2).toISOString() })
        );
        upcoming$.next(meetings);
        const day = getLocalDayKey(inDays(40 + MEETINGS_HOME_PAGE_SIZE * 2 + 1));

        store.showDay(day, 'upcoming');
        TestBed.tick();

        expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE + 1);
      });

      it('keeps an Upcoming day when a past load fails', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const store = createPaged();
        upcoming$.next([buildMeeting({ id: 'u-1', start_time: inDays(3).toISOString() })]);
        const day = getLocalDayKey(inDays(3));

        store.showDay(day, 'upcoming');
        pastPages[0].error(new Error('past down'));
        TestBed.tick();

        expect(store.revealedDay()).toBe(day);
      });

      it('keeps a day picked while a searched past load is in flight when that load fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.useFakeTimers();
        try {
          const store = createPaged();
          store.setTab('past');
          pastPages[0].next(pastPage('a', 1));
          store.setSearch('board');
          TestBed.tick();
          await vi.advanceTimersByTimeAsync(300);
          const day = getLocalDayKey(inDays(-1));

          store.showDay(day, 'past');
          TestBed.tick();
          pastPages[1].error(new Error('searched load failed'));
          TestBed.tick();
          await vi.advanceTimersByTimeAsync(300);
          pastPages[pastPages.length - 1].next(pastPage('a', 2));
          TestBed.tick();

          expect(store.revealedDay()).toBe(day);
        } finally {
          vi.useRealTimers();
        }
      });

      it('keeps a day picked while a filtered past load is in flight when that load fails', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const store = createPaged();
        store.setTab('past');
        pastPages[0].next(pastPage('a', 1));
        store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, group: 'c-1' });
        TestBed.tick();
        expect(past).toHaveBeenLastCalledWith('', { ...MEETINGS_HOME_NO_PAST_FILTERS, committeeUid: 'c-1' });
        const day = getLocalDayKey(inDays(-1));

        // The day clears the filters; the filtered load fails before the unfiltered reload starts.
        store.showDay(day, 'past');
        pastPages[1].error(new Error('filtered load failed'));
        TestBed.tick();
        pastPages[pastPages.length - 1].next(pastPage('a', 2));
        TestBed.tick();

        expect(store.revealedDay()).toBe(day);
      });

      it('does not hold a covered day back while a next page loads', () => {
        const store = createPaged();
        pastPages[0].next(pastPage('a', 3, 'cursor-1'));
        TestBed.tick();
        const day = getLocalDayKey(inDays(-1));

        store.showDay(day, 'past');
        TestBed.tick();

        // Three rows are under a page, so the next page is loading.
        expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');
        expect(store.revealedDay()).toBe(day);
      });

      it('settles on the rows it has, without retrying, when an older page fails', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const store = createPaged();
        pastPages[0].next(pastPage('a', 2, 'cursor-1'));
        TestBed.tick();

        const day = getLocalDayKey(inDays(-30));
        store.showDay(day, 'past');
        TestBed.tick();
        pastPages[1].error(new Error('down'));
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(2);
        expect(store.revealedDay()).toBe(day);
        expect(store.pastPageFailed()).toBe(true);
      });

      it('drops a pending day when the tab, search or filters change', () => {
        for (const change of [
          (store: MeetingsHomeStore) => store.setTab('upcoming'),
          (store: MeetingsHomeStore) => store.setSearch('board'),
          (store: MeetingsHomeStore) => store.setFilters({ ...MEETINGS_HOME_DEFAULT_FILTERS, meetingType: 'Board' }),
        ]) {
          TestBed.resetTestingModule();
          const store = createPaged();
          pastPages[0].next(pastPage('a', MEETINGS_HOME_PAGE_SIZE, 'cursor-1'));
          TestBed.tick();
          store.showDay(getLocalDayKey(inDays(-25)), 'past');
          TestBed.tick();

          change(store);
          pastPages[pastPages.length - 1].next(olderPage('b', 21, 30));
          TestBed.tick();

          // The day would be covered now; it no longer shows or extends the list.
          expect(store.revealedDay()).toBeNull();
          expect(store.visibleCount()).toBe(MEETINGS_HOME_PAGE_SIZE);
        }
      });

      it('drops a pending day when the past first page fails', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
          const store = createPaged();
          store.setTab('past');
          store.setSearch('board');
          TestBed.tick();
          await vi.advanceTimersByTimeAsync(300);
          pastPages[1].next(pastPage('s', 1));
          TestBed.tick();

          store.showDay(getLocalDayKey(inDays(-1)), 'past');
          TestBed.tick();
          await vi.advanceTimersByTimeAsync(300);
          pastPages[2].error(new Error('down'));
          TestBed.tick();
          pastMeetingsRefresh$.next();
          pastPages[pastPages.length - 1].next(pastPage('a', 2));
          TestBed.tick();

          expect(store.revealedDay()).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe('calendar months', () => {
      it('loads past pages back to an older month the calendar shows, on any tab', () => {
        const store = createPaged();
        pastPages[0].next(pastPage('a', 5, 'cursor-1'));
        TestBed.tick();
        expect(past).toHaveBeenCalledTimes(1);

        store.showPastFrom(getLocalDayKey(inDays(-12)));
        TestBed.tick();
        expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');

        pastPages[1].next(olderPage('b', 6, 5, 'cursor-2'));
        TestBed.tick();
        expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-2');
        pastPages[2].next(olderPage('c', 11, 5, 'cursor-3'));
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(3);
        expect(store.tab()).toBe('upcoming');
        expect(store.pastRows()).toHaveLength(15);
      });

      it('stops, without retrying, when an older page fails', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const store = createPaged();
        pastPages[0].next(pastPage('a', 5, 'cursor-1'));
        TestBed.tick();

        store.showPastFrom(getLocalDayKey(inDays(-60)));
        TestBed.tick();
        pastPages[1].error(new Error('down'));
        TestBed.tick();

        expect(past).toHaveBeenCalledTimes(2);

        // Going back another month retries the page from the kept cursor.
        store.showPastFrom(getLocalDayKey(inDays(-90)));
        TestBed.tick();
        expect(past).toHaveBeenCalledTimes(3);
        expect(past).toHaveBeenLastCalledWith('', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor-1');
      });
    });

    it('does not request a next page on the upcoming tab', () => {
      const store = createPaged();
      pastPages[0].next(pastPage('a', 1, 'cursor-1'));
      TestBed.tick();

      store.loadMore();
      TestBed.tick();

      expect(past).toHaveBeenCalledTimes(1);
    });
  });
});
