// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { MEETING_JOIN_STATE_KEY } from '@lfx-one/shared/constants';
import { Meeting, MeetingJoinPageState, MeetingRsvp, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsSeedService } from '../meeting-details-gate/meeting-details-seed.service';
import { MeetingDetailsStateService } from './meeting-details-state.service';

const MEETING_ID = 'meeting-1';
const project = { uid: 'project-1', name: 'Test Project', slug: 'test-project' } as unknown as PublicMeetingProject;
const buildMeeting = (id = MEETING_ID, title = 'Weekly Sync') => ({ id, uid: id, title }) as unknown as Meeting;
const stateKey = makeStateKey<MeetingJoinPageState>(MEETING_JOIN_STATE_KEY);

// `debounceTime(0)` puts the lookup one macrotask after the route emission.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('MeetingDetailsStateService', () => {
  let paramMap$: BehaviorSubject<ParamMap>;
  let queryParamMap$: BehaviorSubject<ParamMap>;
  let getPublicMeeting: ReturnType<typeof vi.fn>;
  let getPublicPastMeeting: ReturnType<typeof vi.fn>;
  let getMyRsvp: ReturnType<typeof vi.fn>;
  let getPublicMeetingOccurrences: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let seed: MeetingJoinPageState | null;
  let authenticated: WritableSignal<boolean>;

  function create(platform: 'browser' | 'server' = 'browser'): MeetingDetailsStateService {
    TestBed.configureTestingModule({
      providers: [
        MeetingDetailsStateService,
        { provide: PLATFORM_ID, useValue: platform },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
            snapshot: {
              get paramMap() {
                return paramMap$.value;
              },
              get queryParamMap() {
                return queryParamMap$.value;
              },
            },
          },
        },
        { provide: Router, useValue: { navigate } },
        { provide: MeetingService, useValue: { getPublicMeeting, getPublicPastMeeting, getMeetingRsvpForCurrentUser: getMyRsvp, getPublicMeetingOccurrences } },
        { provide: UserService, useValue: { authenticated } },
        { provide: MeetingDetailsSeedService, useValue: { take: (routeId: string | null) => (routeId === MEETING_ID ? seed : null) } },
      ],
    });
    return TestBed.inject(MeetingDetailsStateService);
  }

  beforeEach(() => {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: MEETING_ID }));
    queryParamMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    getPublicMeeting = vi.fn().mockReturnValue(of({ meeting: buildMeeting(), project }));
    getPublicPastMeeting = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    getMyRsvp = vi.fn().mockReturnValue(of(null));
    getPublicMeetingOccurrences = vi.fn().mockReturnValue(of({ past: [], future: [] }));
    navigate = vi.fn().mockResolvedValue(true);
    seed = null;
    authenticated = signal(true);
    // Lookup failures are logged on purpose; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('first paint', () => {
    it('shows the skeleton, then the page, when there is no seed', async () => {
      const state = create();
      expect(state.status()).toBe('loading');

      await settle();

      expect(state.status()).toBe('ready');
      expect(state.meeting()?.title).toBe('Weekly Sync');
      expect(state.meeting()?.project).toBe(project);
    });

    it('starts on the page, without a skeleton, from a seeded meeting', () => {
      seed = { meeting: { ...buildMeeting(), project }, loadedViaPastMeetingId: true, pastMeetingFullAccess: true, meetingLoadFailed: false };
      const state = create();

      expect(state.status()).toBe('ready');
      expect(state.loadedViaPastMeetingId()).toBe(true);
      expect(state.pastMeetingFullAccess()).toBe(true);
    });

    it('starts on the error branch from a seeded terminal error, and keeps it while the refetch fails', async () => {
      seed = { meeting: null, loadedViaPastMeetingId: false, pastMeetingFullAccess: false, meetingLoadFailed: true };
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 503 })));
      const state = create();

      expect(state.status()).toBe('error');
      await settle();
      expect(state.status()).toBe('error');
    });
  });

  describe('lookup', () => {
    it('falls back to the past endpoint when the upcoming one 404s', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 404 })));
      getPublicPastMeeting.mockReturnValue(of({ meeting: buildMeeting(), project, full_access: true }));
      const state = create();

      await settle();

      expect(getPublicPastMeeting).toHaveBeenCalledWith(MEETING_ID);
      expect(state.status()).toBe('ready');
      expect(state.loadedViaPastMeetingId()).toBe(true);
      expect(state.pastMeetingFullAccess()).toBe(true);
    });

    it('goes straight to the past endpoint for a composite past-meeting id', async () => {
      const pastId = '99152950841-1700000000000'; // numeric meeting id + start ms
      paramMap$.next(convertToParamMap({ id: pastId }));
      getPublicPastMeeting.mockReturnValue(of({ meeting: buildMeeting(pastId), project, full_access: false }));
      create();

      await settle();

      expect(getPublicMeeting).not.toHaveBeenCalled();
      expect(getPublicPastMeeting).toHaveBeenCalledWith(pastId);
    });

    it.each([400, 403])('sends a %s from the upcoming endpoint to not-found', async (status) => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status })));
      const state = create();

      await settle();

      expect(navigate).toHaveBeenCalledWith(['/meetings/not-found']);
      expect(state.status()).toBe('loading');
    });

    it('sends a 404 from both endpoints to not-found', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 404 })));
      create();

      await settle();

      expect(navigate).toHaveBeenCalledWith(['/meetings/not-found']);
    });

    it('leaves logging an upcoming-endpoint failure to MeetingService', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      create();

      await settle();

      expect(console.error).not.toHaveBeenCalled();
    });

    it('shows the error branch on a 5xx, and recovers on retry', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      const state = create();
      await settle();
      expect(state.status()).toBe('error');
      expect(navigate).not.toHaveBeenCalled();

      getPublicMeeting.mockReturnValue(of({ meeting: buildMeeting(), project }));
      state.refresh();
      await settle();

      expect(state.status()).toBe('ready');
    });

    it('re-reads the meeting on reload, unlike refresh without any retry state', async () => {
      const state = create();
      await settle();
      getPublicMeeting.mockClear();
      getPublicMeeting.mockReturnValue(of({ meeting: { ...buildMeeting(), host_key: '123456', can_view_host_key: true }, project }));

      state.reload();
      expect(state.retrying()).toBe(false);
      await settle();

      expect(getPublicMeeting).toHaveBeenCalledTimes(1);
      expect(state.meeting()?.host_key).toBe('123456');
      expect(state.status()).toBe('ready');
    });

    it('keeps a working page when a background refresh fails', async () => {
      const state = create();
      await settle();

      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      state.refresh();
      await settle();

      expect(state.status()).toBe('ready');
    });

    it.each([400, 403, 404])('sends a %s from the past endpoint to not-found for a composite id', async (status) => {
      paramMap$.next(convertToParamMap({ id: '99152950841-1700000000000' }));
      getPublicPastMeeting.mockReturnValue(throwError(() => ({ status })));
      create();

      await settle();

      expect(navigate).toHaveBeenCalledWith(['/meetings/not-found']);
    });

    it('shows the error branch, and logs, on a 5xx from the past endpoint', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 404 })));
      getPublicPastMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      const state = create();

      await settle();

      expect(state.status()).toBe('error');
      expect(navigate).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith('Failed to load past meeting details', MEETING_ID, { status: 500 });
    });

    it('sends a route with no id to not-found', async () => {
      paramMap$.next(convertToParamMap({}));
      create();

      await settle();

      expect(navigate).toHaveBeenCalledWith(['/meetings/not-found']);
      expect(getPublicMeeting).not.toHaveBeenCalled();
    });

    it('passes the ?password= param to the lookup', async () => {
      queryParamMap$.next(convertToParamMap({ password: 'secret' }));
      create();

      await settle();

      expect(getPublicMeeting).toHaveBeenCalledWith(MEETING_ID, 'secret');
    });
  });

  describe('retry', () => {
    it('reports progress while a retry is in flight', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      const state = create();
      await settle();

      const pending$ = new Subject<{ meeting: Meeting; project: PublicMeetingProject }>();
      getPublicMeeting.mockReturnValue(pending$);
      state.refresh();
      expect(state.retrying()).toBe(true);

      await settle();
      pending$.next({ meeting: buildMeeting(), project });

      expect(state.retrying()).toBe(false);
      expect(state.status()).toBe('ready');
    });

    it('counts a retry that fails again, so the error state can say so', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      const state = create();
      await settle();
      expect(state.failureCount()).toBe(1);

      state.refresh();
      await settle();

      expect(state.status()).toBe('error');
      expect(state.retrying()).toBe(false);
      expect(state.failureCount()).toBe(2);
    });
  });

  describe('password', () => {
    let historyState: unknown;

    beforeEach(() => {
      historyState = null;
      vi.spyOn(history, 'state', 'get').mockImplementation(() => historyState);
    });

    it("uses the composer's navigation-state password when the URL has none, but never as urlPassword", async () => {
      historyState = { password: 'from-composer' };
      const state = create();

      await settle();

      expect(getPublicMeeting).toHaveBeenCalledWith(MEETING_ID, 'from-composer');
      expect(state.password()).toBe('from-composer');
      expect(state.urlPassword()).toBeNull();
    });

    it('prefers the ?password= param over the navigation state', async () => {
      historyState = { password: 'from-composer' };
      queryParamMap$.next(convertToParamMap({ password: 'from-url' }));
      const state = create();

      await settle();

      expect(getPublicMeeting).toHaveBeenCalledWith(MEETING_ID, 'from-url');
      expect(state.urlPassword()).toBe('from-url');
    });

    it.each([{ password: '' }, { password: 42 }, { other: 'x' }])('ignores a navigation state of %o', async (stated) => {
      historyState = stated;
      create();

      await settle();

      expect(getPublicMeeting).toHaveBeenCalledWith(MEETING_ID, null);
    });
  });

  describe('navigating to another meeting', () => {
    it('shows the skeleton, never the previous meeting, until the new one resolves', async () => {
      const state = create();
      await settle();
      expect(state.status()).toBe('ready');

      const pending$ = new Subject<{ meeting: Meeting; project: PublicMeetingProject }>();
      getPublicMeeting.mockReturnValue(pending$);
      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));

      expect(state.matchesRoute()).toBe(false);
      expect(state.status()).toBe('loading');

      await settle();
      pending$.next({ meeting: buildMeeting('meeting-2', 'Other Sync'), project });

      expect(state.status()).toBe('ready');
      expect(state.meeting()?.title).toBe('Other Sync');
    });

    it('clears an error from the previous meeting once the next one loads', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      const state = create();
      await settle();
      expect(state.status()).toBe('error');

      getPublicMeeting.mockReturnValue(of({ meeting: buildMeeting('meeting-2', 'Other Sync'), project }));
      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));
      expect(state.status()).toBe('loading');
      await settle();

      expect(state.status()).toBe('ready');
      expect(state.failureCount()).toBe(0);
    });

    // The previous meeting's request must be cancelled the moment the route changes, not one tick
    // later: settling in that tick would otherwise be taken as the new route's answer.
    it("ignores the previous meeting's request when it settles just after the route changes", async () => {
      const old$ = new Subject<{ meeting: Meeting; project: PublicMeetingProject }>();
      getPublicMeeting.mockReturnValue(old$);
      const state = create();
      await settle();

      const next$ = new Subject<{ meeting: Meeting; project: PublicMeetingProject }>();
      getPublicMeeting.mockReturnValue(next$);
      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));
      old$.next({ meeting: buildMeeting(), project });
      old$.error({ status: 404 });

      expect(state.status()).toBe('loading');
      expect(navigate).not.toHaveBeenCalled();

      await settle();
      next$.next({ meeting: buildMeeting('meeting-2', 'Other Sync'), project });

      expect(state.status()).toBe('ready');
      expect(state.meeting()?.title).toBe('Other Sync');
    });

    it('shows the error branch, not the previous meeting, when the new lookup fails', async () => {
      const state = create();
      await settle();

      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 502 })));
      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));
      await settle();

      expect(state.status()).toBe('error');
    });
  });

  describe('selected occurrence', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const first = new Date(Date.now() + 2 * DAY);
    const second = new Date(Date.now() + 9 * DAY);
    const series = (cancelled: string[] = []) =>
      ({
        ...buildMeeting(),
        start_time: first.toISOString(),
        duration: 60,
        recurrence: { type: 2 },
        occurrences: [
          { occurrence_id: '1', start_time: first.toISOString(), duration: 60 },
          { occurrence_id: '2', start_time: second.toISOString(), duration: 60 },
        ],
        cancelled_occurrences: cancelled,
      }) as unknown as Meeting;

    it('takes the ?occurrence= start time from the URL', async () => {
      queryParamMap$.next(convertToParamMap({ occurrence: String(second.getTime()) }));
      getPublicMeeting.mockReturnValue(of({ meeting: series(), project }));
      const state = create();
      await settle();

      expect(state.selectedOccurrence()?.occurrence_id).toBe('2');
      expect(state.timeState()).toBe('before');
    });

    it('falls back to the current or next occurrence without one, or for a cancelled one', async () => {
      queryParamMap$.next(convertToParamMap({ occurrence: String(second.getTime()) }));
      getPublicMeeting.mockReturnValue(of({ meeting: series(['2']), project }));
      const state = create();
      await settle();

      expect(state.selectedOccurrence()?.occurrence_id).toBe('1');
    });

    it('is null for a past occurrence opened by its composite id, which is the occurrence itself', async () => {
      const pastId = '99152950841-1700000000000';
      paramMap$.next(convertToParamMap({ id: pastId }));
      getPublicPastMeeting.mockReturnValue(of({ meeting: series(), project, full_access: true }));
      const state = create();
      await settle();

      expect(state.selectedOccurrence()).toBeNull();
    });

    // The early-join window opens before the start: live, but not started yet.
    it('reads the join window before the start as starting soon, and after it as live', async () => {
      const soon = new Date(Date.now() + 5 * 60 * 1000);
      getPublicMeeting.mockReturnValue(of({ meeting: { ...buildMeeting(), start_time: soon.toISOString(), duration: 60, occurrences: [] }, project }));
      const state = create();
      await settle();

      expect(state.timeState()).toBe('live');
      expect(state.meetingStatus()).toBe('starting-soon');
    });

    it('reads the join window after the scheduled start as live', async () => {
      const started = new Date(Date.now() - 5 * 60 * 1000);
      getPublicMeeting.mockReturnValue(of({ meeting: { ...buildMeeting(), start_time: started.toISOString(), duration: 60, occurrences: [] }, project }));
      const state = create();
      await settle();

      expect(state.timeState()).toBe('live');
      expect(state.meetingStatus()).toBe('live');
    });

    // `getCurrentOrNextOccurrence` reads the wall clock, so the test moves it along with the state clock.
    it('moves to the next occurrence on the clock once one ends, on a series left open', async () => {
      const soon = Date.now() + 60 * 60 * 1000;
      const later = soon + 7 * DAY;
      getPublicMeeting.mockReturnValue(
        of({
          meeting: {
            ...buildMeeting(),
            start_time: new Date(soon).toISOString(),
            duration: 60,
            recurrence: { type: 2 },
            occurrences: [
              { occurrence_id: '1', start_time: new Date(soon).toISOString(), duration: 60 },
              { occurrence_id: '2', start_time: new Date(later).toISOString(), duration: 60 },
            ],
            cancelled_occurrences: [],
          },
          project,
        })
      );
      // Faked before the service exists, so its 30 s clock runs on the fake interval. RxJS schedules
      // even its zero-delay lookup timer on setInterval, so the lookup is flushed by advancing too.
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      try {
        const state = create();
        vi.advanceTimersByTime(1);
        expect(state.selectedOccurrence()?.occurrence_id).toBe('1');

        vi.setSystemTime(soon + 2 * 60 * 60 * 1000);
        vi.advanceTimersByTime(30_000);

        expect(state.selectedOccurrence()?.occurrence_id).toBe('2');
        expect(state.timeState()).toBe('before');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the last occurrence once a series is exhausted, not the series start', async () => {
      const ended = series().occurrences.map((occurrence, i) => ({ ...occurrence, start_time: new Date(Date.now() - (9 - i * 7) * DAY).toISOString() }));
      getPublicMeeting.mockReturnValue(of({ meeting: { ...series(), start_time: ended[0].start_time, occurrences: ended }, project }));
      const state = create();
      await settle();

      expect(state.selectedOccurrence()?.occurrence_id).toBe('2');
      expect(state.timeState()).toBe('ended');
    });

    it('has no time state before the meeting loads', () => {
      getPublicMeeting.mockReturnValue(new Subject());
      const state = create();

      expect(state.timeState()).toBeNull();
    });
  });

  describe("V1's occurrence actions and Add to calendar", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const first = new Date(Date.now() + 2 * DAY);
    const second = new Date(Date.now() + 9 * DAY);
    const third = new Date(Date.now() + 16 * DAY);
    const series = (overrides: Partial<Meeting> = {}) =>
      ({
        ...buildMeeting(),
        start_time: first.toISOString(),
        duration: 60,
        recurrence: { type: 2 },
        organizer: true,
        occurrences: [
          { occurrence_id: '1', start_time: first.toISOString(), duration: 60 },
          { occurrence_id: '2', start_time: second.toISOString(), duration: 60 },
          { occurrence_id: '3', start_time: third.toISOString(), duration: 60 },
        ],
        cancelled_occurrences: [],
        ...overrides,
      }) as unknown as Meeting;

    async function load(meeting: Meeting): Promise<MeetingDetailsStateService> {
      getPublicMeeting.mockReturnValue(of({ meeting, project }));
      const state = create();
      await settle();
      return state;
    }

    it('lets a signed-in organizer of a recurring meeting manage the selected occurrence', async () => {
      expect((await load(series())).canManageOccurrence()).toBe(true);
    });

    it.each([
      ['a non-organizer', { organizer: false }],
      ['a one-off meeting', { recurrence: null }],
    ])('offers no occurrence actions for %s', async (_case, overrides) => {
      expect((await load(series(overrides as Partial<Meeting>))).canManageOccurrence()).toBe(false);
    });

    it('offers no occurrence actions to a signed-out viewer', async () => {
      authenticated.set(false);
      expect((await load(series())).canManageOccurrence()).toBe(false);
    });

    it('offers no occurrence actions on a past occurrence opened by its composite id', async () => {
      const pastId = '99152950841-1700000000000';
      paramMap$.next(convertToParamMap({ id: pastId }));
      getPublicPastMeeting.mockReturnValue(of({ meeting: series(), project, full_access: true }));
      const state = create();
      await settle();

      expect(state.canManageOccurrence()).toBe(false);
    });

    it('names the next active occurrence as the successor, skipping cancelled ones', async () => {
      queryParamMap$.next(convertToParamMap({ occurrence: String(first.getTime()) }));
      const state = await load(series({ cancelled_occurrences: ['2'] } as Partial<Meeting>));

      expect(state.nextLiveOccurrenceStartMs()).toBe(third.getTime());
    });

    // V1 reads the successor off the merged series timeline, not the payload's occurrences alone.
    it('finds a successor that only the series timeline has', async () => {
      const fourth = new Date(Date.now() + 23 * DAY);
      getPublicMeetingOccurrences.mockReturnValue(of({ past: [], future: [{ occurrence_id: '4', start_time: fourth.toISOString(), duration: 60 }] }));
      queryParamMap$.next(convertToParamMap({ occurrence: String(third.getTime()) }));
      const state = await load(series());

      expect(state.nextLiveOccurrenceStartMs()).toBe(fourth.getTime());
    });

    it('reads the series timeline for a recurring meeting, with the page password, and again on a refresh', async () => {
      queryParamMap$.next(convertToParamMap({ password: 'secret' }));
      const state = await load(series());
      expect(getPublicMeetingOccurrences).toHaveBeenCalledTimes(1);
      expect(getPublicMeetingOccurrences).toHaveBeenCalledWith(MEETING_ID, 'secret');
      expect(state.seriesOccurrences()).toEqual({ past: [], future: [] });

      state.showOccurrenceAfterChange(second.getTime());
      await settle();

      expect(getPublicMeetingOccurrences).toHaveBeenCalledTimes(2);
    });

    it('drops the previous series timeline when the route moves to another meeting', async () => {
      getPublicMeetingOccurrences.mockReturnValue(of({ past: [], future: [{ occurrence_id: '9', start_time: third.toISOString(), duration: 60 }] }));
      const state = await load(series());
      expect(state.seriesOccurrences().future.length).toBe(1);

      getPublicMeeting.mockReturnValue(of({ meeting: series({ id: 'meeting-2', uid: 'meeting-2', recurrence: null } as Partial<Meeting>), project }));
      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));
      await settle();

      expect(state.seriesOccurrences()).toEqual({ past: [], future: [] });
    });

    it("never reads a one-off meeting's series", async () => {
      await load(series({ recurrence: null }));

      expect(getPublicMeetingOccurrences).not.toHaveBeenCalled();
    });

    it("titles the page with the selected occurrence's own title, else the meeting's", async () => {
      const titled = series();
      (titled.occurrences ?? [])[1].title = 'Release review';
      queryParamMap$.next(convertToParamMap({ occurrence: String(second.getTime()) }));
      const state = await load(titled);

      expect(state.meetingTitle()).toBe('Release review');

      queryParamMap$.next(convertToParamMap({ occurrence: String(first.getTime()) }));
      await settle();
      expect(state.meetingTitle()).toBe('Weekly Sync');
    });

    it('has no successor after the last occurrence', async () => {
      queryParamMap$.next(convertToParamMap({ occurrence: String(third.getTime()) }));
      const state = await load(series());

      expect(state.nextLiveOccurrenceStartMs()).toBeNull();
    });

    it('after a change, points ?occurrence= at the new start and reads the meeting and the timeline again', async () => {
      const state = await load(series());
      const timelineReads = vi.fn();
      state.occurrencesRefresh.subscribe(timelineReads);
      const lookups = getPublicMeeting.mock.calls.length;

      state.showOccurrenceAfterChange(second.getTime());
      await settle();

      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { occurrence: String(second.getTime()) }, queryParamsHandling: 'merge', replaceUrl: true })
      );
      expect(timelineReads).toHaveBeenCalledTimes(2); // the current value on subscribe, then the refresh
      expect(getPublicMeeting.mock.calls.length).toBeGreaterThan(lookups);
    });

    it('keeps the edited occurrence on screen until the meeting is read again with its new start', async () => {
      queryParamMap$.next(convertToParamMap({ occurrence: String(second.getTime()) }));
      const state = await load(series());
      expect(state.selectedOccurrence()?.occurrence_id).toBe('2');

      const moved = new Date(second.getTime() + 60 * 60 * 1000);
      const refetched = new Subject<{ meeting: Meeting; project: PublicMeetingProject }>();
      getPublicMeeting.mockReturnValue(refetched.asObservable());
      navigate.mockImplementation((_commands: unknown[], extras: { queryParams: Record<string, string | null> }) => {
        queryParamMap$.next(convertToParamMap({ occurrence: extras.queryParams['occurrence'] }));
        return Promise.resolve(true);
      });

      state.showOccurrenceAfterChange(moved.getTime());
      await settle();

      // The held payload has only the old start: still the edited occurrence, not the series' first date.
      expect(state.selectedOccurrence()?.occurrence_id).toBe('2');

      const updated = series();
      (updated.occurrences ?? [])[1].start_time = moved.toISOString();
      refetched.next({ meeting: updated, project });

      expect(state.selectedOccurrence()?.start_time).toBe(moved.toISOString());
    });

    it('drops ?occurrence= after a cancel with no successor', async () => {
      const state = await load(series());

      state.showOccurrenceAfterChange(null);

      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { occurrence: null } }));
    });

    it.each([
      ['an organizer', { organizer: true }, true],
      ['an invitee', { organizer: false, invited: true }, true],
      ['a signed-in outsider', { organizer: false, invited: false }, false],
    ])('offers Add to calendar before the window to %s: %s', async (_case, overrides, expected) => {
      expect((await load(series(overrides as Partial<Meeting>))).showAddToCalendar()).toBe(expected);
    });

    it('offers no Add to calendar inside the join window, where the rail is Join only', async () => {
      const state = await load({
        ...buildMeeting(),
        start_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        duration: 60,
        occurrences: [],
        invited: true,
      } as unknown as Meeting);

      expect(state.timeState()).toBe('live');
      expect(state.showAddToCalendar()).toBe(false);
    });
  });

  // The resolver's own table is in `meeting-view-model.utils.spec.ts`; these check the inputs the
  // service feeds it.
  describe('action slot', () => {
    const live = (overrides: Partial<Meeting> = {}) =>
      ({
        ...buildMeeting(),
        start_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        duration: 60,
        occurrences: [],
        visibility: 'public',
        restricted: false,
        ...overrides,
      }) as unknown as Meeting;

    it('offers Join to a registrant inside the window', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: live({ invited: true }), project }));
      const state = create();
      await settle();

      expect(state.viewerRole()).toBe('registrant');
      expect(state.actionSlot()).toBe('join');
    });

    it('offers the guest form to an anonymous visitor inside the window', async () => {
      authenticated.set(false);
      getPublicMeeting.mockReturnValue(of({ meeting: live({ invited: true, organizer: true }), project }));
      const state = create();
      await settle();

      expect(state.viewerRole()).toBe('visitor');
      expect(state.actionSlot()).toBe('guest-join');
    });

    it('tells a signed-in outsider on a restricted meeting that an invitation is required', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: live({ restricted: true }), project }));
      const state = create();
      await settle();

      expect(state.actionSlot()).toBe('invitation-required');
      expect(state.joinsInWindow()).toBe(false);
    });

    it('reads an ended past-id load through its full_access', async () => {
      const pastId = '99152950841-1700000000000';
      paramMap$.next(convertToParamMap({ id: pastId }));
      getPublicPastMeeting.mockReturnValue(of({ meeting: live({ start_time: '2023-11-14T22:13:20Z' }), project, full_access: false }));
      const state = create();
      await settle();

      expect(state.actionSlot()).toBe('no-access');
    });

    // Before the window the slot is RSVP, but the viewer will be able to join once it opens.
    it('knows, before the window, that the viewer will be able to join in it', async () => {
      const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      getPublicMeeting.mockReturnValue(of({ meeting: live({ start_time: later, invited: true, is_invite_responses_enabled: true }), project }));
      const state = create();
      await settle();

      expect(state.actionSlot()).toBe('rsvp');
      expect(state.joinsInWindow()).toBe(true);
    });

    // A past record inside the 40-minute end buffer still reads live on the clock alone.
    it.each([
      ['a composite past id', '99152950841-1700000000000'],
      ['the numeric-id fallback', MEETING_ID],
    ])('treats %s as ended inside the end buffer, so Join is never offered', async (_label, id) => {
      paramMap$.next(convertToParamMap({ id }));
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 404 })));
      getPublicPastMeeting.mockReturnValue(
        of({ meeting: live({ start_time: new Date(Date.now() - 70 * 60 * 1000).toISOString() }), project, full_access: true })
      );
      const state = create();
      await settle();

      expect(state.timeState()).toBe('ended');
      expect(state.actionSlot()).toBe('tools');
      expect(state.pastAccessKnown()).toBe(true);
    });

    it('does not know past access for a meeting the upcoming endpoint loaded', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: live({ start_time: '2023-11-14T22:13:20Z' }), project }));
      const state = create();
      await settle();

      expect(state.actionSlot()).toBe('no-access');
      expect(state.pastAccessKnown()).toBe(false);
    });

    it('lets a page auto-join a meeting once', () => {
      getPublicMeeting.mockReturnValue(new Subject());
      const state = create();

      expect(state.claimAutoJoin(MEETING_ID)).toBe(true);
      expect(state.claimAutoJoin(MEETING_ID)).toBe(false);
      expect(state.claimAutoJoin('another-meeting')).toBe(true);
    });

    // E2-02: V1's optimistic flip, then a lookup so the page catches up with the BFF.
    it('moves a registering outsider to the registrant state at once, and looks the meeting up again', async () => {
      const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      getPublicMeeting.mockReturnValue(of({ meeting: live({ start_time: later, is_invite_responses_enabled: true }), project }));
      const state = create();
      await settle();
      expect(state.actionSlot()).toBe('register');

      state.markRegistered(MEETING_ID);
      await settle();

      expect(state.viewerRole()).toBe('registrant');
      expect(state.actionSlot()).toBe('rsvp');
      expect(getPublicMeeting).toHaveBeenCalledTimes(2);
    });

    it('ignores a registration for a meeting the page has since left', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: live(), project }));
      const state = create();
      await settle();

      state.markRegistered('another-meeting');
      await settle();

      expect(state.viewerRole()).toBe('outsider');
      expect(getPublicMeeting).toHaveBeenCalledTimes(1);
    });

    // The held meeting outlives the route change until the next lookup resolves.
    it('ignores a registration that completes while the page is moving to another meeting', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: live(), project }));
      const state = create();
      await settle();

      getPublicMeeting.mockReturnValue(new Subject());
      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));
      await settle();
      state.markRegistered(MEETING_ID);

      getPublicMeeting.mockReturnValue(of({ meeting: live({ id: 'meeting-2' }), project }));
      expect(state.viewerRole()).toBe('outsider');
    });

    it('forgets a registration from this page when the route moves to another meeting', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: live(), project }));
      const state = create();
      await settle();
      state.markRegistered(MEETING_ID);
      await settle();

      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));
      getPublicMeeting.mockReturnValue(of({ meeting: live({ id: 'meeting-2' }), project }));
      await settle();

      expect(state.viewerRole()).toBe('outsider');
    });

    it('has no slot before the meeting loads', () => {
      getPublicMeeting.mockReturnValue(new Subject());
      const state = create();

      expect(state.actionSlot()).toBeNull();
      expect(state.joinsInWindow()).toBe(false);
    });
  });

  // E2-04 (FR-023).
  describe('my RSVP', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const upcoming = (overrides: Partial<Meeting> = {}) =>
      ({
        ...buildMeeting(),
        start_time: new Date(Date.now() + 3 * DAY).toISOString(),
        duration: 60,
        occurrences: [],
        visibility: 'public',
        restricted: false,
        invited: true,
        is_invite_responses_enabled: true,
        ...overrides,
      }) as unknown as Meeting;
    const rsvp = (responseType: string) => ({ id: 'rsvp-1', meeting_id: MEETING_ID, response_type: responseType }) as unknown as MeetingRsvp;
    // The request key reaches the fetch through `toObservable`, an effect, which a service-only
    // TestBed runs on `tick()`: settle the lookup, then flush the effect and the fetch it starts.
    const load = async (): Promise<void> => {
      await settle();
      TestBed.tick();
      await settle();
    };

    it("loads an invited viewer's own answer into the status the pill shows", async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming(), project }));
      getMyRsvp.mockReturnValue(of(rsvp('accepted')));
      const state = create();
      await load();

      expect(getMyRsvp).toHaveBeenCalledWith(MEETING_ID, undefined, false);
      expect(state.myRsvp()).toBe('accepted');
      expect(state.myRsvpAttr()).toBe('accepted');
      expect(state.meetingStatus()).toBe('going');
    });

    it('scopes the request to the selected occurrence of a series', async () => {
      const first = new Date(Date.now() + 3 * DAY).toISOString();
      getPublicMeeting.mockReturnValue(
        of({
          meeting: upcoming({
            start_time: first,
            recurrence: { type: 2 },
            occurrences: [{ occurrence_id: '1760000000', start_time: first, duration: 60 }],
          } as unknown as Partial<Meeting>),
          project,
        })
      );
      const state = create();
      await load();

      expect(state.myRsvp()).toBeNull();
      expect(getMyRsvp).toHaveBeenCalledWith(MEETING_ID, '1760000000', false);
    });

    // As V1 (#3458): a series with no resolved occurrence reads only its series-wide answer.
    it('asks for the series-wide answer only when a series has no resolved occurrence', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming({ recurrence: { type: 2 }, occurrences: [] } as unknown as Partial<Meeting>), project }));
      create();
      await load();

      expect(getMyRsvp).toHaveBeenCalledWith(MEETING_ID, undefined, true);
    });

    it('reads no answer as awaiting the RSVP', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming(), project }));
      const state = create();
      await load();

      expect(state.myRsvp()).toBeNull();
      expect(state.myRsvpAttr()).toBe('none');
      expect(state.meetingStatus()).toBe('awaiting-rsvp');
    });

    // As V1: a failed lookup reads as not answered, never as an error that ends the signal.
    it('reads a failed fetch as not answered', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming(), project }));
      getMyRsvp.mockReturnValue(throwError(() => ({ status: 500 })));
      const state = create();
      await load();

      expect(state.myRsvp()).toBeNull();
      expect(state.meetingStatus()).toBe('awaiting-rsvp');
    });

    // N-01 (FR-026): RSVP tracking off is the whole off-state, not just a missing fetch.
    it('gives an invitee on a meeting without RSVP tracking the unavailable slot and the time state', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming({ is_invite_responses_enabled: false }), project }));
      const state = create();
      await load();

      expect(state.actionSlot()).toBe('rsvp-unavailable');
      expect(state.meetingStatus()).toBe('upcoming');
      expect(state.myRsvpAttr()).toBeNull();
      expect(getMyRsvp).not.toHaveBeenCalled();
    });

    it.each([
      ['an outsider', { invited: false }, true],
      ['a meeting without RSVP tracking', { is_invite_responses_enabled: false }, true],
      ['an anonymous visitor', {}, false],
      ['an ended meeting', { start_time: '2023-11-14T22:13:20Z' }, true],
    ] as [string, Partial<Meeting>, boolean][])('does not fetch for %s', async (_label, overrides, signedIn) => {
      authenticated.set(signedIn);
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming(overrides), project }));
      const state = create();
      await load();

      expect(getMyRsvp).not.toHaveBeenCalled();
      expect(state.myRsvp()).toBeUndefined();
    });

    // The BFF answers before the indexer has caught up, so a fetch in flight must not win.
    it('applies a saved answer at once, and drops a fetch that was already in flight', async () => {
      const inFlight = new Subject<MeetingRsvp | null>();
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming(), project }));
      getMyRsvp.mockReturnValue(inFlight);
      const state = create();
      await load();

      state.setMyRsvp(MEETING_ID, undefined, rsvp('maybe'));
      inFlight.next(null);

      expect(state.myRsvp()).toBe('maybe');
      expect(state.meetingStatus()).toBe('maybe');
    });

    // The saved answer must survive the page's own re-lookups: the request key is deduplicated, so a
    // lagging refetch never overwrites it.
    it('keeps a saved answer when the meeting is looked up again', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming(), project }));
      const state = create();
      await load();
      state.setMyRsvp(MEETING_ID, undefined, rsvp('declined'));

      queryParamMap$.next(convertToParamMap({ utm: 'refresh' }));
      await load();

      expect(getMyRsvp).toHaveBeenCalledTimes(1);
      expect(state.myRsvp()).toBe('declined');
    });

    it('fetches again for another occurrence, and is unknown meanwhile', async () => {
      const first = new Date(Date.now() + 3 * DAY);
      const second = new Date(Date.now() + 10 * DAY);
      getPublicMeeting.mockReturnValue(
        of({
          meeting: upcoming({
            start_time: first.toISOString(),
            recurrence: { type: 2 },
            occurrences: [
              { occurrence_id: '1760000000', start_time: first.toISOString(), duration: 60 },
              { occurrence_id: '1760600000', start_time: second.toISOString(), duration: 60 },
            ],
          } as unknown as Partial<Meeting>),
          project,
        })
      );
      getMyRsvp.mockReturnValue(of(rsvp('accepted')));
      const state = create();
      await load();
      expect(state.myRsvp()).toBe('accepted');

      const pending = new Subject<MeetingRsvp | null>();
      getMyRsvp.mockReturnValue(pending);
      queryParamMap$.next(convertToParamMap({ occurrence: String(second.getTime()) }));
      await load();

      expect(getMyRsvp).toHaveBeenLastCalledWith(MEETING_ID, '1760600000', false);
      expect(state.myRsvp()).toBeUndefined();
    });

    // Checked against the route synchronously: right after a navigation, before the fetch for the new
    // occurrence has even started, a late save for the old one is already dropped.
    it('drops a late save for the occurrence the page has just left', async () => {
      const first = new Date(Date.now() + 3 * DAY);
      const second = new Date(Date.now() + 10 * DAY);
      getPublicMeeting.mockReturnValue(
        of({
          meeting: upcoming({
            start_time: first.toISOString(),
            recurrence: { type: 2 },
            occurrences: [
              { occurrence_id: '1760000000', start_time: first.toISOString(), duration: 60 },
              { occurrence_id: '1760600000', start_time: second.toISOString(), duration: 60 },
            ],
          } as unknown as Partial<Meeting>),
          project,
        })
      );
      const state = create();
      await load();

      getMyRsvp.mockReturnValue(new Subject<MeetingRsvp | null>());
      queryParamMap$.next(convertToParamMap({ occurrence: String(second.getTime()) }));
      state.setMyRsvp(MEETING_ID, '1760000000', rsvp('accepted'));

      // Not even briefly: an async key would still hold the old occurrence here and let it through.
      expect(state.myRsvp()).not.toBe('accepted');
      await load();
      expect(state.myRsvp()).toBeUndefined();
    });

    // E2-05's save is async: one that lands after the page moved on must not mark the new view.
    it('drops a saved answer for an occurrence or meeting the page is no longer on', async () => {
      getPublicMeeting.mockReturnValue(of({ meeting: upcoming(), project }));
      const state = create();
      await load();

      state.setMyRsvp('another-meeting', undefined, rsvp('accepted'));
      state.setMyRsvp(MEETING_ID, '1760000000', rsvp('accepted'));

      expect(state.myRsvp()).toBeNull();
    });
  });

  // E3-01: the page's sections read their visibility from one decision (E0-02).
  describe('visible sections', () => {
    it('shows the agenda of an upcoming meeting', async () => {
      getPublicMeeting.mockReturnValue(
        of({ meeting: { ...buildMeeting(), start_time: new Date(Date.now() + 86_400_000).toISOString(), duration: 60 }, project })
      );
      const state = create();
      await settle();

      expect(state.visibleSections()?.agenda).toBe(true);
    });

    it('hides the agenda of an ended meeting the viewer has no access to', async () => {
      paramMap$.next(convertToParamMap({ id: '99152950841-1700000000000' }));
      getPublicPastMeeting.mockReturnValue(
        of({ meeting: { ...buildMeeting(), start_time: '2023-11-14T22:13:20Z', duration: 60 }, project, full_access: false })
      );
      const state = create();
      await settle();

      expect(state.visibleSections()?.agenda).toBe(false);
    });

    // V1's navigation rule: a recurring meeting, or a past occurrence of a series (no `recurrence` on it).
    it('offers no occurrence navigation for a one-off meeting', async () => {
      getPublicMeeting.mockReturnValue(
        of({ meeting: { ...buildMeeting(), start_time: new Date(Date.now() + 86_400_000).toISOString(), duration: 60 }, project })
      );
      const state = create();
      await settle();

      expect(state.visibleSections()?.occurrences).toBe(false);
    });

    it('offers it for a past occurrence of a series, whose payload has no recurrence', async () => {
      paramMap$.next(convertToParamMap({ id: '99152950841-1700000000000' }));
      getPublicPastMeeting.mockReturnValue(
        of({
          meeting: { ...buildMeeting('99152950841-1700000000000'), meeting_id: '99152950841', start_time: '2023-11-14T22:13:20Z', duration: 60 },
          project,
          full_access: false,
        })
      );
      const state = create();
      await settle();

      expect(state.visibleSections()?.occurrences).toBe(true);
    });

    it('has no sections before the meeting loads', () => {
      getPublicMeeting.mockReturnValue(new Subject());

      expect(create().visibleSections()).toBeNull();
    });
  });

  describe('roster request', () => {
    const upcoming = (overrides: Partial<Meeting> = {}) =>
      of({ meeting: { ...buildMeeting(), start_time: new Date(Date.now() + 86_400_000).toISOString(), duration: 60, ...overrides }, project });

    it('fetches the roster for an organizer of an upcoming meeting', async () => {
      getPublicMeeting.mockReturnValue(upcoming({ organizer: true }));
      const state = create();
      await settle();

      expect(state.rosterRequest()).toEqual({ meetingId: MEETING_ID, occurrenceId: undefined });
    });

    // V1's gate: a registrant sees the other guests only when the organizer shares the list.
    it.each([
      [true, true],
      [false, false],
    ])('gives a registrant a roster only when the guest list is shared (shared %s)', async (shared, expected) => {
      getPublicMeeting.mockReturnValue(upcoming({ invited: true, show_meeting_attendees: shared }));
      const state = create();
      await settle();

      expect(state.rosterRequest() !== null).toBe(expected);
    });

    it('gives no roster to a signed-in outsider', async () => {
      getPublicMeeting.mockReturnValue(upcoming({ show_meeting_attendees: true }));
      const state = create();
      await settle();

      expect(state.rosterRequest()).toBeNull();
    });

    it('gives no roster to an anonymous viewer, even one the payload calls invited', async () => {
      authenticated.set(false);
      getPublicMeeting.mockReturnValue(upcoming({ invited: true, show_meeting_attendees: true }));
      const state = create();
      await settle();

      expect(state.rosterRequest()).toBeNull();
    });

    it('gives no roster on an ended meeting, even to its organizer', async () => {
      getPublicMeeting.mockReturnValue(
        of({ meeting: { ...buildMeeting(), organizer: true, start_time: new Date(Date.now() - 86_400_000).toISOString(), duration: 60 }, project })
      );
      const state = create();
      await settle();

      expect(state.rosterRequest()).toBeNull();
    });
  });

  describe('sign-in link', () => {
    it('signs in back to this meeting', () => {
      getPublicMeeting.mockReturnValue(new Subject());
      const state = create();

      expect(state.signInHref()).toBe(`/login?returnTo=${encodeURIComponent(`${environment.urls.home}/meetings/${MEETING_ID}`)}`);
    });

    // FR-013: the password and the selected occurrence both survive the round trip through login.
    it('keeps the query string, ?password= included, in returnTo', () => {
      queryParamMap$.next(convertToParamMap({ password: 'a&b c', occurrence: '1700000000000' }));
      getPublicMeeting.mockReturnValue(new Subject());
      const state = create();

      const returnTo = new URL(state.signInHref(), 'http://localhost').searchParams.get('returnTo') ?? '';
      const target = new URL(returnTo);

      expect(target.pathname).toBe(`/meetings/${MEETING_ID}`);
      expect(target.searchParams.get('password')).toBe('a&b c');
      expect(target.searchParams.get('occurrence')).toBe('1700000000000');
    });
  });

  describe('on the server', () => {
    // The browser completes the timeline after hydration, as V1 does.
    it('reads no series timeline', async () => {
      getPublicMeetingOccurrences.mockClear();
      getPublicMeeting.mockReturnValue(of({ meeting: { ...buildMeeting(), recurrence: { type: 2 } }, project }));
      const state = create('server');
      await settle();

      expect(getPublicMeetingOccurrences).not.toHaveBeenCalled();
      expect(state.seriesOccurrences()).toEqual({ past: [], future: [] });
    });

    it('writes the resolved meeting to TransferState in the shape V1 writes', async () => {
      create('server');
      await settle();

      expect(TestBed.inject(TransferState).get(stateKey, null)).toEqual({
        meeting: { ...buildMeeting(), project },
        loadedViaPastMeetingId: false,
        pastMeetingFullAccess: false,
        meetingLoadFailed: false,
      });
    });

    it('writes the terminal-error branch so the client hydrates to the same view', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      create('server');
      await settle();

      expect(TestBed.inject(TransferState).get(stateKey, null)).toMatchObject({ meeting: null, meetingLoadFailed: true });
    });

    it('never reads a seed', () => {
      seed = { meeting: { ...buildMeeting(), project }, loadedViaPastMeetingId: false, pastMeetingFullAccess: false, meetingLoadFailed: false };
      const state = create('server');

      expect(state.status()).toBe('loading');
    });
  });

  /**
   * #3261: V2 keeps V1's SSR invariants (meeting-join.component.spec.ts, GH-2041), re-asserted here
   * against the V2 state service with the request held open, so a fix reverted would fail.
   */
  describe('V1 parity: SSR seed and hydration (GH-2041)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const ended = (id = MEETING_ID) =>
      ({
        ...buildMeeting(id),
        start_time: new Date(Date.now() - 3 * DAY).toISOString(),
        duration: 60,
        occurrences: [],
        organizer: false,
      }) as unknown as Meeting;

    it('holds a seeded error while the hydration refetch is still in flight', async () => {
      seed = { meeting: null, loadedViaPastMeetingId: false, pastMeetingFullAccess: false, meetingLoadFailed: true };
      const pending = new Subject<{ meeting: Meeting; project: PublicMeetingProject }>();
      getPublicMeeting.mockReturnValue(pending.asObservable());
      const state = create();

      expect(state.status()).toBe('error');
      await settle(); // the debounce has flushed and the refetch is pending
      expect(getPublicMeeting).toHaveBeenCalledTimes(1);
      expect(state.status()).toBe('error');

      pending.next({ meeting: buildMeeting(), project });
      expect(state.status()).toBe('ready');
    });

    it('keeps a seeded page, not a skeleton, while the hydration refetch is still in flight', async () => {
      seed = { meeting: { ...buildMeeting(), project }, loadedViaPastMeetingId: false, pastMeetingFullAccess: false, meetingLoadFailed: false };
      getPublicMeeting.mockReturnValue(new Subject().asObservable());
      const state = create();

      await settle();

      expect(state.status()).toBe('ready');
      expect(state.meeting()?.title).toBe('Weekly Sync');
    });

    it('restores a seeded past branch, and holds it while the hydration refetch is in flight', async () => {
      seed = { meeting: { ...ended(), project }, loadedViaPastMeetingId: true, pastMeetingFullAccess: true, meetingLoadFailed: false };
      // Held open: only the seed can be setting the flags while the refetch is pending.
      getPublicMeeting.mockReturnValue(new Subject().asObservable());
      const state = create();

      expect(state.loadedViaPastMeetingId()).toBe(true);
      expect(state.pastMeetingFullAccess()).toBe(true);
      expect(state.timeState()).toBe('ended');
      expect(state.actionSlot()).toBe('tools');

      await settle();

      expect(getPublicMeeting).toHaveBeenCalledTimes(1);
      expect(state.loadedViaPastMeetingId()).toBe(true);
      expect(state.pastMeetingFullAccess()).toBe(true);
      expect(state.actionSlot()).toBe('tools');
    });

    it('has the ?password= param from construction, so the first and only lookup carries it', async () => {
      queryParamMap$.next(convertToParamMap({ password: 'secret' }));
      const state = create();

      expect(state.password()).toBe('secret');
      await settle();
      expect(getPublicMeeting).toHaveBeenCalledTimes(1);
      expect(getPublicMeeting).toHaveBeenCalledWith(MEETING_ID, 'secret');
    });

    it('writes the past branch to TransferState on the server', async () => {
      const pastId = '99152950841-1700000000000';
      paramMap$.next(convertToParamMap({ id: pastId }));
      getPublicPastMeeting.mockReturnValue(of({ meeting: ended(pastId), project, full_access: true }));
      create('server');
      await settle();

      expect(TestBed.inject(TransferState).get(stateKey, null)).toMatchObject({
        loadedViaPastMeetingId: true,
        pastMeetingFullAccess: true,
        meetingLoadFailed: false,
      });
    });

    it('does not redirect on a terminal error on the server', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      create('server');
      await settle();

      expect(navigate).not.toHaveBeenCalled();
    });
  });

  /** #3261 (N-01): with RSVP tracking off, no viewer gets any RSVP surface, whatever the time. */
  describe('RSVP tracking off', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const meeting = (startOffsetMs: number, overrides: Partial<Meeting> = {}) =>
      ({
        ...buildMeeting(),
        start_time: new Date(Date.now() + startOffsetMs).toISOString(),
        duration: 60,
        occurrences: [],
        visibility: 'public',
        restricted: false,
        is_invite_responses_enabled: false,
        ...overrides,
      }) as unknown as Meeting;

    it.each([
      ['an organizer before the meeting', meeting(3 * DAY, { organizer: true, invited: true }), 'none', 'upcoming'],
      ['an invitee before the meeting', meeting(3 * DAY, { invited: true }), 'rsvp-unavailable', 'upcoming'],
      ['an organizer during the meeting', meeting(-5 * 60 * 1000, { organizer: true, invited: true }), 'join', 'live'],
    ])('gives %s no RSVP surface', async (_label, payload, slot, status) => {
      getPublicMeeting.mockReturnValue(of({ meeting: payload, project }));
      const state = create();
      await settle();

      expect(state.actionSlot()).toBe(slot);
      expect(state.meetingStatus()).toBe(status);
      expect(state.visibleSections()).toMatchObject({ rsvpSummary: false, rsvpRosterFilter: false, rsvpAvatarBadges: false });
      expect(state.myRsvpAttr()).toBeNull();
      expect(getMyRsvp).not.toHaveBeenCalled();
    });

    it('reads an ended meeting as ended, with no RSVP surface, for its organizer', async () => {
      const pastId = '99152950841-1700000000000';
      paramMap$.next(convertToParamMap({ id: pastId }));
      getPublicPastMeeting.mockReturnValue(of({ meeting: meeting(-3 * DAY, { id: pastId, organizer: true }), project, full_access: true }));
      const state = create();
      await settle();

      expect(state.meetingStatus()).toBe('ended');
      expect(state.visibleSections()).toMatchObject({ rsvpSummary: false, rsvpRosterFilter: false, rsvpAvatarBadges: false });
    });
  });
});
