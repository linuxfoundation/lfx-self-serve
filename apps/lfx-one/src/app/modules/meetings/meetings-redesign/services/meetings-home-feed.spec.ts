// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { MEETINGS_HOME_NO_PAST_FILTERS } from '@lfx-one/shared/constants';
import { PastMeeting } from '@lfx-one/shared/interfaces';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
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
  let meetingService: {
    getProjectMeetingsForHome: ReturnType<typeof vi.fn>;
    getProjectPastMeetingsForHome: ReturnType<typeof vi.fn>;
    getRollupFilterOptions: ReturnType<typeof vi.fn>;
  };
  let userService: Record<string, unknown>;

  const inject = (): MeetingsHomeFeed => {
    TestBed.configureTestingModule({
      providers: [
        ...provideMeetingsHomeFeed(),
        { provide: ActivatedRoute, useValue: { snapshot: { pathFromRoot: [{ data: {} }, { data: lens() === 'me' ? {} : { lens: lens() } }] } } },
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
      getRollupFilterOptions: vi.fn(() =>
        of({ projects: [], groups: [{ uid: 'c-1', name: 'TSC', category: 'Technical Steering Committee', project_uid: 'project-1' }] })
      ),
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
    await expect(firstValueFrom(feed.past('ignored', MEETINGS_HOME_NO_PAST_FILTERS, 'ignored'))).resolves.toEqual({ meetings: [{ id: 'mine:1' }] });
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
    await firstValueFrom(feed.past('weekly', MEETINGS_HOME_NO_PAST_FILTERS, 'cursor'));
    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenCalledWith('project-2', 'weekly', 'cursor', undefined, { includeSubProjects: false }, []);
  });

  it("sends a project's past filters, taking the roll-up query limited to the project for group filters", async () => {
    const feed = inject();

    await firstValueFrom(feed.past('', { ...MEETINGS_HOME_NO_PAST_FILTERS, meetingType: 'Board' }));
    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenLastCalledWith('project-1', '', undefined, undefined, { includeSubProjects: false }, [
      'meeting_type:Board',
    ]);

    await firstValueFrom(feed.past('', { ...MEETINGS_HOME_NO_PAST_FILTERS, committeeUid: 'c-1', groupType: 'Working Group' }, 'cursor'));
    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenLastCalledWith(
      'project-1',
      '',
      'cursor',
      undefined,
      { includeSubProjects: true, rootOnly: true, committeeUid: 'c-1', groupType: 'Working Group' },
      []
    );
  });

  it("sends a foundation's past filters on its roll-up, narrowed to the picked project", async () => {
    foundation.set(true);
    const feed = inject();

    await firstValueFrom(feed.past('', { projectUid: 'project-3', committeeUid: 'c-1', groupType: null, meetingType: null }));

    expect(meetingService.getProjectPastMeetingsForHome).toHaveBeenLastCalledWith(
      'project-1',
      '',
      undefined,
      undefined,
      { includeSubProjects: true, projectUids: ['project-3'], committeeUid: 'c-1', groupType: null },
      []
    );
  });

  it('reads the groups in scope from the roll-up filter options, and none in the Me lens', async () => {
    await expect(firstValueFrom(inject().groups())).resolves.toEqual([
      { uid: 'c-1', name: 'TSC', category: 'Technical Steering Committee', project_uid: 'project-1' },
    ]);
    expect(meetingService.getRollupFilterOptions).toHaveBeenCalledWith('project-1');

    TestBed.resetTestingModule();
    lens.set('me');
    await expect(firstValueFrom(inject().groups())).resolves.toEqual([]);
  });

  it('includes sub-projects for a foundation', async () => {
    foundation.set(true);
    const feed = inject();

    await firstValueFrom(feed.upcoming());

    expect(meetingService.getProjectMeetingsForHome).toHaveBeenCalledWith('project-1', { includeSubProjects: true });
  });

  it('leaves meetings still running out of the past feed', async () => {
    const feed = inject();

    await expect(firstValueFrom(feed.past('', MEETINGS_HOME_NO_PAST_FILTERS))).resolves.toEqual({ meetings: [ended('m-1:1')], pageToken: 'next' });
  });

  it('reloads the upcoming meetings on refresh', () => {
    const feed = inject();
    const upcoming = vi.fn();
    feed.upcoming().subscribe(upcoming);

    upcomingRefresh$.next();

    expect(upcoming).toHaveBeenCalledTimes(2);
  });

  it('loads no latest past meetings, which the project lens does not show', async () => {
    const feed = inject();

    await expect(firstValueFrom(feed.latestPast())).resolves.toEqual([]);
    expect(meetingService.getProjectPastMeetingsForHome).not.toHaveBeenCalled();
  });

  it('falls back to start plus duration for the end, and drops rows whose end cannot be read', async () => {
    const byDuration = { id: 'by-duration', start_time: '2026-01-01T10:00:00Z', duration: 60 } as unknown as PastMeeting;
    const runningByDuration = { id: 'running', start_time: new Date(Date.now() - 60_000).toISOString(), duration: 60 } as unknown as PastMeeting;
    const unreadable = { id: 'unreadable', start_time: 'not a date' } as unknown as PastMeeting;
    meetingService.getProjectPastMeetingsForHome.mockReturnValue(of({ meetings: [byDuration, runningByDuration, unreadable] }));
    const feed = inject();

    await expect(firstValueFrom(feed.past('', MEETINGS_HOME_NO_PAST_FILTERS))).resolves.toEqual({ meetings: [byDuration] });
  });

  it('loads nothing until a project is active', async () => {
    projectUid.set('');
    const feed = inject();

    await expect(firstValueFrom(feed.upcoming())).resolves.toEqual([]);
    await expect(firstValueFrom(feed.past('', MEETINGS_HOME_NO_PAST_FILTERS))).resolves.toEqual({ meetings: [] });
    await expect(firstValueFrom(feed.groups())).resolves.toEqual([]);
    await expect(firstValueFrom(feed.latestPast())).resolves.toEqual([]);
    expect(meetingService.getProjectMeetingsForHome).not.toHaveBeenCalled();
  });
});
