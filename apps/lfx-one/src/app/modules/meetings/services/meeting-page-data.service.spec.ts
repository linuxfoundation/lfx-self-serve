// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, makeStateKey, PLATFORM_ID, signal, Signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { Meeting, MeetingJoinPageState, PublicMeetingProject } from '@lfx-one/shared';
import { TRANSIENT_RETRY_DELAY_MS } from '@lfx-one/shared/constants';
import { MeetingService } from '@services/meeting.service';
import { PlausibleService } from '@services/plausible.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, defer, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingPageDataService } from './meeting-page-data.service';

@Component({ selector: 'lfx-test-meeting-page-host', template: '', providers: [MeetingPageDataService] })
class TestHostComponent {
  public readonly data = inject(MeetingPageDataService);
  public readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined> = this.data.load();
}

const project = { uid: 'p1', name: 'Project', slug: 'project' } as PublicMeetingProject;
const stateKey = makeStateKey<MeetingJoinPageState>('meetingJoinState');
const failureSeed: MeetingJoinPageState = {
  meeting: null,
  loadedViaPastMeetingId: false,
  pastMeetingFullAccess: false,
  liveMeetingFullAccess: false,
  liveMeetingCanJoin: false,
  meetingLoadFailed: true,
};

// A cold request that fails with each error in turn, then succeeds: `retry` resubscribes the request the way it re-sends an HTTP call.
const failingThen = <T>(errors: HttpErrorResponse[], response: T): { request: Observable<T>; subscriptions: () => number } => {
  let subscriptions = 0;
  const request = defer(() => {
    const error = errors[subscriptions++];
    return error ? throwError(() => error) : of(response);
  });
  return { request, subscriptions: () => subscriptions };
};

