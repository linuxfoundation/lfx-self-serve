// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MEETING_GROUP_MEETINGS_LIMIT } from '@lfx-one/shared/constants';
import { MeetingGroupMeetingsState, PublicCalendarMeeting, PublicGroupSummary } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingGroupMeetingsService } from './meeting-group-meetings.service';

const PROJECT = 'cncf';
const GROUP_UID = '11111111-1111-4111-8111-111111111111';
const OTHER_GROUP_UID = '22222222-2222-4222-8222-222222222222';
const HIDDEN_GROUP_UID = '33333333-3333-4333-8333-333333333333';

function group(uid: string, name: string): PublicGroupSummary {
  return {
    uid,
    name,
    category: 'Working Group',
    behavioral_class: 'working-group',
    context: { scope: 'project', foundation_uid: 'f', foundation_name: 'Foundation', foundation_slug: 'foundation' },
  };
}

function feedRow(id: string, startTime: string): PublicCalendarMeeting {
  return { id, title: `Meeting ${id}`, start_time: startTime, duration: 60, timezone: 'UTC', committee_uids: [GROUP_UID] };
}

describe('MeetingGroupMeetingsService', () => {
  let service: MeetingGroupMeetingsService;
  let http: HttpTestingController;
  let states: MeetingGroupMeetingsState[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MeetingGroupMeetingsService);
    http = TestBed.inject(HttpTestingController);
    states = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function fetch(committeeUids: string[], currentMeetingUid = 'current'): void {
    service.fetch(PROJECT, committeeUids, currentMeetingUid).subscribe((state) => states.push(state));
  }

  function answerDirectory(groups: PublicGroupSummary[]): void {
    http.expectOne(`/public/api/projects/${PROJECT}/groups`).flush({ groups, total: groups.length });
  }

  function answerFeed(committeeUid: string, meetings: PublicCalendarMeeting[]): void {
    const req = http.expectOne((r) => r.url === `/public/api/projects/${PROJECT}/meetings`);
    expect(req.request.params.get('committee')).toBe(committeeUid);
    req.flush({ meetings, total: meetings.length, project: { uid: 'project-uid', name: 'CNCF' } });
  }

  it('reads the existing public feed, scoped to the group, and names the group from the directory', () => {
    fetch([GROUP_UID]);
    answerDirectory([group(GROUP_UID, 'Technical Oversight Committee')]);
    answerFeed(GROUP_UID, [feedRow('other', '2026-10-22T15:00:00Z')]);

    expect(states.map((state) => state.status)).toEqual(['loading', 'ready']);
    const ready = states.at(-1)!;
    expect(ready.group?.name).toBe('Technical Oversight Committee');
    expect(ready.meetings).toEqual([{ meetingId: 'other', title: 'Meeting other', startTime: '2026-10-22T15:00:00Z', durationMinutes: 60, timezone: 'UTC' }]);
    expect(ready.hasMore).toBe(false);
  });

  it('excludes the current meeting', () => {
    fetch([GROUP_UID], 'current');
    answerDirectory([group(GROUP_UID, 'TOC')]);
    answerFeed(GROUP_UID, [feedRow('current', '2026-10-21T15:00:00Z'), feedRow('other', '2026-10-22T15:00:00Z')]);

    expect(states.at(-1)!.meetings.map((item) => item.meetingId)).toEqual(['other']);
  });

  it(`bounds the list to ${MEETING_GROUP_MEETINGS_LIMIT} entries, soonest first, and says there are more`, () => {
    fetch([GROUP_UID]);
    answerDirectory([group(GROUP_UID, 'TOC')]);
    const rows = Array.from({ length: MEETING_GROUP_MEETINGS_LIMIT + 2 }, (_, i) => feedRow(`m${i}`, `2026-11-${String(10 - i).padStart(2, '0')}T15:00:00Z`));
    answerFeed(GROUP_UID, rows);

    const ready = states.at(-1)!;
    expect(ready.meetings).toHaveLength(MEETING_GROUP_MEETINGS_LIMIT);
    expect(ready.meetings[0].meetingId).toBe(`m${MEETING_GROUP_MEETINGS_LIMIT + 1}`);
    expect(ready.hasMore).toBe(true);
  });

  it('addresses the first of the meeting’s committees that the public directory lists', () => {
    fetch([HIDDEN_GROUP_UID, OTHER_GROUP_UID, GROUP_UID]);
    answerDirectory([group(GROUP_UID, 'TOC'), group(OTHER_GROUP_UID, 'Security')]);
    answerFeed(OTHER_GROUP_UID, []);

    const ready = states.at(-1)!;
    expect(ready.status).toBe('ready');
    expect(ready.group?.uid).toBe(OTHER_GROUP_UID);
    expect(ready.meetings).toEqual([]);
  });

  it('never asks the feed about a committee the public directory does not list', () => {
    fetch([HIDDEN_GROUP_UID]);
    answerDirectory([group(GROUP_UID, 'TOC')]);

    http.expectNone((r) => r.url.endsWith('/meetings'));
    expect(states.at(-1)).toEqual({ status: 'none', group: null, meetings: [], hasMore: false });
  });

  it('makes no request for a meeting without committees, or with only malformed uids', () => {
    fetch([]);
    fetch(['not-a-uuid']);

    http.expectNone(() => true);
    expect(states).toEqual([
      { status: 'none', group: null, meetings: [], hasMore: false },
      { status: 'none', group: null, meetings: [], hasMore: false },
    ]);
  });

  it('only calls the anonymous public routes, which serve PUBLIC meetings only', () => {
    // Private meetings never reach this service: the feed filters them server-side for every caller
    // (asserted in project.controller.spec.ts). This pins that the service reads that feed and no
    // authenticated route that could return them.
    fetch([GROUP_UID]);
    const directory = http.expectOne(() => true);
    expect(directory.request.url.startsWith('/public/api/')).toBe(true);
    directory.flush({ groups: [group(GROUP_UID, 'TOC')], total: 1 });
    const feed = http.expectOne(() => true);
    expect(feed.request.url.startsWith('/public/api/')).toBe(true);
    expect(feed.request.headers.has('Authorization')).toBe(false);
    feed.flush({ meetings: [], total: 0, project: { uid: 'project-uid', name: 'CNCF' } });
  });

  it('is an error when the directory cannot be read', () => {
    fetch([GROUP_UID]);
    http.expectOne(`/public/api/projects/${PROJECT}/groups`).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(states.at(-1)).toEqual({ status: 'error', group: null, meetings: [], hasMore: false });
  });

  it('is an error when the feed cannot be read', () => {
    fetch([GROUP_UID]);
    answerDirectory([group(GROUP_UID, 'TOC')]);
    http.expectOne((r) => r.url === `/public/api/projects/${PROJECT}/meetings`).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(states.at(-1)).toEqual({ status: 'error', group: null, meetings: [], hasMore: false });
  });
});
