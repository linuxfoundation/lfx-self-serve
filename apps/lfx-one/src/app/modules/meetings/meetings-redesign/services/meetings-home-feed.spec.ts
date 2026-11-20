// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { PastMeeting } from '@lfx-one/shared/interfaces';
import { TestBed } from '@angular/core/testing';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { firstValueFrom, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeFeed, ProjectMeetingsHomeFeed, provideMeetingsHomeFeed, UserMeetingsHomeFeed } from './meetings-home-feed';

const ended = (id: string): PastMeeting => ({ id, scheduled_start_time: '2026-01-01T10:00:00Z', scheduled_end_time: '2026-01-01T11:00:00Z' }) as PastMeeting;
const running = (id: string): PastMeeting =>
  ({
    id,
    scheduled_start_time: new Date(Date.now() - 60_000).toISOString(),
    scheduled_end_time: new Date(Date.now() + 3_600_000).toISOString(),
  }) as PastMeeting;

describe('MeetingsHomeFeed', () => {
  let lens: ReturnType<typeof signal<string>>;
  let projectUid: ReturnType<typeof signal<string>>;
  let foundation: ReturnType<typeof signal<boolean>>;
  let pastRefresh$: Subject<void>;
  let upcomingRefresh$: Subject<void>;
  let meetingService: { getProjectMeetingsForHome: ReturnType<typeof vi.fn>; getProjectPastMeetingsForHome: ReturnType<typeof vi.fn> };
  let userService: Record<string, unknown>;

  const inject = (): MeetingsHomeFeed => {
    TestBed.configureTestingModule({
      providers: [
        ...provideMeetingsHomeFeed(),
        { provide: LensService, useValue: { activeLens: lens } },
        { provide: ProjectContextService, useValue: { activeContextUid: projectUid, isFoundationContext: foundation } },
        { provide: MeetingService, useValue: meetingService },
        { provide: UserService, useValue: userService },
      ],
    });
    return TestBed.inject(MeetingsHomeFeed);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    lens = signal('project');
    projectUid = signal('project-1');
    foundation = signal(false);
    pastRefresh$ = new Subject<void>();
    upcomingRefresh$ = new Subject<void>();
    meetingService = {
      getProjectMeetingsForHome: vi.fn(() => of([{ id: 'm-1' }])),
      getProjectPastMeetingsForHome: vi.fn(() => of({ meetings: [ended('m-1:1'), running('m-2:1')], pageToken: 'next' })),
    };
    userService = {
      meetingFeedIdentity: signal('viewer'),
      meetingsRefresh$: upcomingRefresh$,
      pastMeetingsRefresh$: pastRefresh$,
      getUserMeetings: vi.fn(() => of([{ id: 'mine' }])),
      getUserPastMeetings: vi.fn(() => of([{ id: 'mine:1' }])),
      getUserLatestPastMeetings: vi.fn(() => of([])),
    };
  });

  it('reads the viewer meetings, whole, in the Me lens', async () => {
    lens.set('me');
    const feed = inject();

    expect(feed).toBeInstanceOf(UserMeetingsHomeFeed);
    expect(feed.pagedPast).toBe(false);
    await expect(firstValueFrom(feed.past('ignored', 'ignored'))).resolves.toEqual({ meetings: [{ id: 'mine:1' }] });
    expect(userService['getUserPastMeetings']).toHaveBeenCalledWith({ includeArtifactsAndAttendance: true });
  });

  it('reads only the active project in a project lens, keyed on viewer and project', async () => {
    const feed = inject();

    expect(feed).toBeInstanceOf(ProjectMeetingsHomeFeed);
    expect(feed.pagedPast).toBe(true);
    const key = feed.key();
    projectUid.set('project-2');
    expect(feed.key()).not.toBe(key);

    await expect(firstValueFrom(feed.upcoming())).resolves.toEqual([{ id: 'm-1' }]);
    expect(meetingService.getProjectMeetingsForHome).toHaveBeenCalledWith('project-2', { includeSubProjects: false });
    await firstValueFrom(feed.past('weekly', 'cursor'));
    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenCalledWith('project-2', 'weekly', 'cursor', undefined, { includeSubProjects: false });
  });

  it('includes sub-projects for a foundation', async () => {
    foundation.set(true);
    const feed = inject();

    await firstValueFrom(feed.upcoming());

    expect(meetingService.getProjectMeetingsForHome).toHaveBeenCalledWith('project-1', { includeSubProjects: true });
  });

  it('leaves meetings still running out of the past feed and the latest past meetings', async () => {
    const feed = inject();

    await expect(firstValueFrom(feed.past(''))).resolves.toEqual({ meetings: [ended('m-1:1')], pageToken: 'next' });
    await expect(firstValueFrom(feed.latestPast())).resolves.toEqual([ended('m-1:1')]);
    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenLastCalledWith('project-1', '', undefined, 10, { includeSubProjects: false });
  });

  it('reloads the upcoming and latest past meetings on refresh', () => {
    const feed = inject();
    const upcoming = vi.fn();
    const latest = vi.fn();
    feed.upcoming().subscribe(upcoming);
    feed.latestPast().subscribe(latest);

    upcomingRefresh$.next();
    pastRefresh$.next();

    expect(upcoming).toHaveBeenCalledTimes(2);
    expect(latest).toHaveBeenCalledTimes(2);
  });

  it('falls back to start plus duration for the end, and drops rows whose end cannot be read', async () => {
    const byDuration = { id: 'by-duration', start_time: '2026-01-01T10:00:00Z', duration: 60 } as unknown as PastMeeting;
    const runningByDuration = { id: 'running', start_time: new Date(Date.now() - 60_000).toISOString(), duration: 60 } as unknown as PastMeeting;
    const unreadable = { id: 'unreadable', start_time: 'not a date' } as unknown as PastMeeting;
    meetingService.getProjectPastMeetingsForHome.mockReturnValue(of({ meetings: [byDuration, runningByDuration, unreadable] }));
    const feed = inject();

    await expect(firstValueFrom(feed.past(''))).resolves.toEqual({ meetings: [byDuration] });
  });

  it('loads nothing until a project is active', async () => {
    projectUid.set('');
    const feed = inject();

    await expect(firstValueFrom(feed.upcoming())).resolves.toEqual([]);
    await expect(firstValueFrom(feed.past(''))).resolves.toEqual({ meetings: [] });
    await expect(firstValueFrom(feed.latestPast())).resolves.toEqual([]);
    expect(meetingService.getProjectMeetingsForHome).not.toHaveBeenCalled();
  });
});
