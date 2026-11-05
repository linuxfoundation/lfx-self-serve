// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The shared utils barrel pulls in Angular modules that need the JIT compiler in this Node suite.
import '@angular/compiler';

import type { Meeting, MeetingRegistrant, MeetingRsvp, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyRequest, getJson, setJson, getEffectiveUsername, dedupe } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getJson: vi.fn(),
  setJson: vi.fn(),
  getEffectiveUsername: vi.fn(),
  dedupe: vi.fn((rows: unknown[]) => rows),
}));

vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: class {
    public dedupePastMeetingParticipants = dedupe;
  },
}));
vi.mock('../services/valkey.service', () => ({
  buildUserCacheKey: (namespace: string, username: string) => `${namespace}:${username}`,
  valkeyService: { getJson, setJson },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn() } }));
// One page per query keeps the walk out of these tests.
vi.mock('./query-service.helper', () => ({
  fetchAllQueryResources: async (_req: unknown, fetchPage: () => Promise<{ resources: { data: unknown }[] }>) =>
    (await fetchPage()).resources.map((resource) => resource.data),
}));

import { attachMeetingRsvpSummaries, attachPastMeetingAttendanceSummaries } from './meeting-attendance.helper';

const req = {} as Request;
const NOW = new Date('2026-11-04T12:00:00Z');
const OCC_1 = String(Date.parse('2026-11-10T15:00:00Z') / 1000);
const OCC_2 = String(Date.parse('2026-11-17T15:00:00Z') / 1000);

const meeting = (id: string, extra: Partial<Meeting> = {}): Meeting =>
  ({
    id,
    title: id,
    start_time: '2026-11-10T15:00:00Z',
    duration: 30,
    organizer: true,
    is_invite_responses_enabled: true,
    occurrences: [],
    ...extra,
  }) as unknown as Meeting;

const series = (id: string): Meeting =>
  meeting(id, {
    recurrence: { type: 2, repeat_interval: 1 },
    occurrences: [
      { occurrence_id: OCC_1, start_time: '2026-11-10T15:00:00Z', duration: 30 },
      { occurrence_id: OCC_2, start_time: '2026-11-17T15:00:00Z', duration: 30 },
    ],
  } as Partial<Meeting>);

const registrant = (uid: string, meetingId: string): MeetingRegistrant => ({ uid, meeting_id: meetingId }) as MeetingRegistrant;

const rsvp = (registrantId: string, meetingId: string, extra: Partial<MeetingRsvp>): MeetingRsvp =>
  ({ id: `${registrantId}-${extra.modified_at}`, registrant_id: registrantId, meeting_id: meetingId, scope: 'all', ...extra }) as MeetingRsvp;

