// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, makeStateKey, PLATFORM_ID, signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { Meeting, MeetingJoinPageState, MeetingOccurrence, MeetingRegistrant, PublicMeetingProject, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { PlausibleService } from '@services/plausible.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { installMatchMediaShim } from '@shared/testing/header-test-providers';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingJoinComponent } from './meeting-join.component';

// Regression coverage for GH-1731's guest-add orchestration: the join page maintains an optimistic
// pad of guest-add counts (onRegistrantsRefreshRequested) that reconcileOptimisticPad reconciles
// against the roster refetch, and a `registrantsRosterKey` guard that prevents a failed refetch
// from leaking a previous meeting's roster into a newly-navigated meeting. Both were fixed during
// PR #1748 review: a null baseline no longer gets treated as "absorbed" (dealako's ask).
describe('MeetingJoinComponent', () => {
  const MEETING_ID = 'meeting-1';
  const FUTURE_START_TIME = '2099-01-01T00:00:00.000Z';
  const MEETING_JOIN_STATE_KEY = makeStateKey<MeetingJoinPageState>('meetingJoinState');

  let getPublicMeeting: ReturnType<typeof vi.fn>;
  let getPublicPastMeeting: ReturnType<typeof vi.fn>;
  let getMyMeetingRegistrants: ReturnType<typeof vi.fn>;
  let getPastMeetingSummary: ReturnType<typeof vi.fn>;
  let getPastMeetingRecording: ReturnType<typeof vi.fn>;
  let getPastMeetingAttachments: ReturnType<typeof vi.fn>;
  let getPastMeetingParticipants: ReturnType<typeof vi.fn>;
  let getPastMeetingTranscript: ReturnType<typeof vi.fn>;
  let getPublicMeetingOccurrences: ReturnType<typeof vi.fn>;
  let paramMap$: BehaviorSubject<ParamMap>;
  let queryParamMap$: BehaviorSubject<ParamMap>;
  let authenticated: ReturnType<typeof signal<boolean>>;

  let registrantUidCounter = 0;

  const buildMeeting = (overrides: Partial<Meeting> = {}) =>
    ({
      id: MEETING_ID,
      uid: MEETING_ID,
      project_uid: 'project-1',
      organizer: true,
      invited: false,
      start_time: FUTURE_START_TIME,
      duration: 60,
      early_join_time_minutes: 10,
      recurrence: null,
      occurrences: [],
      cancelled_occurrences: [],
      meeting_type: 'Board',
      visibility: 'public',
      restricted: false,
      password: null,
      ai_summary_enabled: false,
      recording_enabled: false,
      host_key: null,
      can_view_host_key: false,
      registrants_accepted_count: 0,
      registrants_declined_count: 0,
      registrants_pending_count: 0,
      ...overrides,
    }) as unknown as Meeting;

  const buildProject = () => ({ uid: 'project-1', name: 'Test Project', slug: 'test-project' }) as unknown as PublicMeetingProject;

  const buildRegistrants = (count: number) =>
    Array.from(
      { length: count },
      () =>
        ({
          uid: `reg-${++registrantUidCounter}`,
          meeting_id: MEETING_ID,
          email: 'attendee@example.com',
          first_name: 'Test',
          last_name: 'Attendee',
          type: 'direct',
        }) as unknown as MeetingRegistrant
    );

  const createComponent = async () => {
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(MeetingJoinComponent);
    await TestBed.inject(ApplicationRef).whenStable();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    installMatchMediaShim();
    registrantUidCounter = 0;
    authenticated = signal(true);
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: MEETING_ID }));
    queryParamMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));

    getPublicMeeting = vi.fn().mockReturnValue(of({ meeting: buildMeeting(), project: buildProject() }));
    getPublicPastMeeting = vi.fn().mockReturnValue(throwError(() => ({ status: 404 })));
    getMyMeetingRegistrants = vi.fn().mockReturnValue(of([]));
    getPastMeetingSummary = vi.fn().mockReturnValue(of(null));
    getPastMeetingRecording = vi.fn().mockReturnValue(of(null));
    getPastMeetingAttachments = vi.fn().mockReturnValue(of([]));
    getPastMeetingParticipants = vi.fn().mockReturnValue(of([]));
    getPastMeetingTranscript = vi.fn().mockReturnValue(of(null));
    getPublicMeetingOccurrences = vi.fn().mockReturnValue(of({ past: [], future: [] }));

    TestBed.configureTestingModule({
      imports: [MeetingJoinComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
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
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: MeetingService,
          useValue: {
            getPublicMeeting,
            getPublicPastMeeting,
            getPublicMeetingOccurrences,
            getPublicMeetingJoinUrl: vi.fn().mockReturnValue(of({ link: undefined })),
            getMyMeetingRegistrants,
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRsvpForCurrentUser: vi.fn().mockReturnValue(of(null)),
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
            getPastMeetingSummary,
            getPastMeetingRecording,
            getPastMeetingAttachments,
            getPastMeetingParticipants,
            getPastMeetingTranscript,
            stripMetadata: vi.fn(),
            createRegistrantFormGroup: vi.fn(
              () =>
                new FormGroup({
                  first_name: new FormControl(''),
                  last_name: new FormControl(''),
                  email: new FormControl(''),
                  job_title: new FormControl(''),
                  org_name: new FormControl(''),
                  host: new FormControl(false),
                  linkedin_profile: new FormControl(''),
                })
            ),
          },
        },
        {
          provide: UserService,
          useValue: {
            authenticated,
            user: signal<User | null>({ email: 'me@example.com' } as unknown as User),
            impersonating: signal(false),
            impersonator: signal(null),
            viewerUsername: signal<string | null>('me'),
            effectiveAvatarUrl: signal(''),
            getCurrentUserProfile: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: ProjectContextService, useValue: { setFoundation: vi.fn() } },
        { provide: PlausibleService, useValue: { ready: signal(true), trackPage: vi.fn() } },
        { provide: Clipboard, useValue: { copy: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  it('clears registrantsLoading and yields no registrants when the viewer is unauthenticated', async () => {
    authenticated.set(false);
    const component = await createComponent();

    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toEqual([]);
    expect((component as unknown as { registrantsLoading: () => boolean }).registrantsLoading()).toBe(false);
    expect(getMyMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('establishes a fresh baseline instead of treating growth as absorption when a guest is added before the roster has ever loaded', async () => {
    const pendingFirstFetch = new Subject<MeetingRegistrant[]>();
    getMyMeetingRegistrants.mockReturnValueOnce(pendingFirstFetch.asObservable()).mockReturnValueOnce(of(buildRegistrants(10)));

    const component = await createComponent();

    component.onRegistrantsRefreshRequested(2);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(component.additionalRegistrantsCount()).toBe(2);
    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(10);
  });

  it('zeroes the pad once the refetch reflects the confirmed baseline plus every added guest', async () => {
    getMyMeetingRegistrants.mockReturnValueOnce(of(buildRegistrants(10))).mockReturnValueOnce(of(buildRegistrants(12)));

    const component = await createComponent();
    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(10);

    component.onRegistrantsRefreshRequested(2);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(component.additionalRegistrantsCount()).toBe(0);
    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(12);
  });

  it('partially absorbs the pad and rebases the snapshot before fully converging on a later refetch', async () => {
    getMyMeetingRegistrants
      .mockReturnValueOnce(of(buildRegistrants(10)))
      .mockReturnValueOnce(of(buildRegistrants(11)))
      .mockReturnValueOnce(of(buildRegistrants(12)));

    const component = await createComponent();

    component.onRegistrantsRefreshRequested(2);
    await TestBed.inject(ApplicationRef).whenStable();
    expect(component.additionalRegistrantsCount()).toBe(1);

    // No new guest added — just re-triggers the refresh to observe the pad finish converging.
    component.onRegistrantsRefreshRequested(0);
    await TestBed.inject(ApplicationRef).whenStable();
    expect(component.additionalRegistrantsCount()).toBe(0);
  });

  it("falls back to an empty roster instead of leaking a previous meeting's roster when the refetch for a newly-navigated meeting fails", async () => {
    const MEETING_ID_2 = 'meeting-2';
    getPublicMeeting.mockImplementation((id: string) =>
      id === MEETING_ID_2
        ? of({ meeting: buildMeeting({ id: MEETING_ID_2 }), project: buildProject() })
        : of({ meeting: buildMeeting(), project: buildProject() })
    );
    getMyMeetingRegistrants.mockReturnValueOnce(of(buildRegistrants(3))).mockReturnValueOnce(throwError(() => new Error('roster fetch failed')));

    const component = await createComponent();
    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(3);

    // The meeting-fetch pipeline debounces route-param changes via a real (non-zone-tracked) RxJS
    // timer, so `whenStable()` alone can resolve before it fires. Fake timers hang here because they
    // also intercept Angular's own zoneless scheduling internals — a real macrotask tick is required
    // to flush the debounce deterministically.
    paramMap$.next(convertToParamMap({ id: MEETING_ID_2 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await TestBed.inject(ApplicationRef).whenStable();

    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toEqual([]);
  });

  it('preserves the roster and the optimistic pad when a refetch for the SAME meeting+occurrence fails', async () => {
    getMyMeetingRegistrants
      .mockReturnValueOnce(of(buildRegistrants(10)))
      .mockReturnValueOnce(throwError(() => new Error('roster fetch failed')))
      .mockReturnValueOnce(of(buildRegistrants(11)));

    const component = await createComponent();
    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(10);

    component.onRegistrantsRefreshRequested(2);
    await TestBed.inject(ApplicationRef).whenStable();

    // The failed refetch belongs to the same meeting+occurrence as the last confirmed roster, so
    // it must fall back to the existing `registrants()` snapshot rather than an empty list, and
    // must not treat that fallback as a roster of length 0 that would zero out the pending pad.
    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(10);
    expect(component.additionalRegistrantsCount()).toBe(2);
    expect((component as unknown as { registrantsLoading: () => boolean }).registrantsLoading()).toBe(false);

    // A follow-up refetch that actually observes growth is the only way to prove the pad above
    // isn't just a leftover value the failure path left untouched — it must still be able to
    // converge once the query-service index catches up.
    component.onRegistrantsRefreshRequested(0);
    await TestBed.inject(ApplicationRef).whenStable();

    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(11);
    expect(component.additionalRegistrantsCount()).toBe(1);
  });

  it("falls back to an empty roster instead of leaking a previous occurrence's roster when the refetch for a newly-selected occurrence fails", async () => {
    const buildOccurrence = (occurrenceId: string, startTime: string) =>
      ({ occurrence_id: occurrenceId, start_time: startTime, duration: 60 }) as unknown as MeetingOccurrence;
    const OCCURRENCE_A = buildOccurrence('occurrence-a', FUTURE_START_TIME);
    const OCCURRENCE_B = buildOccurrence('occurrence-b', '2099-01-02T00:00:00.000Z');
    getPublicMeeting.mockReturnValue(
      of({
        meeting: buildMeeting({ recurrence: { type: 2, repeat_interval: 1 }, occurrences: [OCCURRENCE_A, OCCURRENCE_B] }),
        project: buildProject(),
      })
    );
    // The recurring meeting's `currentOccurrence` computed settles from `null` to occurrence A in a
    // separate reactive tick from `meeting` itself resolving, so setup can issue more than one
    // registrant fetch before things settle. Keep every setup-phase fetch successful and queue the
    // failure only for the deliberate occurrence switch below, so the failure lands exactly where
    // the test means it to (a fixed once/once pairing here previously let setup silently consume
    // both mocks, leaving the switch to fall through to the default `of([])` mock instead).
    getMyMeetingRegistrants.mockReturnValue(of(buildRegistrants(10)));

    const component = await createComponent();
    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toHaveLength(10);

    getMyMeetingRegistrants.mockReturnValueOnce(throwError(() => new Error('roster fetch failed')));

    // Select the second occurrence in the series — same meeting, different `occurrence_id` —
    // so a regression that dropped the occurrence segment from `buildRegistrantsRosterKey` would
    // wrongly treat this as the same confirmed roster and fall back to it instead of `[]`.
    // The meeting-fetch pipeline debounces route-param changes via a real (non-zone-tracked) RxJS
    // timer (see the meeting-switch test above), so a real macrotask tick is required to flush it.
    queryParamMap$.next(convertToParamMap({ occurrence: String(new Date(OCCURRENCE_B.start_time).getTime()) }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await TestBed.inject(ApplicationRef).whenStable();

    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toEqual([]);
  });

  // GH-2041: `meeting()` must resolve from `TransferState` at construction time (via `toSignal`'s
  // `initialValue`), not on a later emission — `debounceTime(0)` in the pipeline defers every
  // pipeline-driven emission, including a `startWith` seed, past Angular's first render pass.
  describe('TransferState seeding (GH-2041)', () => {
    it('paints synchronously from a browser TransferState seed with no blank flash', async () => {
      const transferState = TestBed.inject(TransferState);
      transferState.set(MEETING_JOIN_STATE_KEY, {
        meeting: { ...buildMeeting(), project: buildProject() },
        loadedViaPastMeetingId: false,
        pastMeetingFullAccess: false,
        meetingLoadFailed: false,
      });

      await TestBed.compileComponents();
      const fixture = TestBed.createComponent(MeetingJoinComponent);
      const component = fixture.componentInstance;

      // Assert before any stabilization — the regression this guards against only reproduces if
      // the seed lands after the first CD pass.
      expect(component.meeting()?.id).toBe(MEETING_ID);
      expect(transferState.get(MEETING_JOIN_STATE_KEY, null)).toBeNull();

      // Drive an actual CD pass and assert the DOM itself, not just the signal — a swapped
      // `@if`/`@else` branch in the template would still leave the signal assertion above green.
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-join-skeleton"]')).toBeNull();

      await TestBed.inject(ApplicationRef).whenStable();
    });

    it('restores the past-meeting branch synchronously from a seeded transfer state', async () => {
      const transferState = TestBed.inject(TransferState);
      transferState.set(MEETING_JOIN_STATE_KEY, {
        meeting: { ...buildMeeting(), project: buildProject() },
        loadedViaPastMeetingId: true,
        pastMeetingFullAccess: true,
        meetingLoadFailed: false,
      });

      await TestBed.compileComponents();
      const fixture = TestBed.createComponent(MeetingJoinComponent);
      const component = fixture.componentInstance as unknown as {
        loadedViaPastMeetingId: () => boolean;
        pastMeetingFullAccess: () => boolean;
      };

      expect(component.loadedViaPastMeetingId()).toBe(true);
      expect(component.pastMeetingFullAccess()).toBe(true);

      await TestBed.inject(ApplicationRef).whenStable();
    });

    // Bot review follow-up on PR #2046 (copilot-pull-request-reviewer, cursor): seeding `meeting()`
    // makes `initializeSeriesOccurrences()` subscribe immediately, before the debounced meeting
    // pipeline (which used to set `password`) ever runs. A password-gated recurring meeting's first
    // occurrences fetch went out with no password, and `distinctUntilChanged()` on the series uid
    // then blocked any retry once the password eventually arrived — fixed by setting `password`
    // synchronously from the route snapshot in the constructor, before `meeting` is exposed.
    it('sends the correct password on the very first series-occurrences fetch for a seeded recurring meeting', async () => {
      queryParamMap$.next(convertToParamMap({ password: 'secret' }));

      // The live refetch behind the seed must also resolve to a recurring meeting — `toObservable`
      // effects are glitch-free, so if the debounced refetch settled on a non-recurring default
      // before the effect's first flush, it would only ever see that later value and the series-uid
      // filter would never pass, masking the very race this test exists to catch.
      const recurringMeeting = buildMeeting({ recurrence: { type: 2, repeat_interval: 1 } });
      getPublicMeeting.mockReturnValue(of({ meeting: recurringMeeting, project: buildProject() }));

      const transferState = TestBed.inject(TransferState);
      transferState.set(MEETING_JOIN_STATE_KEY, {
        meeting: { ...recurringMeeting, project: buildProject() },
        loadedViaPastMeetingId: false,
        pastMeetingFullAccess: false,
        meetingLoadFailed: false,
      });

      const component = await createComponent();

      // The password must be present on THIS call — `distinctUntilChanged()` on the series uid
      // means a follow-up call for the same series never happens, so a missing password here
      // would never be retried.
      expect(getPublicMeetingOccurrences).toHaveBeenCalledTimes(1);
      expect(getPublicMeetingOccurrences).toHaveBeenCalledWith(MEETING_ID, 'secret');
      expect(component.meeting()?.id).toBe(MEETING_ID);
    });

    it('shows the skeleton on the initial render when there is no seed and the fetch has not resolved yet', async () => {
      await TestBed.compileComponents();
      const fixture = TestBed.createComponent(MeetingJoinComponent);
      fixture.detectChanges();

      // `debounceTime(0)` defers even a synchronous mocked response past this first CD pass, so
      // `meeting()` is still undefined here and the `@else` skeleton branch must be what renders.
      expect(fixture.componentInstance.meeting()).toBeUndefined();
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-join-skeleton"]')).not.toBeNull();

      await TestBed.inject(ApplicationRef).whenStable();
    });

    it('falls back to the fetched meeting when the server has not seeded anything', async () => {
      const component = await createComponent();

      // The mocked fetch resolves synchronously in this suite, so by the time `createComponent`
      // returns the real (post-fetch) meeting is already in place. The undefined-on-first-render
      // case (no seed, fetch not yet resolved) is covered separately above — this test's job is to
      // prove the value came from the fetch itself, not a stray seed leaking across tests.
      expect(getPublicMeeting).toHaveBeenCalled();
      expect(component.meeting()?.id).toBe(MEETING_ID);
    });

    it('dedupes the five past-meeting fan-out fetches on a same-resource re-emission, but still lets a materials refresh force the attachments fetch', async () => {
      const PAST_COMPOSITE_ID = '1-1700000000000';
      paramMap$.next(convertToParamMap({ id: PAST_COMPOSITE_ID }));
      getPublicPastMeeting.mockReturnValue(of({ meeting: buildMeeting(), project: buildProject(), full_access: true }));

      const component = await createComponent();

      expect(getPastMeetingSummary).toHaveBeenCalledTimes(1);
      expect(getPastMeetingSummary).toHaveBeenCalledWith(MEETING_ID);
      expect(getPastMeetingRecording).toHaveBeenCalledTimes(1);
      expect(getPastMeetingAttachments).toHaveBeenCalledTimes(1);
      expect(getPastMeetingParticipants).toHaveBeenCalledTimes(1);
      expect(getPastMeetingTranscript).toHaveBeenCalledTimes(1);

      // Re-trigger `meeting$` for the SAME resource — `map` in `initializeMeeting()` builds a new
      // object on every emission, so this reproduces the "meeting re-emits a new object for the
      // same resource on hydration refetch" case `pastMeetingResourceKey$` dedupes against.
      paramMap$.next(convertToParamMap({ id: PAST_COMPOSITE_ID }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(getPastMeetingSummary).toHaveBeenCalledTimes(1);
      expect(getPastMeetingRecording).toHaveBeenCalledTimes(1);
      expect(getPastMeetingAttachments).toHaveBeenCalledTimes(1);
      expect(getPastMeetingParticipants).toHaveBeenCalledTimes(1);
      expect(getPastMeetingTranscript).toHaveBeenCalledTimes(1);

      // A materials change still forces a refetch of attachments specifically, via the dedicated
      // `pastMeetingAttachmentsRefresh$` trigger — the dedup only suppresses re-fetches that aren't
      // asking for one, it must not swallow an explicit refresh request.
      component.onMaterialsChanged();
      await TestBed.inject(ApplicationRef).whenStable();

      expect(getPastMeetingAttachments).toHaveBeenCalledTimes(2);
      // The other four fan-out streams are gated on a one-shot `of(null)` trigger, so they must be
      // unaffected by the attachments-specific refresh subject.
      expect(getPastMeetingSummary).toHaveBeenCalledTimes(1);
      expect(getPastMeetingRecording).toHaveBeenCalledTimes(1);
      expect(getPastMeetingParticipants).toHaveBeenCalledTimes(1);
      expect(getPastMeetingTranscript).toHaveBeenCalledTimes(1);
    });

    it('persists the resolved meeting to TransferState on the server once the fetch settles', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

      await createComponent();
      await TestBed.inject(ApplicationRef).whenStable();

      const transferState = TestBed.inject(TransferState);
      const seeded = transferState.get(MEETING_JOIN_STATE_KEY, null);
      expect(seeded?.meeting?.id).toBe(MEETING_ID);
      expect(seeded?.loadedViaPastMeetingId).toBe(false);
      expect(seeded?.pastMeetingFullAccess).toBe(false);
      expect(seeded?.meetingLoadFailed).toBe(false);
    });

    // Bot review follow-up on PR #2046 (copilot-pull-request-reviewer, cursor): the terminal-error
    // branch wasn't seeded to `TransferState`, so hydration reintroduced the exact blank-flash bug
    // this PR fixes — the client started `meetingLoadFailed` at `false` and tore down the
    // SSR-rendered error view in favor of the skeleton.
    it('persists the terminal-error branch to TransferState on the server on a non-navigating fetch failure', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));

      await createComponent();
      await TestBed.inject(ApplicationRef).whenStable();

      const transferState = TestBed.inject(TransferState);
      const seeded = transferState.get(MEETING_JOIN_STATE_KEY, null);
      expect(seeded?.meeting).toBeNull();
      expect(seeded?.meetingLoadFailed).toBe(true);
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalledWith(['/meetings/not-found']);
    });

    it('paints the error branch synchronously from a seeded terminal-error transfer state, with no skeleton flash, and holds it through the hydration refetch', async () => {
      // The hydration refetch also fails, matching the seeded branch — this is what guards the
      // full GH-2041 contract: the error state must survive past the first CD pass, not just
      // appear on it and then flash to the skeleton once the debounced pipeline re-enters.
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 500 })));

      const transferState = TestBed.inject(TransferState);
      transferState.set(MEETING_JOIN_STATE_KEY, {
        meeting: null,
        loadedViaPastMeetingId: false,
        pastMeetingFullAccess: false,
        meetingLoadFailed: true,
      });

      await TestBed.compileComponents();
      const fixture = TestBed.createComponent(MeetingJoinComponent);
      const component = fixture.componentInstance;

      // Assert before any stabilization — this is exactly the race the bots flagged: the seed must
      // be applied before the first CD pass, or the skeleton renders instead of the error view.
      expect((component as unknown as { meetingLoadFailed: () => boolean }).meetingLoadFailed()).toBe(true);

      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-join-error"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-join-skeleton"]')).toBeNull();

      await TestBed.inject(ApplicationRef).whenStable();

      // Re-assert post-hydration: the debounced pipeline re-entering must not have cleared
      // `meetingLoadFailed` before the refetch settled, nor fallen through to a stale/absent
      // `meeting()` and rendered the skeleton.
      fixture.detectChanges();
      expect((component as unknown as { meetingLoadFailed: () => boolean }).meetingLoadFailed()).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-join-error"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-join-skeleton"]')).toBeNull();
    });

    it('sets meetingLoadFailed (not a not-found redirect) when the nested past-meeting fallback fails with a non-terminal status', async () => {
      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 404 })));
      getPublicPastMeeting.mockReturnValue(throwError(() => ({ status: 500 })));

      const component = await createComponent();

      expect((component as unknown as { meetingLoadFailed: () => boolean }).meetingLoadFailed()).toBe(true);
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalledWith(['/meetings/not-found']);
    });
  });
});
