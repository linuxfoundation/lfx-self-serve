// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { firstValueFrom, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeFeed, ProjectMeetingsHomeFeed, provideMeetingsHomeFeed, UserMeetingsHomeFeed } from './meetings-home-feed';

describe('MeetingsHomeFeed', () => {
  let lens: ReturnType<typeof signal<string>>;
  let projectUid: ReturnType<typeof signal<string>>;
  let meetingService: { getProjectMeetingsForHome: ReturnType<typeof vi.fn>; getProjectPastMeetingsForHome: ReturnType<typeof vi.fn> };
  let userService: Record<string, unknown>;

  const inject = (): MeetingsHomeFeed => {
    TestBed.configureTestingModule({
      providers: [
        ...provideMeetingsHomeFeed(),
        { provide: LensService, useValue: { activeLens: lens } },
        { provide: ProjectContextService, useValue: { activeContextUid: projectUid } },
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
    meetingService = {
      getProjectMeetingsForHome: vi.fn(() => of([{ id: 'm-1' }])),
      getProjectPastMeetingsForHome: vi.fn(() => of({ meetings: [{ id: 'm-1:1' }], pageToken: 'next' })),
    };
    userService = {
      meetingFeedIdentity: signal('viewer'),
      meetingsRefresh$: new Subject<void>(),
      pastMeetingsRefresh$: new Subject<void>(),
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

  it('reads the active project in a project or foundation lens, keyed on viewer and project', async () => {
    const feed = inject();

    expect(feed).toBeInstanceOf(ProjectMeetingsHomeFeed);
    expect(feed.pagedPast).toBe(true);
    const key = feed.key();
    projectUid.set('project-2');
    expect(feed.key()).not.toBe(key);

    await expect(firstValueFrom(feed.upcoming())).resolves.toEqual([{ id: 'm-1' }]);
    expect(meetingService.getProjectMeetingsForHome).toHaveBeenCalledWith('project-2');
    await firstValueFrom(feed.past('weekly', 'cursor'));
    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenCalledWith('project-2', 'weekly', 'cursor');
  });

  it('reads the latest past meetings as a short first page', async () => {
    const feed = inject();

    await expect(firstValueFrom(feed.latestPast())).resolves.toEqual([{ id: 'm-1:1' }]);
    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenCalledWith('project-1', '', undefined, 5);
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
