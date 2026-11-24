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

  describe('upcoming meetings pager', () => {
    const meetingIn = (id: string, hours: number): Meeting =>
      ({ id, title: `Synthetic ${id}`, start_time: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(), duration: 30 }) as Meeting;
    const position = (): string => (testId('dashboard-meeting-card-pager-position')?.textContent ?? '').trim();
    const click = async (kind: 'previous' | 'next'): Promise<void> => {
      testId(`dashboard-meeting-card-pager-${kind}`)?.click();
      await fixture.whenStable();
    };
    const open = async (meetings: Meeting[]): Promise<void> => {
      getUserMeetings.mockReturnValue(of(meetings));
      fixture = TestBed.createComponent(MyMeetingsComponent);
      await fixture.whenStable();
    };
    const text = (): string => fixture.nativeElement.textContent ?? '';

    it('opens on the next meeting and steps forward and back in place', async () => {
      await open([meetingIn('m1', 2), meetingIn('m2', 3), meetingIn('m3', 4)]);
      expect(position()).toBe('1 of 3');
      expect(text()).toContain('Synthetic m1');
      expect(text()).toContain('NEXT MEETING');

      await click('next');
      expect(position()).toBe('2 of 3');
      expect(text()).toContain('Synthetic m2');
      expect(text()).not.toContain('Synthetic m1');

      await click('previous');
      expect(position()).toBe('1 of 3');
      expect(text()).toContain('Synthetic m1');
    });

    it('labels a later meeting "UPCOMING MEETING", not "NEXT MEETING"', async () => {
      await open([meetingIn('m1', 2), meetingIn('m2', 3)]);

      await click('next');

      expect(text()).toContain('UPCOMING MEETING');
      expect(text()).not.toContain('NEXT MEETING');
    });

    it('stops at both ends instead of wrapping', async () => {
      await open([meetingIn('m1', 2), meetingIn('m2', 3)]);
      expect(testId('dashboard-meeting-card-pager-previous')?.getAttribute('aria-disabled')).toBe('true');

      await click('next');

      expect(testId('dashboard-meeting-card-pager-next')?.getAttribute('aria-disabled')).toBe('true');
      await click('next');
      expect(position()).toBe('2 of 2');
    });

    it('offers no pager for a single upcoming meeting', async () => {
      await open([meetingIn('m1', 2)]);

      expect(testId('dashboard-meeting-card-pager')).toBeNull();
    });

    it('pages through at most five meetings', async () => {
      await open(Array.from({ length: 7 }, (_, index) => meetingIn(`m${index + 1}`, index + 2)));

      expect(position()).toBe('1 of 5');
    });

    it('starts again from the next meeting after the project changes', async () => {
      await open([meetingIn('m1', 2), meetingIn('m2', 3), meetingIn('m3', 4)]);
      await click('next');
      expect(position()).toBe('2 of 3');

      activeContext.set({ uid: 'project-2' } as ProjectContext);
      await fixture.whenStable();

      expect(position()).toBe('1 of 3');
    });

    it('starts again from the next meeting after Retry reloads the list', async () => {
      await open([meetingIn('m1', 2), meetingIn('m2', 3), meetingIn('m3', 4)]);
      await click('next');
      expect(position()).toBe('2 of 3');

      fixture.componentInstance['retryUpcoming']();
      await fixture.whenStable();

      expect(position()).toBe('1 of 3');
    });

    it('starts again from the next meeting after the lens changes away and back', async () => {
      await open([meetingIn('m1', 2), meetingIn('m2', 3), meetingIn('m3', 4)]);
      await click('next');
      expect(position()).toBe('2 of 3');

      activeLens.set('org');
      await fixture.whenStable();
      activeLens.set('me');
      await fixture.whenStable();

      expect(position()).toBe('1 of 3');
    });
  });

  describe('card order', () => {
    it('puts the next meeting before the last meeting in the DOM, so stacked and side-by-side layouts agree', () => {
      const next = testId('dashboard-next-meeting-column');
      const last = testId('dashboard-last-meeting-column');

      expect(next).not.toBeNull();
      expect(last).not.toBeNull();
      expect(next!.compareDocumentPosition(last!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('does not reorder either column with order utilities, which would split tab order from what is on screen', () => {
      expect(testId('dashboard-next-meeting-column')?.className).not.toMatch(/\border-\d/);
      expect(testId('dashboard-last-meeting-column')?.className).not.toMatch(/\border-\d/);
    });
  });
});
