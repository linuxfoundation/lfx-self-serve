// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { Meeting, MeetingRegistrant, PublicMeetingProject, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { PlausibleService } from '@services/plausible.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingJoinComponent } from './meeting-join.component';

// Regression coverage for GH-1731's guest-add orchestration: the join page maintains an optimistic
// pad of guest-add counts (onRegistrantsRefreshRequested) that reconcileOptimisticPad reconciles
// against the roster refetch, and a `registrantsMeetingKey` guard that prevents a failed refetch
// from leaking a previous meeting's roster into a newly-navigated meeting. Both were fixed during
// PR #1748 review: a null baseline no longer gets treated as "absorbed" (dealako's ask).
describe('MeetingJoinComponent', () => {
  const MEETING_ID = 'meeting-1';
  const FUTURE_START_TIME = '2099-01-01T00:00:00.000Z';

  let getPublicMeeting: ReturnType<typeof vi.fn>;
  let getMyMeetingRegistrants: ReturnType<typeof vi.fn>;
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
    registrantUidCounter = 0;
    authenticated = signal(true);
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: MEETING_ID }));
    queryParamMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));

    getPublicMeeting = vi.fn().mockReturnValue(of({ meeting: buildMeeting(), project: buildProject() }));
    getMyMeetingRegistrants = vi.fn().mockReturnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
            snapshot: { paramMap: paramMap$.value, queryParamMap: queryParamMap$.value },
          },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: MeetingService,
          useValue: {
            getPublicMeeting,
            getPublicPastMeeting: vi.fn().mockReturnValue(throwError(() => ({ status: 404 }))),
            getPublicMeetingOccurrences: vi.fn().mockReturnValue(of({ past: [], future: [] })),
            getPublicMeetingJoinUrl: vi.fn().mockReturnValue(of({ link: undefined })),
            getMyMeetingRegistrants,
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRsvpForCurrentUser: vi.fn().mockReturnValue(of(null)),
          },
        },
        { provide: UserService, useValue: { authenticated, user: signal<User | null>({ email: 'me@example.com' } as unknown as User) } },
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

    paramMap$.next(convertToParamMap({ id: MEETING_ID_2 }));
    await TestBed.inject(ApplicationRef).whenStable();

    expect((component as unknown as { registrants: () => MeetingRegistrant[] }).registrants()).toEqual([]);
  });
});