/** Routes query-service calls by resource type to the given rows, filtered to the requested meetings. */
function serveRows(rows: { registrants?: MeetingRegistrant[]; rsvps?: MeetingRsvp[]; participants?: PastMeetingParticipant[] }): void {
  proxyRequest.mockImplementation(async (_req: unknown, _svc: string, _path: string, _method: string, query: Record<string, any>) => {
    if (query['type'] === 'v1_meeting_registrant') {
      const ids = (query['filters_or'] as string[]).map((clause) => clause.replace('meeting_id:', ''));
      return { resources: (rows.registrants ?? []).filter((row) => ids.includes(row.meeting_id)).map((data) => ({ data })) };
    }
    if (query['type'] === 'v1_meeting_rsvp') {
      const ids = (query['tags'] as string[]).map((tag) => tag.replace('meeting_id:', ''));
      return { resources: (rows.rsvps ?? []).filter((row) => ids.includes(row.meeting_id)).map((data) => ({ data })) };
    }
    const ids = (query['tags'] as string[]).map((tag) => tag.replace('meeting_and_occurrence_id:', ''));
    return { resources: (rows.participants ?? []).filter((row) => ids.includes(row.meeting_and_occurrence_id!)).map((data) => ({ data })) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('ada');
  getJson.mockResolvedValue(null);
  setJson.mockResolvedValue(true);
});

describe('attachMeetingRsvpSummaries', () => {
  it('leaves meetings the viewer does not organize untouched and makes no upstream call', async () => {
    const guest = meeting('m1', { organizer: false });
    const untracked = meeting('m2', { is_invite_responses_enabled: false });

    const result = await attachMeetingRsvpSummaries(req, [guest, untracked], NOW);

    expect(result[0]).toBe(guest);
    expect(result[1]).toBe(untracked);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('counts a one-time meeting on the meeting itself', async () => {
    serveRows({
      registrants: ['r1', 'r2', 'r3', 'r4'].map((uid) => registrant(uid, 'm1')),
      rsvps: [
        rsvp('r1', 'm1', { response_type: 'accepted' }),
        rsvp('r2', 'm1', { response_type: 'maybe' }),
        rsvp('r3', 'm1', { response_type: 'declined' }),
        rsvp('gone', 'm1', { response_type: 'accepted' }),
      ],
    });

    const [result] = await attachMeetingRsvpSummaries(req, [meeting('m1')], NOW);

    expect(result.rsvp_summary).toEqual({ invited: 4, yes: 1, maybe: 1, no: 1, no_response: 1 });
  });

  it('resolves single and this-and-following answers to each listed date of a series', async () => {
    serveRows({
      registrants: ['r1', 'r2', 'r3'].map((uid) => registrant(uid, 's1')),
      rsvps: [
        rsvp('r1', 's1', { response_type: 'accepted', scope: 'all', modified_at: '2026-11-01T00:00:00Z' }),
        rsvp('r1', 's1', { response_type: 'declined', scope: 'single', occurrence_id: `${OCC_2}000`, modified_at: '2026-11-02T00:00:00Z' }),
        rsvp('r2', 's1', { response_type: 'maybe', scope: 'this_and_following', occurrence_id: `${OCC_2}000`, modified_at: '2026-11-02T00:00:00Z' }),
      ] as MeetingRsvp[],
    });

    const [result] = await attachMeetingRsvpSummaries(req, [series('s1')], NOW);

    expect(result.rsvp_summary).toBeUndefined();
    expect(result.occurrences[0].rsvp_summary).toEqual({ invited: 3, yes: 1, maybe: 0, no: 0, no_response: 2 });
    expect(result.occurrences[1].rsvp_summary).toEqual({ invited: 3, yes: 0, maybe: 1, no: 1, no_response: 1 });
  });

  it('batches meetings into bounded registrant and RSVP queries', async () => {
    serveRows({});
    const meetings = Array.from({ length: 30 }, (_, index) => meeting(`m${index}`));

    const result = await attachMeetingRsvpSummaries(req, meetings, NOW);

    const registrantCalls = proxyRequest.mock.calls.filter(([, , , , query]) => query.type === 'v1_meeting_registrant');
    const rsvpCalls = proxyRequest.mock.calls.filter(([, , , , query]) => query.type === 'v1_meeting_rsvp');
    expect(registrantCalls.map(([, , , , query]) => query.filters_or.length)).toEqual([25, 5]);
    expect(rsvpCalls.map(([, , , , query]) => query.tags.length)).toEqual([25, 5]);
    expect(result.every((row) => row.rsvp_summary?.invited === 0)).toBe(true);
  });

  it('keeps the feed when one batch fails, leaving only that batch without counts', async () => {
    serveRows({});
    const served = proxyRequest.getMockImplementation()!;
    proxyRequest.mockImplementation(async (...args: any[]) => {
      const query = args[4];
      if ((query.filters_or ?? query.tags).some((clause: string) => clause.endsWith(':m0'))) throw new Error('upstream down');
      return served(...args);
    });
    const meetings = Array.from({ length: 30 }, (_, index) => meeting(`m${index}`));

    const result = await attachMeetingRsvpSummaries(req, meetings, NOW);

    expect(result.slice(0, 25).every((row, index) => row === meetings[index])).toBe(true);
    expect(result.slice(25).every((row) => row.rsvp_summary !== undefined)).toBe(true);
    expect(setJson).toHaveBeenCalledWith('meeting-attendance:v1:upcoming:ada', expect.not.objectContaining({ m0: expect.anything() }), 60);
  });

  it('serves fresh cached counts without an upstream call', async () => {
    const summary = { invited: 2, yes: 2, maybe: 0, no: 0, no_response: 0 };
    getJson.mockResolvedValue({ m1: { at: Date.now(), value: { '': summary } } });

    const [result] = await attachMeetingRsvpSummaries(req, [meeting('m1')], NOW);

    expect(result.rsvp_summary).toEqual(summary);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('keeps fresh entries from other feeds and drops expired ones when it writes the cache', async () => {
    serveRows({});
    const other = { at: Date.now(), value: { '': { invited: 1, yes: 1, maybe: 0, no: 0, no_response: 0 } } };
    getJson.mockResolvedValue({ other, expired: { ...other, at: Date.now() - 61_000 } });

    await attachMeetingRsvpSummaries(req, [meeting('m1')], NOW);

    const written = setJson.mock.calls[0][1];
    expect(Object.keys(written).sort()).toEqual(['m1', 'other']);
  });

  it('refetches a cached meeting that is stale or missing a listed date', async () => {
    serveRows({});
    getJson.mockResolvedValue({
      m1: { at: Date.now() - 61_000, value: { '': { invited: 9, yes: 9, maybe: 0, no: 0, no_response: 0 } } },
      s1: { at: Date.now(), value: { [OCC_1]: { invited: 9, yes: 9, maybe: 0, no: 0, no_response: 0 } } },
    });

    const result = await attachMeetingRsvpSummaries(req, [meeting('m1'), series('s1')], NOW);

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(result[0].rsvp_summary?.invited).toBe(0);
    expect(result[1].occurrences[0].rsvp_summary?.invited).toBe(0);
  });
});

describe('attachPastMeetingAttendanceSummaries', () => {
  const past = (id: string, organizer: boolean): PastMeeting => ({ id, meeting_and_occurrence_id: id, organizer }) as unknown as PastMeeting;
  const participant = (id: string, attended: boolean): PastMeetingParticipant =>
    ({ meeting_and_occurrence_id: id, is_invited: true, is_attended: attended }) as PastMeetingParticipant;

  it('counts organizer past meetings from one tagged participant query and leaves others untouched', async () => {
    serveRows({ participants: [participant('p1', true), participant('p1', false), participant('p1', true), participant('p2', true)] });
    const guest = past('p2', false);

    const result = await attachPastMeetingAttendanceSummaries(req, [past('p1', true), guest]);

    expect(result[0].attendance_summary).toEqual({ invited: 3, attended: 2 });
    expect(result[1]).toBe(guest);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest.mock.calls[0][4].tags).toEqual(['meeting_and_occurrence_id:p1']);
    expect(dedupe).toHaveBeenCalledTimes(1);
  });

  it('returns the feed unchanged when the participant query fails', async () => {
    proxyRequest.mockRejectedValue(new Error('upstream down'));
    const meetings = [past('p1', true)];

    const result = await attachPastMeetingAttendanceSummaries(req, meetings);

    expect(result[0]).toBe(meetings[0]);
    expect(setJson).not.toHaveBeenCalled();
  });
});
