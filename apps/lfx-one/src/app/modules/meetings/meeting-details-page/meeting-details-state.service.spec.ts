// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { MEETING_JOIN_STATE_KEY } from '@lfx-one/shared/constants';
import { Meeting, MeetingJoinPageState, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  });

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

    it('passes the ?password= param to the lookup', async () => {
      queryParamMap$.next(convertToParamMap({ password: 'secret' }));
      create();

      await settle();

      expect(getPublicMeeting).toHaveBeenCalledWith(MEETING_ID, 'secret');
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

    it('shows the error branch, not the previous meeting, when the new lookup fails', async () => {
      const state = create();
      await settle();

      getPublicMeeting.mockReturnValue(throwError(() => ({ status: 502 })));
      paramMap$.next(convertToParamMap({ id: 'meeting-2' }));
      await settle();

      expect(state.status()).toBe('error');
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
