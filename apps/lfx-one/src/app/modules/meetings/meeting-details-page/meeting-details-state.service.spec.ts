// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { MEETING_JOIN_STATE_KEY } from '@lfx-one/shared/constants';
import { Meeting, MeetingJoinPageState, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
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
  let navigate: ReturnType<typeof vi.fn>;
  let seed: MeetingJoinPageState | null;

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
        { provide: MeetingService, useValue: { getPublicMeeting, getPublicPastMeeting } },
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
    navigate = vi.fn().mockResolvedValue(true);
    seed = null;
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

    it('has no time state before the meeting loads', () => {
      getPublicMeeting.mockReturnValue(new Subject());
      const state = create();

      expect(state.timeState()).toBeNull();
    });
  });

  describe('on the server', () => {
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
});