describe('MeetingPageDataService', () => {
  let paramMap$: BehaviorSubject<ParamMap>;
  let queryParamMap$: BehaviorSubject<ParamMap>;
  let getPublicMeeting: ReturnType<typeof vi.fn>;
  let getPublicPastMeeting: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let trackPage: ReturnType<typeof vi.fn>;
  let analyticsReady: ReturnType<typeof signal<boolean>>;

  const create = async (): Promise<TestHostComponent> => {
    const fixture = TestBed.createComponent(TestHostComponent);
    await new Promise((resolve) => setTimeout(resolve));
    return fixture.componentInstance;
  };

  beforeEach(() => {
    paramMap$ = new BehaviorSubject(convertToParamMap({ id: '123' }));
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    getPublicMeeting = vi.fn().mockReturnValue(of({ meeting: { id: '123', title: 'Live' }, project, full_access: true, can_join: false }));
    getPublicPastMeeting = vi.fn().mockReturnValue(of({ meeting: { id: '123-1700000000000', title: 'Past' }, project, full_access: true }));
    navigate = vi.fn();
    trackPage = vi.fn();
    analyticsReady = signal(false);

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
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
        { provide: UserService, useValue: { authenticated: signal(true) } },
        { provide: PlausibleService, useValue: { ready: analyticsReady, trackPage } },
      ],
    });
  });

  it('loads an upcoming meeting with the password from the URL', async () => {
    queryParamMap$.next(convertToParamMap({ password: 'secret' }));
    const host = await create();

    expect(getPublicMeeting).toHaveBeenCalledWith('123', 'secret');
    expect(host.meeting()?.title).toBe('Live');
    expect(host.data.urlPassword()).toBe('secret');
    expect(host.data.liveMeetingFullAccess()).toBe(true);
    expect(host.data.loadedViaPastMeetingId()).toBe(false);
    expect(host.data.meetingMatchesRoute()).toBe(true);
  });

  it('loads a {id}-{ms} id as a past meeting without trying the upcoming lookup', async () => {
    paramMap$.next(convertToParamMap({ id: '123-1700000000000' }));
    const host = await create();

    expect(getPublicMeeting).not.toHaveBeenCalled();
    expect(host.meeting()?.title).toBe('Past');
    expect(host.data.loadedViaPastMeetingId()).toBe(true);
    expect(host.data.pastMeetingFullAccess()).toBe(true);
  });

  it('falls back to the past meeting when the upcoming lookup 404s', async () => {
    getPublicMeeting.mockReturnValue(throwError(() => ({ status: 404 })));
    const host = await create();

    expect(getPublicPastMeeting).toHaveBeenCalledWith('123');
    expect(host.data.loadedViaPastMeetingId()).toBe(true);
  });

  it('sends a forbidden meeting to not-found', async () => {
    getPublicMeeting.mockReturnValue(throwError(() => ({ status: 403 })));
    const host = await create();

    expect(navigate).toHaveBeenCalledWith(['/meetings/not-found']);
    expect(host.data.meetingLoadFailed()).toBe(false);
  });

  it('flags a server error as a failed load instead of leaving the page', async () => {
    getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
    const host = await create();

    expect(navigate).not.toHaveBeenCalled();
    expect(host.data.meetingLoadFailed()).toBe(true);
  });

  describe('server failure handoff and transient retry (#5907)', () => {
    const live = { meeting: { id: '123', title: 'Live' }, project, full_access: true, can_join: false };
    const past = { meeting: { id: '123-1700000000000', title: 'Past' }, project, full_access: true };
    const unavailable = (): HttpErrorResponse => new HttpErrorResponse({ status: 503 });
    // `debounceTime(0)` and the retry `timer` run on RxJS's interval scheduler, so only intervals are faked: `create()`'s
    // real `setTimeout` flush still settles Angular, then virtual time starts the load and later the retry.
    const start = async (): Promise<TestHostComponent> => {
      const host = await create();
      await vi.advanceTimersByTimeAsync(0);
      return host;
    };
    const waitForRetry = (): Promise<unknown> => vi.advanceTimersByTimeAsync(TRANSIENT_RETRY_DELAY_MS);

    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));

    afterEach(() => {
      TestBed.resetTestingModule();
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('keeps the skeleton over a server failure seed while the browser fetch is pending, then shows the meeting', async () => {
      const response$ = new Subject<typeof live>();
      getPublicMeeting.mockReturnValue(response$.asObservable());
      TestBed.inject(TransferState).set(stateKey, failureSeed);
      const host = await start();

      expect(host.meeting()).toBeUndefined();
      expect(host.data.meetingLoadFailed()).toBe(false);

      response$.next(live);
      response$.complete();

      expect(host.meeting()?.title).toBe('Live');
      expect(host.data.meetingLoadFailed()).toBe(false);
    });

    it('shows the error when the browser fetch after a server failure seed also fails', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));
      TestBed.inject(TransferState).set(stateKey, failureSeed);
      const host = await start();

      expect(host.data.meetingLoadFailed()).toBe(true);
    });

    it('retries a transient failure once in the browser and shows the meeting', async () => {
      const { request, subscriptions } = failingThen([unavailable()], live);
      getPublicMeeting.mockReturnValue(request);
      const host = await start();

      expect(subscriptions()).toBe(1);
      expect(host.data.meetingLoadFailed()).toBe(false);

      await waitForRetry();

      expect(subscriptions()).toBe(2);
      expect(host.meeting()?.title).toBe('Live');
      expect(host.data.meetingLoadFailed()).toBe(false);
    });

    it('shows the error once the retry fails too', async () => {
      const { request, subscriptions } = failingThen([unavailable(), unavailable()], live);
      getPublicMeeting.mockReturnValue(request);
      const host = await start();
      await waitForRetry();

      expect(subscriptions()).toBe(2);
      expect(host.data.meetingLoadFailed()).toBe(true);
    });

    it('sends a forbidden meeting to not-found without retrying', async () => {
      const { request, subscriptions } = failingThen([new HttpErrorResponse({ status: 403 })], live);
      getPublicMeeting.mockReturnValue(request);
      await start();

      expect(subscriptions()).toBe(1);
      expect(navigate).toHaveBeenCalledWith(['/meetings/not-found']);
    });

    it('retries a transient failure on the past-meeting fallback', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
      const { request, subscriptions } = failingThen([unavailable()], past);
      getPublicPastMeeting.mockReturnValue(request);
      const host = await start();
      await waitForRetry();

      expect(getPublicPastMeeting).toHaveBeenCalledTimes(1);
      expect(subscriptions()).toBe(2);
      expect(host.data.loadedViaPastMeetingId()).toBe(true);
      expect(host.meeting()?.title).toBe('Past');
    });

    it('retries a transient failure on a {id}-{ms} past meeting', async () => {
      paramMap$.next(convertToParamMap({ id: '123-1700000000000' }));
      const { request, subscriptions } = failingThen([unavailable()], past);
      getPublicPastMeeting.mockReturnValue(request);
      const host = await start();

      expect(subscriptions()).toBe(1);
      expect(host.data.meetingLoadFailed()).toBe(false);

      await waitForRetry();

      expect(subscriptions()).toBe(2);
      expect(getPublicMeeting).not.toHaveBeenCalled();
      expect(host.meeting()?.title).toBe('Past');
      expect(host.data.meetingLoadFailed()).toBe(false);
    });

    it('shows loading, not the error, while a refresh from the error and its retry run', async () => {
      const { request, subscriptions } = failingThen([unavailable(), unavailable(), unavailable()], live);
      getPublicMeeting.mockReturnValue(request);
      const host = await start();
      await waitForRetry();
      expect(host.data.meetingLoadFailed()).toBe(true);

      host.data.refresh();
      expect(host.data.meetingLoadFailed()).toBe(false);

      await vi.advanceTimersByTimeAsync(0);
      expect(subscriptions()).toBe(3);
      expect(host.data.meetingLoadFailed()).toBe(false);

      await waitForRetry();
      expect(subscriptions()).toBe(4);
      expect(host.meeting()?.title).toBe('Live');
      expect(host.data.meetingLoadFailed()).toBe(false);
    });

    it('renders the skeleton on the server and hands the failure to the browser without retrying', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
      const { request, subscriptions } = failingThen([unavailable()], live);
      getPublicMeeting.mockReturnValue(request);
      const host = await start();

      expect(subscriptions()).toBe(1);
      expect(host.data.meetingLoadFailed()).toBe(false);
      expect(TestBed.inject(TransferState).get(stateKey, null)).toEqual(expect.objectContaining({ meeting: null, meetingLoadFailed: true }));
    });
  });

  it('counts a load as a reload only once one was asked for', async () => {
    const host = await create();
    expect(host.data.reloadsDone()).toBe(0);

    host.data.refresh();
    await new Promise((resolve) => setTimeout(resolve));
    expect(host.data.reloadsDone()).toBe(1);

    host.data.reloadOnNextLoad();
    expect(host.data.reloadsDone()).toBe(1);
    queryParamMap$.next(convertToParamMap({ occurrence: '1' }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(host.data.reloadsDone()).toBe(2);
  });

  describe('claimJoinOnLoad', () => {
    const openNow = (): void => {
      const start = new Date(Date.now() - 5 * 60_000).toISOString();
      getPublicMeeting.mockReturnValue(
        of({ meeting: { id: '123', title: 'Live', start_time: start, duration: 60 }, project, full_access: true, can_join: true })
      );
    };

    it('allows Zoom to open once when the join window was open at load', async () => {
      openNow();
      const host = await create();

      expect(host.data.claimJoinOnLoad()).toBe(true);
      expect(host.data.claimJoinOnLoad()).toBe(false);
    });

    it.each([{ zoom_redirect: 'false' }, { action: 'leave' }])('never allows it with %o in the URL', async (params) => {
      openNow();
      queryParamMap$.next(convertToParamMap(params));
      const host = await create();

      expect(host.data.claimJoinOnLoad()).toBe(false);
    });

    it('decides again for another meeting the page moves to', async () => {
      openNow();
      const host = await create();
      expect(host.data.claimJoinOnLoad()).toBe(true);

      paramMap$.next(convertToParamMap({ id: '456' }));
      await new Promise((resolve) => setTimeout(resolve));

      expect(host.data.claimJoinOnLoad()).toBe(true);
    });

    it('never allows it when the window opened after load', async () => {
      const host = await create();

      expect(host.data.claimJoinOnLoad()).toBe(false);
    });
  });

  it('resolves ?occurrence= to that active date', async () => {
    queryParamMap$.next(convertToParamMap({ occurrence: String(Date.parse('2030-01-08T10:00:00Z')) }));
    const host = await create();
    const meeting = {
      occurrences: [
        { occurrence_id: 'a', start_time: '2030-01-01T10:00:00Z', duration: 60 },
        { occurrence_id: 'b', start_time: '2030-01-08T10:00:00Z', duration: 60 },
      ],
    } as Meeting;

    expect(host.data.resolveOccurrence(meeting)?.occurrence_id).toBe('b');
  });

  it('sends one pageview with the foundation and project once analytics is ready', async () => {
    getPublicMeeting.mockReturnValue(
      of({
        meeting: { id: '123' },
        project: { ...project, slug: 'child', name: 'Child', parent_uid: 'f1', parent: { slug: 'found', name: 'Foundation' } },
        full_access: true,
        can_join: false,
      })
    );
    const host = await create();
    host.data.trackPageview();
    TestBed.tick();
    expect(trackPage).not.toHaveBeenCalled();

    analyticsReady.set(true);
    TestBed.tick();
    host.data.refresh();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();

    expect(trackPage).toHaveBeenCalledTimes(1);
    expect(trackPage).toHaveBeenCalledWith({ foundation: 'found', foundation_name: 'Foundation', project: 'child', project_name: 'Child' });
  });

  it('treats a top-level project as the foundation', async () => {
    analyticsReady.set(true);
    const host = await create();
    host.data.trackPageview();
    TestBed.tick();

    expect(trackPage).toHaveBeenCalledWith({ foundation: 'project', foundation_name: 'Project' });
  });

  it('drops a pageview still waiting for analytics when a newer one replaces it', async () => {
    const host = await create();
    host.data.trackPageview();
    host.data.trackPageview();
    analyticsReady.set(true);
    TestBed.tick();

    expect(trackPage).toHaveBeenCalledTimes(1);
  });
});
