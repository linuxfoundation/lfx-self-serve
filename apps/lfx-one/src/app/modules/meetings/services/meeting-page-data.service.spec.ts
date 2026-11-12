// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { Meeting, PublicMeetingProject } from '@lfx-one/shared';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingPageDataService } from './meeting-page-data.service';

@Component({ selector: 'lfx-test-meeting-page-host', template: '', providers: [MeetingPageDataService] })
class TestHostComponent {
  public readonly data = inject(MeetingPageDataService);
  public readonly meeting: Signal<(Meeting & { project: PublicMeetingProject }) | undefined> = this.data.load();
}

const project = { uid: 'p1', name: 'Project', slug: 'project' } as PublicMeetingProject;

describe('MeetingPageDataService', () => {
  let paramMap$: BehaviorSubject<ParamMap>;
  let queryParamMap$: BehaviorSubject<ParamMap>;
  let getPublicMeeting: ReturnType<typeof vi.fn>;
  let getPublicPastMeeting: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

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
});
