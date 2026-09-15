// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import type { Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsDashboardComponent } from './meetings-dashboard.component';

/**
 * Covers the one wire between the composer and this list: the composer saves in place instead of
 * navigating, so a create/edit only reaches the organizer's list if `saveCount` refetches it. The
 * host spec proves the counter moves; this proves the dashboard acts on it — and that the `skip(1)`
 * guarding the replayed value keeps a later mount from double-fetching everything.
 *
 * The component is instantiated directly rather than rendered: the assertions are all about the
 * constructor's stream wiring, and the template pulls in FullCalendar and the whole card stack.
 */
describe('MeetingsDashboardComponent', () => {
  let composer: MeetingComposerService;
  let getUserMeetings: ReturnType<typeof vi.fn>;
  let clearPastMeetingRecordingCache: ReturnType<typeof vi.fn>;

  const meeting = { uid: 'meeting-1', title: 'Weekly sync', start_time: '2099-01-01T10:00:00Z', duration: 60 } as unknown as Meeting;

  /** `toObservable` bridges emit on effect flush, so every signal write needs one. */
  const flush = (): void => TestBed.tick();

  const createComponent = (): MeetingsDashboardComponent => TestBed.runInInjectionContext(() => new MeetingsDashboardComponent());

  beforeEach(() => {
    getUserMeetings = vi.fn(() => of([meeting]));
    clearPastMeetingRecordingCache = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerService,
        {
          provide: MeetingService,
          useValue: {
            clearPastMeetingRecordingCache,
            getPastMeetingRecording: vi.fn(() => of(null)),
            getMeetingsByProjectPaginated: vi.fn(() => of({ meetings: [], pagination: {} })),
            getPastMeetingsByProjectPaginated: vi.fn(() => of({ meetings: [], pagination: {} })),
            getMeetingsCountByProject: vi.fn(() => of(0)),
            getPastMeetingsCountByProject: vi.fn(() => of(0)),
          },
        },
        {
          provide: UserService,
          useValue: {
            viewerUsername: signal<string | null>('viewer'),
            getUserMeetings,
            getUserPastMeetings: vi.fn(() => of([] as PastMeeting[])),
          },
        },
        { provide: LensService, useValue: { activeLens: signal('me') } },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal(null), canWrite: signal(true), canWriteMeetings: signal(true) },
        },
        {
          provide: PersonaService,
          useValue: { personaLoaded: signal(true), hasBoardRole: signal(false), hasProjectRole: signal(false) },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });

    composer = TestBed.inject(MeetingComposerService);
  });

  it('refetches the list when the composer reports a save', () => {
    createComponent();
    flush();

    expect(getUserMeetings).toHaveBeenCalledTimes(1);

    composer.notifySaved();
    flush();

    // The new meeting is only in the list if the dashboard went back to the API for it.
    expect(getUserMeetings).toHaveBeenCalledTimes(2);
    // Past-meeting recordings are cached per uid, so a save has to drop them too.
    expect(clearPastMeetingRecordingCache).toHaveBeenCalled();
  });

  it('refetches once per save, not once per subscriber', () => {
    createComponent();
    flush();

    composer.notifySaved();
    composer.notifySaved();
    flush();

    expect(getUserMeetings).toHaveBeenCalledTimes(2);
  });

  it('ignores a save that happened before it mounted', () => {
    // `saveCount` lives in a root service and is monotonic, so a dashboard mounted after an earlier
    // save sees a non-zero count replayed on subscribe. Acting on it would double every request the
    // initial fetch just made.
    composer.notifySaved();

    createComponent();
    flush();

    expect(getUserMeetings).toHaveBeenCalledTimes(1);
    expect(clearPastMeetingRecordingCache).not.toHaveBeenCalled();
  });
});
