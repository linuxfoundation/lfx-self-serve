// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyMeetingsComponent } from './my-meetings.component';

import type { Lens, Meeting, PastMeeting, ProjectContext } from '@lfx-one/shared/interfaces';

/**
 * Covers the error/retry states added for GH-4780: a fetch failure must render the
 * "couldn't load" card with a working Retry control, not the same empty-state card a
 * genuinely-meeting-less user sees, and the copy must not claim "your" meetings outside
 * the Me lens.
 */
describe('MyMeetingsComponent', () => {
  let fixture: ComponentFixture<MyMeetingsComponent>;
  const activeLens = signal<Lens>('me');
  const activeContext = signal<ProjectContext | null>(null);
  let getUserMeetings: ReturnType<typeof vi.fn>;
  let getUserLatestPastMeetings: ReturnType<typeof vi.fn>;
  let getUpcomingMeetingsByProject: ReturnType<typeof vi.fn>;
  let getPastMeetingsByProject: ReturnType<typeof vi.fn>;

  const testId = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const retry = (id: string): void => testId(id)?.click();

  beforeEach(async () => {
    activeLens.set('me');
    activeContext.set(null);
    getUserMeetings = vi.fn().mockReturnValue(of([]));
    getUserLatestPastMeetings = vi.fn().mockReturnValue(of([]));
    getUpcomingMeetingsByProject = vi.fn().mockReturnValue(of([]));
    getPastMeetingsByProject = vi.fn().mockReturnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LensService, useValue: { activeLens } },
        { provide: ProjectContextService, useValue: { activeContext } },
        {
          provide: UserService,
          useValue: {
            getUserMeetings,
            getUserLatestPastMeetings,
            user: signal(null),
            meetingJoinIdentity: signal(null),
            authenticated: signal(false),
          },
        },
        {
          provide: MeetingService,
          useValue: {
            getUpcomingMeetingsByProject,
            getPastMeetingsByProject,
            getPublicMeetingJoinUrl: vi.fn(() => of(null)),
            removedRegistrationMeetingIds: signal<ReadonlySet<string>>(new Set()),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    fixture = TestBed.createComponent(MyMeetingsComponent);
    await fixture.whenStable();
  });

  it('shows the error card, not the empty state, when the upcoming-meetings fetch fails', async () => {
    getUserMeetings.mockReturnValue(throwError(() => new Error('fga-sync unavailable')));
    fixture = TestBed.createComponent(MyMeetingsComponent);
    await fixture.whenStable();

    expect(testId('dashboard-next-meeting-error')).not.toBeNull();
    expect(testId('dashboard-next-meeting-empty')).toBeNull();
  });

  it('shows the error card, not the empty state, when the past-meetings fetch fails', async () => {
    getUserLatestPastMeetings.mockReturnValue(throwError(() => new Error('fga-sync unavailable')));
    fixture = TestBed.createComponent(MyMeetingsComponent);
    await fixture.whenStable();

    expect(testId('dashboard-last-meeting-error')).not.toBeNull();
    expect(testId('dashboard-last-meeting-empty')).toBeNull();
  });

  it('clears the upcoming error and shows real data after Retry succeeds', async () => {
    getUserMeetings.mockReturnValueOnce(throwError(() => new Error('fga-sync unavailable')));
    fixture = TestBed.createComponent(MyMeetingsComponent);
    await fixture.whenStable();
    expect(testId('dashboard-next-meeting-error')).not.toBeNull();

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    getUserMeetings.mockReturnValue(of([{ id: 'm1', title: 'Weekly sync', start_time: future, duration: 30 } as Meeting]));
    retry('dashboard-next-meeting-retry');
    await fixture.whenStable();

    // 1 call from beforeEach's initial fixture + 1 for this test's failing fixture + 1 from Retry.
    expect(getUserMeetings).toHaveBeenCalledTimes(3);
    expect(testId('dashboard-next-meeting-error')).toBeNull();
    expect(testId('dashboard-next-meeting-empty')).toBeNull();
  });

  it('clears the past error and shows the empty state after Retry succeeds with no meetings', async () => {
    getUserLatestPastMeetings.mockReturnValueOnce(throwError(() => new Error('fga-sync unavailable')));
    fixture = TestBed.createComponent(MyMeetingsComponent);
    await fixture.whenStable();
    expect(testId('dashboard-last-meeting-error')).not.toBeNull();

    getUserLatestPastMeetings.mockReturnValue(of([] as PastMeeting[]));
    retry('dashboard-last-meeting-retry');
    await fixture.whenStable();

    // 1 call from beforeEach's initial fixture + 1 for this test's failing fixture + 1 from Retry.
    expect(getUserLatestPastMeetings).toHaveBeenCalledTimes(3);
    expect(testId('dashboard-last-meeting-error')).toBeNull();
    expect(testId('dashboard-last-meeting-empty')).not.toBeNull();
  });

  it('clears a stuck error when the lens changes away and back', async () => {
    getUserMeetings.mockReturnValueOnce(throwError(() => new Error('fga-sync unavailable')));
    fixture = TestBed.createComponent(MyMeetingsComponent);
    await fixture.whenStable();
    expect(testId('dashboard-next-meeting-error')).not.toBeNull();

    getUserMeetings.mockReturnValue(of([]));
    activeLens.set('org');
    await fixture.whenStable();
    activeLens.set('me');
    await fixture.whenStable();

    expect(testId('dashboard-next-meeting-error')).toBeNull();
    expect(testId('dashboard-next-meeting-empty')).not.toBeNull();
  });

  it('does not say "your" meetings when the failed fetch is for a project, not the viewer', async () => {
    activeLens.set('project');
    activeContext.set({ uid: 'project-1' } as ProjectContext);
    getUpcomingMeetingsByProject.mockReturnValue(throwError(() => new Error('fga-sync unavailable')));
    fixture = TestBed.createComponent(MyMeetingsComponent);
    await fixture.whenStable();

    expect(testId('dashboard-next-meeting-error')?.textContent).toContain("Couldn't load upcoming meetings");
    expect(testId('dashboard-next-meeting-error')?.textContent).not.toContain('your');
  });
});
