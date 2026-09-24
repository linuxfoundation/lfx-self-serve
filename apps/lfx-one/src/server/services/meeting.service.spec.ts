// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CreateMeetingRegistrantRequest,
  Meeting,
  MeetingRegistrant,
  MeetingRsvp,
  MeetingUserInfo,
  QueryServiceResponse,
  UpdateMeetingRegistrantRequest,
} from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here, so runtime shared subpaths and the constructed collaborators must be
// mocked (mirrors session-store.service.spec.ts / meeting.helper.spec.ts). Only the
// microservice-proxy call path is exercised; the query-service pagination helper runs for real.
const { proxyRequest, proxyRequestWithResponse, committeeSvc, accessCheckSvc } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  committeeSvc: { getCommitteeById: vi.fn() },
  accessCheckSvc: { checkSingleAccess: vi.fn(), checkSingleAccessStrict: vi.fn() },
}));

vi.mock('@lfx-one/shared/enums', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/utils', async () => ({
  // The real predicate, not a double: these tests are the only place the server-side lock is
  // exercised end to end, and a hand-written copy would stop tracking its normalization — the
  // casing, whitespace and string-coercion rules are the whole point of the gate. It is loaded
  // from its own module rather than the mocked barrel because the barrel reaches @angular/forms
  // and @angular/common/http, which this suite mocks the barrel to avoid in the first place.
  ...(await vi.importActual<typeof import('@lfx-one/shared/utils/meeting-attendee-lock.utils')>('@lfx-one/shared/utils/meeting-attendee-lock.utils')),
  buildRecurrenceNeverEndDate: vi.fn(),
  getPastMeetingTranscriptUrl: vi.fn(),
  // Intentionally a light behavioral double, not a frozen copy meant to track the real predicate:
  // it only needs to exercise the placeholder-vs-blank branch in this file's dedup tests. The
  // predicate's own placeholder-token coverage lives in meeting.utils.spec.ts — a future token
  // added there won't be reflected here, but that's the authoritative test for this behavior.
  isUnresolvableParticipantName: vi.fn((first?: string | null, last?: string | null) => {
    const tokens = [first, last].map((token) => (token ?? '').trim().toLowerCase());
    const meaningful = tokens.filter((token) => token && token !== 'unknown' && token !== '[unknown]');
    return meaningful.length === 0;
  }),
  mapITXResponseToMeetingRsvp: vi.fn(),
  normalizeIndexedMeetingAiSummary: vi.fn((meeting) => meeting),
  normalizeIndexedMeetingInviteResponses: vi.fn((meeting) => meeting),
  selectPrimaryPastMeetingSummary: vi.fn(),
  // getMeetingRsvps / getMeetingRegistrants(includeRsvp) delegate occurrence selection to the real
  // resolver — stubbed here to the "most recent rsvp" since these tests cover roster/page-walk
  // dedup, not the LFXV2-2864 occurrence-scoping logic (covered in meeting-rsvp.helper.spec.ts).
  selectApplicableRsvp: vi.fn((_occurrenceId: string | undefined, rsvps: unknown[]) => rsvps[rsvps.length - 1] ?? null),
}));
vi.mock('../helpers/poll-endpoint.helper', () => ({
  pollEndpoint: vi.fn(async ({ pollFn }: { pollFn: () => Promise<boolean> }) => {
    await pollFn();
    return true;
  }),
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: vi.fn(function () {
    return accessCheckSvc;
  }),
}));
vi.mock('./committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return committeeSvc;
  }),
}));
vi.mock('./project.service', () => ({ ProjectService: class {} }));
vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: vi.fn(),
  getEffectiveUsername: vi.fn(),
  getUsernameFromAuth: vi.fn(),
  stripAuthPrefix: (v: string) => v,
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { logger } from './logger.service';
import { MeetingService } from './meeting.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

const req = {} as unknown as Request;
const human = (id: string): MeetingUserInfo => ({ name: `User ${id}`, username: `user${id}`, email: `${id}@example.com` });

// Builds a single-page query-service response for the given meetings.
function pageOf(meetings: Partial<Meeting>[]): QueryServiceResponse<Meeting> {
  return { resources: meetings.map((m) => ({ id: `v1_meeting:${m.id}`, data: m as Meeting })), page_token: undefined } as QueryServiceResponse<Meeting>;
}

describe('MeetingService.resolveCreatedByForMeetings', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('returns an empty map for an empty input without querying', async () => {
    const result = await service.resolveCreatedByForMeetings(req, []);

    expect(result.size).toBe(0);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('maps meeting uid → created_by/owner from the v1_meeting index', async () => {
    const ownerA = { name: 'Owner a', username: 'ownera', email: 'owner-a@example.com' };
    proxyRequest.mockResolvedValueOnce(
      pageOf([
        { id: 'a', created_by: human('a'), owner: ownerA },
        { id: 'b', created_by: human('b') },
      ])
    );

    const result = await service.resolveCreatedByForMeetings(req, ['a', 'b']);

    expect(result.get('a')).toEqual({ created_by: human('a'), owner: ownerA });
    expect(result.get('b')).toEqual({ created_by: human('b') });
    // Single chunk → single query; the tags param carries the batched OR list.
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'v1_meeting', tags: ['a', 'b'] });
  });

  it('falls back to the resource wrapper id when data.id is absent', async () => {
    // Mirrors getMeetings normalization: uid = data.id || resource.id.split(":").pop().
    proxyRequest.mockResolvedValueOnce({
      resources: [{ id: 'v1_meeting:xyz', data: { created_by: human('xyz') } }],
      page_token: undefined,
    });

    const result = await service.resolveCreatedByForMeetings(req, ['xyz']);

    expect(result.get('xyz')).toEqual({ created_by: human('xyz') });
  });

  it('dedupes repeated uids before querying', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ id: 'a', created_by: human('a') }]));

    await service.resolveCreatedByForMeetings(req, ['a', 'a', 'a']);

    expect(proxyRequest.mock.calls[0][4]).toMatchObject({ tags: ['a'] });
  });

  it('omits meetings that carry neither created_by nor owner, and keeps owner-only rows', async () => {
    const ownerOnly = { name: 'Owner c', username: 'ownerc', email: 'owner-c@example.com' };
    proxyRequest.mockResolvedValueOnce(pageOf([{ id: 'a', created_by: human('a') }, { id: 'b' }, { id: 'c', owner: ownerOnly }]));

    const result = await service.resolveCreatedByForMeetings(req, ['a', 'b', 'c']);

    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false);
    expect(result.get('c')).toEqual({ owner: ownerOnly });
  });

  it('passes zero-valued owners through unfiltered — vetting happens in the callers', async () => {
    // Meetings predating the owner field carry an all-empty owner in the index; the map keeps it
    // so enrichMeetingsWithCreatedBy can vet via resolveMeetingOwner (and never write it).
    const zeroValuedOwner = { user_id: '', name: '', username: '', email: '', profile_picture: '' };
    proxyRequest.mockResolvedValueOnce(pageOf([{ id: 'a', owner: zeroValuedOwner }]));

    const result = await service.resolveCreatedByForMeetings(req, ['a']);

    expect(result.get('a')).toEqual({ owner: zeroValuedOwner });
  });

  it('batches at the 50-uid chunk boundary', async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, created_by: human(`m${i}`) }));
    const second = [{ id: 'm50', created_by: human('m50') }];
    proxyRequest.mockResolvedValueOnce(pageOf(first)).mockResolvedValueOnce(pageOf(second));

    const result = await service.resolveCreatedByForMeetings(
      req,
      [...first, ...second].map((m) => m.id)
    );

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest.mock.calls[0][4].tags).toHaveLength(50);
    expect(proxyRequest.mock.calls[1][4].tags).toEqual(['m50']);
    expect(result.size).toBe(51);
  });

  it('skips a failing chunk and still returns results from the others', async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, created_by: human(`m${i}`) }));
    proxyRequest.mockResolvedValueOnce(pageOf(first)).mockRejectedValueOnce(new Error('upstream 500'));

    const result = await service.resolveCreatedByForMeetings(req, [...first.map((m) => m.id), 'm50']);

    // First chunk resolved; second chunk failed and was skipped rather than throwing.
    expect(result.size).toBe(50);
    expect(result.has('m50')).toBe(false);
  });
});

describe('MeetingService.getMeetingHostKey', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('queries v1_meeting_host_credentials with the correct type and meeting_id tag', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [] });

    await service.getMeetingHostKey(req, 'meeting-abc');

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    const params = proxyRequest.mock.calls[0][4];
    expect(params.type).toBe('v1_meeting_host_credentials');
    expect(params.tags).toBe('meeting_id:meeting-abc');
    expect(params).not.toHaveProperty('limit');
  });

  it('returns the host_key from the first resource', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [{ id: 'v1_meeting_host_credentials:meeting-abc', data: { host_key: '654321' } }],
    });

    const result = await service.getMeetingHostKey(req, 'meeting-abc');

    expect(result).toBe('654321');
  });

  it('returns null when the resources array is empty (user has no access or doc not yet indexed)', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [] });

    const result = await service.getMeetingHostKey(req, 'meeting-abc');

    expect(result).toBeNull();
  });

  it('returns null when host_key is absent from the data payload', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [{ id: 'v1_meeting_host_credentials:meeting-abc', data: {} }],
    });

    const result = await service.getMeetingHostKey(req, 'meeting-abc');

    expect(result).toBeNull();
  });

  it('threads options.bearerToken into the proxy call, distinct from req.bearerToken', async () => {
    const reqWithToken = { bearerToken: 'req-token' } as unknown as Request;
    proxyRequest.mockResolvedValueOnce({ resources: [] });

    await service.getMeetingHostKey(reqWithToken, 'meeting-abc', { bearerToken: 'override-token' });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    // proxyRequest signature: (req, service, path, method, query, data, customHeaders, options)
    const options = proxyRequest.mock.calls[0][7];
    expect(options).toEqual({ bearerToken: 'override-token' });
  });
});

describe('MeetingService.getPastOccurrencesForMeeting', () => {
  let service: MeetingService;

  const pastRecord = (ms: number, overrides: Record<string, unknown> = {}) => ({
    id: `v1_past_meeting:series-1-${ms}`,
    data: {
      meeting_id: 'series-1',
      meeting_and_occurrence_id: `series-1-${ms}`,
      scheduled_start_time: new Date(ms).toISOString(),
      scheduled_end_time: new Date(ms + 30 * 60000).toISOString(),
      title: 'should not leak',
      ...overrides,
    },
  });

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('queries v1_past_meeting filtered by the series meeting_id without filter_grants', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [] });

    await service.getPastOccurrencesForMeeting(req, 'series-1');

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    const params = proxyRequest.mock.calls[0][4];
    expect(params.type).toBe('v1_past_meeting');
    expect(params.filters).toEqual(['meeting_id:series-1']);
    expect(params).not.toHaveProperty('filter_grants');
  });

  it('maps records to minimal summaries sorted ascending by scheduled start', async () => {
    const t1 = Date.UTC(2026, 6, 16, 9, 30);
    const t2 = Date.UTC(2026, 6, 23, 9, 30);
    proxyRequest.mockResolvedValueOnce({ resources: [pastRecord(t2), pastRecord(t1)] });

    const result = await service.getPastOccurrencesForMeeting(req, 'series-1');

    expect(result.map((r) => r.meeting_and_occurrence_id)).toEqual([`series-1-${t1}`, `series-1-${t2}`]);
    // Minimal projection only — no title or other past-meeting fields
    expect(Object.keys(result[0]).sort()).toEqual(['meeting_and_occurrence_id', 'scheduled_end_time', 'scheduled_start_time']);
  });

  it('drops records missing meeting_and_occurrence_id or any start time', async () => {
    const t1 = Date.UTC(2026, 6, 16, 9, 30);
    proxyRequest.mockResolvedValueOnce({
      resources: [
        pastRecord(t1),
        pastRecord(t1 + 1, { meeting_and_occurrence_id: undefined }),
        pastRecord(t1 + 2, { scheduled_start_time: undefined, start_time: undefined }),
      ],
    });

    const result = await service.getPastOccurrencesForMeeting(req, 'series-1');

    expect(result).toHaveLength(1);
    expect(result[0].meeting_and_occurrence_id).toBe(`series-1-${t1}`);
  });

  it('falls back to start_time when the indexed record omits scheduled_start_time', async () => {
    const t1 = Date.UTC(2026, 6, 16, 9, 30);
    proxyRequest.mockResolvedValueOnce({
      resources: [pastRecord(t1, { scheduled_start_time: undefined, scheduled_end_time: undefined, start_time: new Date(t1).toISOString() })],
    });

    const result = await service.getPastOccurrencesForMeeting(req, 'series-1');

    expect(result).toHaveLength(1);
    expect(result[0].scheduled_start_time).toBe(new Date(t1).toISOString());
    expect(result[0].scheduled_end_time).toBeUndefined();
  });

  it('follows page_token pagination across pages', async () => {
    const t1 = Date.UTC(2026, 6, 16, 9, 30);
    const t2 = Date.UTC(2026, 6, 23, 9, 30);
    proxyRequest.mockResolvedValueOnce({ resources: [pastRecord(t1)], page_token: 'next' }).mockResolvedValueOnce({ resources: [pastRecord(t2)] });

    const result = await service.getPastOccurrencesForMeeting(req, 'series-1');

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest.mock.calls[1][4].page_token).toBe('next');
    expect(result).toHaveLength(2);
  });

  it('returns an empty list when the query service call fails', async () => {
    proxyRequest.mockRejectedValueOnce(new Error('query service down'));

    const result = await service.getPastOccurrencesForMeeting(req, 'series-1');

    expect(result).toEqual([]);
  });
});

describe('MeetingService.addMeetingRegistrantSelf', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('posts to the self-register endpoint with required fields and returns the new registrant', async () => {
    const registrant = { uid: 'reg-abc', email: 'alice@example.com' };
    proxyRequest.mockResolvedValueOnce(registrant);

    const result = await service.addMeetingRegistrantSelf(req, 'mtg-1', {
      meeting_id: 'mtg-1',
      first_name: 'Alice',
      last_name: 'Liddell',
      email: 'alice@example.com',
    });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    const [, , path, method, , body, headers] = proxyRequest.mock.calls[0];
    expect(path).toBe('/itx/meetings/mtg-1/registrants/self');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ first_name: 'Alice', last_name: 'Liddell' });
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('username');
    expect(headers).toEqual({ 'X-Sync': 'true' });
    expect(result).toEqual(registrant);
  });

  it('omits optional fields when they are absent from the request', async () => {
    proxyRequest.mockResolvedValueOnce({ uid: 'reg-1' });

    await service.addMeetingRegistrantSelf(req, 'mtg-1', {
      meeting_id: 'mtg-1',
      first_name: 'Alice',
      last_name: 'Liddell',
      email: 'alice@example.com',
    });

    const [, , , , , body] = proxyRequest.mock.calls[0];
    expect(body).not.toHaveProperty('org');
    expect(body).not.toHaveProperty('job_title');
    expect(body).not.toHaveProperty('occurrence');
  });

  it('maps org_name to org and occurrence_id to occurrence when provided', async () => {
    proxyRequest.mockResolvedValueOnce({ uid: 'reg-1' });

    await service.addMeetingRegistrantSelf(req, 'mtg-1', {
      meeting_id: 'mtg-1',
      first_name: 'Alice',
      last_name: 'Liddell',
      email: 'alice@example.com',
      org_name: 'Linux Foundation',
      job_title: 'Engineer',
      occurrence_id: 'occ-42',
    });

    const [, , , , , body] = proxyRequest.mock.calls[0];
    expect(body).toMatchObject({ org: 'Linux Foundation', job_title: 'Engineer', occurrence: 'occ-42' });
    expect(body).not.toHaveProperty('org_name');
    expect(body).not.toHaveProperty('occurrence_id');
  });
});

describe('MeetingService.getMeetingRegistrantsByEmail', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('sends page_size on the gate-check walk', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [] });

    await service.getMeetingRegistrantsByEmail(req, 'meeting-1', 'user@example.com');

    const [, , , , query] = proxyRequest.mock.calls[0];
    expect(query.page_size).toBe(1000);
  });
});

describe('MeetingService.getMeetingRegistrants', () => {
  let service: MeetingService;

  const registrantRecord = (id: string) => ({ id: `v1_meeting_registrant:${id}`, data: { uid: id, email: `${id}@example.com` } as MeetingRegistrant });

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('returns the partial roster by default when a later page fails', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')], page_token: 'next' }).mockRejectedValueOnce(new Error('query service down'));

    const result = await service.getMeetingRegistrants(req, 'meeting-1');

    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('a');
  });

  it('rejects instead of returning a truncated roster when failOnPartial is true', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')], page_token: 'next' }).mockRejectedValueOnce(new Error('query service down'));

    await expect(service.getMeetingRegistrants(req, 'meeting-1', false, undefined, true)).rejects.toThrow('query service down');
  });

  it('stops paging once the roster exceeds maxResults, without fetching remaining pages', async () => {
    proxyRequest
      .mockResolvedValueOnce({ resources: [registrantRecord('a'), registrantRecord('b')], page_token: 'next' })
      .mockResolvedValueOnce({ resources: [registrantRecord('c')], page_token: 'next-2' });

    const result = await service.getMeetingRegistrants(req, 'meeting-1', false, undefined, true, 2);

    // Exceeded maxResults (2) after page 2 (3 accumulated) — page 3 is never requested even
    // though page_token: 'next-2' would otherwise continue pagination.
    expect(result).toHaveLength(3);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('pages to completion when the roster stays within maxResults', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    const result = await service.getMeetingRegistrants(req, 'meeting-1', false, undefined, true, 50);

    expect(result).toHaveLength(1);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('sends page_size on the roster walk', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    await service.getMeetingRegistrants(req, 'meeting-1');

    const [, , , , query] = proxyRequest.mock.calls[0];
    expect(query.page_size).toBe(1000);
  });

  it('clamps page_size to maxResults + 1 instead of always requesting the full 1000', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    await service.getMeetingRegistrants(req, 'meeting-1', false, undefined, true, 50);

    const [, , , , query] = proxyRequest.mock.calls[0];
    expect(query.page_size).toBe(51);
  });

  it('threads options.bearerToken through to the roster-walk proxyRequest call', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    await service.getMeetingRegistrants(req, 'meeting-1', false, undefined, false, undefined, { bearerToken: 'm2m-token' });

    const [, , , , , , , options] = proxyRequest.mock.calls[0];
    expect(options).toEqual({ bearerToken: 'm2m-token' });
  });

  it('fetches the registrant roster exactly once when includeRsvp is true, not twice via getMeetingRsvps', async () => {
    const rsvpRecord = (registrantId: string) => ({
      id: `v1_meeting_rsvp:${registrantId}`,
      data: { registrant_id: registrantId, response_type: 'accepted' } as unknown as MeetingRsvp,
    });
    proxyRequest
      .mockResolvedValueOnce({ resources: [registrantRecord('a'), registrantRecord('b')] }) // roster walk
      .mockResolvedValueOnce({ resources: [rsvpRecord('a')] }); // RSVP walk (getRawMeetingRsvps)

    const result = await service.getMeetingRegistrants(req, 'meeting-1', true);

    // Exactly 2 proxyRequest calls total: one roster page, one RSVP page. Prior to the dedup fix,
    // includeRsvp routed through getMeetingRsvps, which re-walked the roster a second time.
    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect((result[0] as any).rsvp).toBeTruthy();
    expect((result[1] as any).rsvp).toBeNull();
  });

  it('returns registrants without rsvp data when the RSVP fetch fails, instead of throwing', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] }).mockRejectedValueOnce(new Error('rsvp service down'));

    const result = await service.getMeetingRegistrants(req, 'meeting-1', true);

    expect(result).toHaveLength(1);
    expect((result[0] as any).rsvp).toBeUndefined();
  });

  it('rejects instead of silently returning registrants without RSVP data when failOnPartial is true', async () => {
    proxyRequest
      .mockResolvedValueOnce({ resources: [registrantRecord('a')] }) // roster page
      .mockRejectedValueOnce(new Error('rsvp fetch down')); // getRawMeetingRsvps: rsvp page

    await expect(service.getMeetingRegistrants(req, 'meeting-1', true, undefined, true)).rejects.toThrow('rsvp fetch down');
  });
});

describe('MeetingService.getRawMeetingRsvps', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('sends page_size on the RSVP walk and threads options.bearerToken through', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [] });

    await service.getRawMeetingRsvps(req, 'meeting-1', { bearerToken: 'm2m-token' });

    const [, , , , query, , , options] = proxyRequest.mock.calls[0];
    expect(query.page_size).toBe(1000);
    expect(options).toEqual({ bearerToken: 'm2m-token' });
  });

  it('rethrows on a partial page failure when failOnPartial is true', async () => {
    proxyRequest
      .mockResolvedValueOnce({ resources: [], page_token: 'next' }) // page 1
      .mockRejectedValueOnce(new Error('query service down')); // page 2

    await expect(service.getRawMeetingRsvps(req, 'meeting-1', undefined, true)).rejects.toThrow('query service down');
  });
});

describe('MeetingService.getMeetingRsvps', () => {
  let service: MeetingService;

  const registrantRecord = (id: string) => ({ id: `v1_meeting_registrant:${id}`, data: { uid: id, email: `${id}@example.com` } as MeetingRegistrant });
  const rsvpRecord = (registrantId: string) => ({
    id: `v1_meeting_rsvp:${registrantId}`,
    data: { registrant_id: registrantId, response_type: 'accepted' } as unknown as MeetingRsvp,
  });

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('filters RSVPs down to currently-active registrants', async () => {
    proxyRequest
      .mockResolvedValueOnce({ resources: [rsvpRecord('a'), rsvpRecord('stale-registrant')] }) // RSVP walk
      .mockResolvedValueOnce({ resources: [registrantRecord('a')] }); // registrant walk (failOnPartial: true)

    const result = await service.getMeetingRsvps(req, 'meeting-1');

    expect(result).toHaveLength(1);
    expect(result[0].registrant_id).toBe('a');
  });

  it('sends page_size on both the RSVP walk and its own registrant walk', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [rsvpRecord('a')] }).mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    await service.getMeetingRsvps(req, 'meeting-1');

    const rsvpQuery = proxyRequest.mock.calls[0][4];
    const registrantQuery = proxyRequest.mock.calls[1][4];
    expect(rsvpQuery.page_size).toBe(1000);
    expect(registrantQuery.page_size).toBe(1000);
  });

  it('returns RSVPs unfiltered when the registrant fetch fails, rather than hiding data', async () => {
    proxyRequest.mockResolvedValueOnce({ resources: [rsvpRecord('a'), rsvpRecord('b')] }).mockRejectedValueOnce(new Error('query service down'));

    const result = await service.getMeetingRsvps(req, 'meeting-1');

    expect(result).toHaveLength(2);
  });

  it('returns the raw RSVP count unchanged when a later registrant page rejects mid-walk', async () => {
    proxyRequest
      .mockResolvedValueOnce({ resources: [rsvpRecord('a'), rsvpRecord('b')] }) // RSVP walk (single page)
      .mockResolvedValueOnce({ resources: [registrantRecord('a')], page_token: 'next' }) // registrant walk, page 1
      .mockRejectedValueOnce(new Error('query service down')); // registrant walk, page 2 rejects

    const result = await service.getMeetingRsvps(req, 'meeting-1');

    // The registrant walk uses failOnPartial: true, so a page-2 failure throws instead of
    // returning a truncated roster; getMeetingRsvps catches that and falls back to the
    // unfiltered RSVP set rather than filtering against an incomplete registrant list.
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.registrant_id)).toEqual(['a', 'b']);
  });
});

describe('MeetingService.getAuthorizedRegistrantsForImport', () => {
  let service: MeetingService;

  const COMMITTEE_UID = 'committee-1';
  const MEETING_UID = 'meeting-1';

  const registrantRecord = (id: string) => ({ id: `v1_meeting_registrant:${id}`, data: { uid: id, email: `${id}@example.com` } as MeetingRegistrant });
  // getMeetingById issues exactly one proxyRequest call (no committees on the fixture, so the
  // committee-name-map enrichment path is skipped).
  const meetingResponse = (projectUid: string) => ({ id: MEETING_UID, project_uid: projectUid });

  beforeEach(() => {
    proxyRequest.mockReset();
    committeeSvc.getCommitteeById.mockReset();
    accessCheckSvc.checkSingleAccess.mockReset();
    service = new MeetingService();
  });

  it('rejects when the caller lacks writer access and the committee is not invite_only', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1', join_mode: 'open' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(false);
    proxyRequest.mockResolvedValueOnce(meetingResponse('project-1'));

    await expect(service.getAuthorizedRegistrantsForImport(req, MEETING_UID, COMMITTEE_UID)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('passes through for a non-writer *member* on an invite_only committee — mirrors canSendMemberInvites()', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1', join_mode: 'invite_only', my_role: 'Member' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(false);
    proxyRequest.mockResolvedValueOnce(meetingResponse('project-1')).mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    const result = await service.getAuthorizedRegistrantsForImport(req, MEETING_UID, COMMITTEE_UID);

    expect(committeeSvc.getCommitteeById).toHaveBeenCalledWith(req, COMMITTEE_UID, { includeMembership: true });
    expect(result).toHaveLength(1);
  });

  it('rejects a non-writer, non-member on an invite_only committee — join_mode alone does not prove membership', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1', join_mode: 'invite_only' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(false);
    proxyRequest.mockResolvedValueOnce(meetingResponse('project-1'));

    await expect(service.getAuthorizedRegistrantsForImport(req, MEETING_UID, COMMITTEE_UID)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects when the committee and meeting belong to different projects', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce(meetingResponse('project-2'));

    await expect(service.getAuthorizedRegistrantsForImport(req, MEETING_UID, COMMITTEE_UID)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('passes through when the caller is a writer on a same-project committee', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce(meetingResponse('project-1')).mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    const result = await service.getAuthorizedRegistrantsForImport(req, MEETING_UID, COMMITTEE_UID);

    expect(accessCheckSvc.checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'committee', id: COMMITTEE_UID, access: 'writer' });
    expect(result).toEqual([{ uid: 'a', email: 'a@example.com' }]);
  });

  it('rejects an authorized import once the roster exceeds the size cap, bounding the fetch itself', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    const bigPage = { resources: Array.from({ length: 51 }, (_, i) => registrantRecord(`r${i}`)) };
    proxyRequest.mockResolvedValueOnce(meetingResponse('project-1')).mockResolvedValueOnce(bigPage);

    await expect(service.getAuthorizedRegistrantsForImport(req, MEETING_UID, COMMITTEE_UID)).rejects.toMatchObject({
      statusCode: 400,
      validationErrors: [expect.objectContaining({ message: 'This meeting has more than 50 registrants — imports are limited to 50 per meeting.' })],
    });
    // maxResults bounds the fetch itself: one page already exceeds the cap, so pagination never
    // continues even though the fixture's single page doesn't set page_token either way.
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('requests page_size 51, not 1000, since the import cap only needs 51 rows to reject', async () => {
    committeeSvc.getCommitteeById.mockResolvedValue({ uid: COMMITTEE_UID, project_uid: 'project-1' });
    accessCheckSvc.checkSingleAccess.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce(meetingResponse('project-1')).mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    await service.getAuthorizedRegistrantsForImport(req, MEETING_UID, COMMITTEE_UID);

    const [, , , , query] = proxyRequest.mock.calls[1];
    expect(query.page_size).toBe(51);
  });
});

describe('MeetingService.getAuthorizedCompleteRegistrants', () => {
  let service: MeetingService;

  const MEETING_UID = 'meeting-1';
  const registrantRecord = (id: string) => ({ id: `v1_meeting_registrant:${id}`, data: { uid: id, email: `${id}@example.com` } as MeetingRegistrant });

  beforeEach(() => {
    proxyRequest.mockReset();
    accessCheckSvc.checkSingleAccessStrict.mockReset();
    service = new MeetingService();
  });

  // The guard, not the listing, is the security property: upstream applies no per-user filtering
  // to v1_meeting_registrant, so an unauthorized caller reaching the walk at all is the leak.
  it('refuses a non-organizer with a 403 before any registrant is fetched', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(false);

    await expect(service.getAuthorizedCompleteRegistrants(req, MEETING_UID)).rejects.toMatchObject({ statusCode: 403 });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  // The resource *type* is load-bearing, not incidental: organizer tuples live on `v1_meeting`, so
  // probing the bare `meeting` type finds nothing and fails closed on the very organizers this path
  // exists to serve. The stub answers `true` either way, so only this assertion catches the drift.
  it('probes organizer access on the v1_meeting type, not writer access on some other resource', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    await service.getAuthorizedCompleteRegistrants(req, MEETING_UID);

    expect(accessCheckSvc.checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_UID, access: 'organizer' });
  });

  it('returns the roster for an organizer', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    const result = await service.getAuthorizedCompleteRegistrants(req, MEETING_UID);

    expect(result).toEqual([{ uid: 'a', email: 'a@example.com' }]);
  });

  // The authorizer gets asked strictly for the same reason the roster is fetched strictly: the
  // lenient `checkSingleAccess` turns an unreachable authorizer into a false, which this method
  // would then report as a 403 — a permanent "you are not an organizer" for a transient fault, on
  // the one caller who is. Propagating leaves the upstream status intact, so the Guests section
  // gets a retryable error rather than a verdict.
  it('propagates an unresolvable organizer check instead of reporting it as a denial', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockRejectedValue(new Error('access-check unreachable'));

    await expect(service.getAuthorizedCompleteRegistrants(req, MEETING_UID)).rejects.toThrow('access-check unreachable');
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  // Strictness is the whole reason this path exists — a short list reads to the composer as
  // "these people are not registered yet", and the organizer re-invites guests who already have
  // an invite. It must surface as an error, so failOnPartial cannot be left to the caller.
  it('fetches strictly, so a mid-walk page failure throws instead of returning a short roster', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')], page_token: 'next' }).mockRejectedValueOnce(new Error('query service down'));

    await expect(service.getAuthorizedCompleteRegistrants(req, MEETING_UID)).rejects.toThrow();
  });
});

describe('MeetingService.getAuthorizedRegistrantsForListing', () => {
  let service: MeetingService;

  const MEETING_UID = 'meeting-1';
  const PROJECT_UID = 'project-1';
  const registrantRecord = (id: string) => ({ id: `v1_meeting_registrant:${id}`, data: { uid: id, email: `${id}@example.com` } as MeetingRegistrant });
  // Minimal meeting object with the project_uid that getAuthorizedRegistrantsForListing needs
  // when falling through to the project-writer check.
  const meetingStub = { id: MEETING_UID, project_uid: PROJECT_UID };

  beforeEach(() => {
    proxyRequest.mockReset();
    accessCheckSvc.checkSingleAccessStrict.mockReset();
    service = new MeetingService();
  });

  // The core security property: without this gate any authenticated user can harvest full
  // registrant PII by knowing a meeting UID (which is public via meeting pages and calendar feeds).
  it('refuses a caller who is neither an organizer nor a project writer', async () => {
    // organizer check → false; getMeetingById to resolve project_uid; project writer check → false
    accessCheckSvc.checkSingleAccessStrict
      .mockResolvedValueOnce(false) // organizer
      .mockResolvedValueOnce(false); // project writer
    proxyRequest.mockResolvedValueOnce(meetingStub); // getMeetingById

    await expect(service.getAuthorizedRegistrantsForListing(req, MEETING_UID)).rejects.toMatchObject({ statusCode: 403 });
    // Roster must never be fetched before authorization is resolved.
    expect(proxyRequest).toHaveBeenCalledTimes(1); // only the getMeetingById call
  });

  it('allows a meeting organizer and returns their roster', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true); // organizer passes
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    const result = await service.getAuthorizedRegistrantsForListing(req, MEETING_UID);

    expect(result).toEqual([{ uid: 'a', email: 'a@example.com' }]);
    // On the organizer fast path getMeetingById must not be called — the point is to avoid the
    // extra round trip when the caller is already an organizer.
    expect(accessCheckSvc.checkSingleAccessStrict).toHaveBeenCalledTimes(1);
    expect(accessCheckSvc.checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_UID, access: 'organizer' });
  });

  it('allows a project writer (non-organizer) and returns their roster', async () => {
    accessCheckSvc.checkSingleAccessStrict
      .mockResolvedValueOnce(false) // organizer check fails
      .mockResolvedValueOnce(true); // project writer check passes
    proxyRequest
      .mockResolvedValueOnce(meetingStub) // getMeetingById to get project_uid
      .mockResolvedValueOnce({ resources: [registrantRecord('b')] }); // registrant page

    const result = await service.getAuthorizedRegistrantsForListing(req, MEETING_UID);

    expect(result).toEqual([{ uid: 'b', email: 'b@example.com' }]);
    expect(accessCheckSvc.checkSingleAccessStrict).toHaveBeenNthCalledWith(2, req, { resource: 'project', id: PROJECT_UID, access: 'writer' });
  });

  it('probes organizer access on v1_meeting, not the bare meeting type', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce({ resources: [registrantRecord('a')] });

    await service.getAuthorizedRegistrantsForListing(req, MEETING_UID);

    expect(accessCheckSvc.checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_UID, access: 'organizer' });
  });

  it('propagates an unresolvable organizer check rather than treating it as a denial', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockRejectedValue(new Error('fga unreachable'));

    await expect(service.getAuthorizedRegistrantsForListing(req, MEETING_UID)).rejects.toThrow('fga unreachable');
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('propagates an unresolvable project-writer check rather than treating it as a denial', async () => {
    accessCheckSvc.checkSingleAccessStrict
      .mockResolvedValueOnce(false) // organizer fails
      .mockRejectedValueOnce(new Error('fga unreachable')); // project writer check throws
    proxyRequest.mockResolvedValueOnce(meetingStub); // getMeetingById

    await expect(service.getAuthorizedRegistrantsForListing(req, MEETING_UID)).rejects.toThrow('fga unreachable');
  });
});

describe('MeetingService.getAuthorizedMeetingRsvps', () => {
  let service: MeetingService;

  const MEETING_UID = 'meeting-1';
  const rsvpRecord = (id: string) => ({ id: `v1_meeting_rsvp:${id}`, data: { uid: id, email: `${id}@example.com`, response_type: 'yes', registrant_id: id } });
  const registrantRecord = (id: string) => ({ id: `v1_meeting_registrant:${id}`, data: { uid: id, email: `${id}@example.com` } as MeetingRegistrant });

  beforeEach(() => {
    proxyRequest.mockReset();
    accessCheckSvc.checkSingleAccessStrict.mockReset();
    service = new MeetingService();
  });

  it('refuses a non-organizer with a 403 and does not read any RSVPs', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(false);

    await expect(service.getAuthorizedMeetingRsvps(req, MEETING_UID)).rejects.toMatchObject({ statusCode: 403 });
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('probes organizer access on the v1_meeting type', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true);
    // getMeetingRsvps needs both the RSVPs and the registrant list for active-registrant filtering.
    proxyRequest
      .mockResolvedValueOnce({ resources: [rsvpRecord('r1')] }) // raw RSVPs
      .mockResolvedValueOnce({ resources: [registrantRecord('r1')] }); // registrants for filter

    await service.getAuthorizedMeetingRsvps(req, MEETING_UID);

    expect(accessCheckSvc.checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_UID, access: 'organizer' });
  });

  it('returns RSVPs for a meeting organizer', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true);
    proxyRequest.mockResolvedValueOnce({ resources: [rsvpRecord('r1')] }).mockResolvedValueOnce({ resources: [registrantRecord('r1')] });

    const result = await service.getAuthorizedMeetingRsvps(req, MEETING_UID);

    expect(result.length).toBeGreaterThan(0);
  });

  // Critical difference from getMeetingRsvps: the authorization error must NOT be absorbed by
  // getMeetingRsvps's catch-all, which returns [] on any upstream failure — a 403 swallowed into
  // an empty array would look like a meeting with no RSVPs, not an access denial.
  it('propagates an AuthorizationError as a rejection, not as an empty array', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(false);

    await expect(service.getAuthorizedMeetingRsvps(req, MEETING_UID)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('propagates an unresolvable organizer check rather than treating it as a denial', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockRejectedValue(new Error('fga unreachable'));

    await expect(service.getAuthorizedMeetingRsvps(req, MEETING_UID)).rejects.toThrow('fga unreachable');
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});

// The roster and the group attribution are two different reads. The tolerant listing hands the
// roster over on the caller's own token and is meant to; what it must not hand over alongside it is
// which committee each person sits on — that is the committee's membership showing through a
// meeting the caller may merely be able to list.
describe('MeetingService.assertCommitteeAttributionAllowed', () => {
  let service: MeetingService;

  const MEETING_UID = 'meeting-1';

  beforeEach(() => {
    accessCheckSvc.checkSingleAccessStrict.mockReset();
    service = new MeetingService();
  });

  it('refuses a caller who is not an organizer of the meeting', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(false);

    await expect(service.assertCommitteeAttributionAllowed(req, MEETING_UID)).rejects.toMatchObject({ statusCode: 403 });
  });

  // Same reasoning as getAuthorizedCompleteRegistrants: organizer tuples hang off `v1_meeting`, so
  // probing the bare `meeting` type finds nothing and denies the organizers this gate exists to let
  // through. The stub answers `true` either way, so only this assertion catches the drift.
  it('probes organizer access on the v1_meeting type', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockResolvedValue(true);

    await service.assertCommitteeAttributionAllowed(req, MEETING_UID);

    expect(accessCheckSvc.checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'v1_meeting', id: MEETING_UID, access: 'organizer' });
  });

  // Strict, so an unreachable authorizer stays a fault. The lenient variant would turn it into a
  // false, and this method would then report a permanent denial for a transient outage.
  it('propagates an unresolvable organizer check instead of reporting it as a denial', async () => {
    accessCheckSvc.checkSingleAccessStrict.mockRejectedValue(new Error('access-check unreachable'));

    await expect(service.assertCommitteeAttributionAllowed(req, MEETING_UID)).rejects.toThrow('access-check unreachable');
  });
});

describe('MeetingService.getPastMeetingParticipants', () => {
  let service: MeetingService;

  const participantRecord = (id: string, overrides: Record<string, unknown> = {}) => ({
    id: `v1_past_meeting_participant:${id}`,
    data: {
      uid: id,
      meeting_id: 'meeting-1',
      meeting_and_occurrence_id: 'meeting-1-occ-1',
      past_meeting_id: 'past-1',
      first_name: 'Jane',
      last_name: 'Doe',
      host: false,
      is_attended: false,
      is_invited: true,
      org_is_member: false,
      org_is_project_member: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  });

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('merges two records sharing the same LFID username, even with different emails', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { email: 'jane@example.com', username: 'jdoe', is_invited: true, is_attended: false }),
        participantRecord('b', { email: 'jane.alt@example.com', username: 'jdoe', is_invited: false, is_attended: true }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(1);
    expect(result[0].is_invited).toBe(true);
    expect(result[0].is_attended).toBe(true);
    expect(result[0].email).toBe('jane@example.com');
  });

  it('does not merge two records with the same email but different usernames', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { email: 'shared@example.com', username: 'user-a' }),
        participantRecord('b', { email: 'shared@example.com', username: 'user-b' }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(2);
  });

  it('merges by email when neither record has a username', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [participantRecord('a', { email: 'guest@example.com' }), participantRecord('b', { email: 'GUEST@example.com' })],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(1);
  });

  it('merges on matching email even when only one side has a username — email is checked before the username-asymmetry fallback', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [participantRecord('a', { email: 'guest@example.com', username: 'jdoe' }), participantRecord('b', { email: 'guest@example.com' })],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(1);
  });

  it('does not merge asymmetric-username records when neither has an email to fall back on', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { username: 'jdoe', first_name: 'Jane', last_name: 'Doe' }),
        participantRecord('b', { first_name: 'Jane', last_name: 'Doe' }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(2);
  });

  it('falls back to normalized display name when neither username nor email is present', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [participantRecord('a', { first_name: 'Jane', last_name: 'Doe' }), participantRecord('b', { first_name: 'jane', last_name: 'doe' })],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(1);
  });

  it('does not merge different people who share no identity signal at all', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [participantRecord('a', { first_name: 'Jane', last_name: 'Doe' }), participantRecord('b', { first_name: 'John', last_name: 'Smith' })],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(2);
  });

  it('does not merge two unnamed records with no email or username to fall back on', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { first_name: undefined, last_name: undefined }),
        participantRecord('b', { first_name: undefined, last_name: undefined }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(2);
  });

  it('does not merge two records with placeholder "[unknown]" names', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { first_name: '[unknown]', last_name: '[unknown]' }),
        participantRecord('b', { first_name: '[unknown]', last_name: '[unknown]' }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(2);
  });

  it('merges on matching name when only one side has an email', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' }),
        participantRecord('b', { first_name: 'Jane', last_name: 'Doe' }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(1);
  });

  it('coalesces three records into one person via a bridging record, regardless of encounter order', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { email: 'shared@example.com', username: undefined }),
        participantRecord('b', { email: 'other@example.com', username: 'jdoe' }),
        participantRecord('c', { email: 'shared@example.com', username: 'jdoe' }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(1);
  });

  it('isolates an ambiguous shared-email bridge record rather than guessing which of two conflicting LFID usernames it belongs to', async () => {
    const resources = [
      participantRecord('a', { username: 'user-a', email: 'shared@example.com', is_attended: true }),
      participantRecord('b', { username: undefined, email: 'shared@example.com', is_attended: true, host: true }),
      participantRecord('c', { username: 'user-b', email: 'shared@example.com' }),
    ];

    proxyRequest.mockResolvedValueOnce({ resources });
    const forward = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    proxyRequest.mockResolvedValueOnce({ resources: [...resources].reverse() });
    const reversed = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    for (const result of [forward, reversed]) {
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.username).sort()).toEqual([undefined, 'user-a', 'user-b'].sort());

      // The ambiguous bridge record's own attendance/host flags must not bleed into either
      // conflicting username's group, regardless of encounter order.
      const bridgeRecord = result.find((p) => !p.username);
      const userA = result.find((p) => p.username === 'user-a');
      const userB = result.find((p) => p.username === 'user-b');
      expect(bridgeRecord?.is_attended).toBe(true);
      expect(bridgeRecord?.host).toBe(true);
      expect(userA?.host).toBe(false);
      expect(userB?.is_attended).toBe(false);
    }
  });

  it('refuses to bridge two conflicting guest emails through a shared-name no-email record', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { email: 'guest-one@example.com', first_name: 'Sam', last_name: 'Guest' }),
        participantRecord('b', { email: undefined, first_name: 'Sam', last_name: 'Guest' }),
        participantRecord('c', { email: 'guest-two@example.com', first_name: 'Sam', last_name: 'Guest' }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(3);
    expect(result.map((p) => p.email).sort()).toEqual(['guest-one@example.com', 'guest-two@example.com', undefined].sort());
  });

  it('does not let a blank-string email sentinel on the preferred record discard a real email on merge', async () => {
    proxyRequest.mockResolvedValueOnce({
      resources: [
        participantRecord('a', { email: '', first_name: 'Jane', last_name: 'Doe', is_attended: true }),
        participantRecord('b', { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe', is_attended: false }),
      ],
    });

    const result = await service.getPastMeetingParticipants(req, 'meeting-1-occ-1');

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('jane@example.com');
  });
});

describe('MeetingService participant write methods', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('createPastMeetingParticipant posts to the participants endpoint with the given body', async () => {
    const created = { id: 'p-1', past_meeting_id: 'pm-1', meeting_id: 'mtg-1', is_attended: true, zoom_user_name: 'Alice Z' };
    proxyRequest.mockResolvedValueOnce(created);

    const result = await service.createPastMeetingParticipant(req, 'pm-1', { is_attended: true, is_unknown: false });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    const [, , path, method, , body] = proxyRequest.mock.calls[0];
    expect(path).toBe('/itx/past_meetings/pm-1/participants');
    expect(method).toBe('POST');
    expect(body).toEqual({ is_attended: true, is_unknown: false });
    expect(result).toEqual(created);
  });

  it('updatePastMeetingParticipant puts to the participant endpoint with the participant id in the path', async () => {
    const updated = { id: 'p-1', past_meeting_id: 'pm-1', meeting_id: 'mtg-1', is_verified: true };
    proxyRequest.mockResolvedValueOnce(updated);

    const result = await service.updatePastMeetingParticipant(req, 'pm-1', 'p-1', { is_verified: true });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    const [, , path, method, , body] = proxyRequest.mock.calls[0];
    expect(path).toBe('/itx/past_meetings/pm-1/participants/p-1');
    expect(method).toBe('PUT');
    expect(body).toEqual({ is_verified: true });
    expect(result).toEqual(updated);
  });

  it('deletePastMeetingParticipant deletes the participant endpoint and returns nothing', async () => {
    proxyRequest.mockResolvedValueOnce(undefined);

    const result = await service.deletePastMeetingParticipant(req, 'pm-1', 'p-1');

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    const [, , path, method] = proxyRequest.mock.calls[0];
    expect(path).toBe('/itx/past_meetings/pm-1/participants/p-1');
    expect(method).toBe('DELETE');
    expect(result).toBeUndefined();
  });

  it('encodes past meeting id and participant id in the URL', async () => {
    proxyRequest.mockResolvedValueOnce({ id: 'p/1', past_meeting_id: 'pm 1', meeting_id: 'mtg-1' });

    await service.updatePastMeetingParticipant(req, 'pm 1', 'p/1', {});

    const [, , path] = proxyRequest.mock.calls[0];
    expect(path).toBe('/itx/past_meetings/pm%201/participants/p%2F1');
  });
});

/**
 * The ITX registrant contract (`CreateItxRegistrantRequestBody`, reused verbatim for the PUT) declares
 * `org`, `profile_picture` and `occurrence`; the app's read model — sourced from the v1 query-service
 * index — spells them `org_name`, `avatar_url` and `occurrence_id`. Goa ignores undeclared body keys,
 * so without the rename these three were dropped upstream behind a 200.
 */
describe('MeetingService registrant write payloads', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    // `{}` is a body with no usable fields, which is the fallback branch on every write path here.
    // The outbound-payload tests below don't care — they read `proxyRequest`'s arguments — but the
    // tests that assert on a *returned* registrant have to set their own response, or they'd be
    // checking the fallback while claiming to check the mapping.
    proxyRequest.mockResolvedValue({});
    vi.mocked(logger.success).mockClear();
    service = new MeetingService();
  });

  const bodyOf = (): Record<string, unknown> => proxyRequest.mock.calls[0][5] as Record<string, unknown>;

  it('renames org_name, avatar_url and occurrence_id on create', async () => {
    await service.addMeetingRegistrant(req, {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      org_name: 'Acme',
      avatar_url: 'https://example.com/a.png',
      occurrence_id: '1666848600',
    });

    expect(bodyOf()).toMatchObject({ org: 'Acme', profile_picture: 'https://example.com/a.png', occurrence: '1666848600' });
    expect(bodyOf()).not.toHaveProperty('org_name');
    expect(bodyOf()).not.toHaveProperty('avatar_url');
    expect(bodyOf()).not.toHaveProperty('occurrence_id');
  });

  it('drops meeting_id from the create body, since it is the path parameter', async () => {
    await service.addMeetingRegistrant(req, { meeting_id: 'meeting-1', email: 'a@example.com', first_name: 'A', last_name: 'B' });

    expect(proxyRequest.mock.calls[0][2]).toBe('/itx/meetings/meeting-1/registrants');
    expect(bodyOf()).not.toHaveProperty('meeting_id');
  });

  it('omits the renamed keys entirely when the caller omitted them', async () => {
    await service.addMeetingRegistrant(req, { meeting_id: 'meeting-1', email: 'a@example.com', first_name: 'A', last_name: 'B', host: true });

    expect(bodyOf()).toEqual({ email: 'a@example.com', first_name: 'A', last_name: 'B', host: true });
  });

  it('renames on update too, since the PUT reuses the same body schema', async () => {
    await service.updateMeetingRegistrant(req, 'meeting-1', 'reg-1', {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      org_name: 'Acme',
      avatar_url: 'https://example.com/a.png',
      occurrence_id: '1666848600',
    });

    expect(proxyRequest.mock.calls[0][2]).toBe('/itx/meetings/meeting-1/registrants/reg-1');
    expect(bodyOf()).toMatchObject({ org: 'Acme', profile_picture: 'https://example.com/a.png', occurrence: '1666848600' });
  });

  // `getChangedFields` nulls all three whenever they're blank — always, for the two with no form
  // control. All three targets are declared non-nullable, and before the rename Goa dropped the
  // undeclared key outright; omitting keeps that outcome instead of planting a null on a declared
  // field on every ordinary registrant edit.
  it('omits an explicit null rather than renaming it onto a non-nullable field', async () => {
    await service.updateMeetingRegistrant(req, 'meeting-1', 'reg-1', {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      org_name: null,
      avatar_url: null,
      occurrence_id: null,
    });

    for (const key of ['org', 'profile_picture', 'occurrence', 'org_name', 'avatar_url', 'occurrence_id']) {
      expect(bodyOf()).not.toHaveProperty(key);
    }
  });

  // `ApiClientService` turns an empty response body into `null`. Mapping that alone would return
  // `{}`, and `processRegistrantOperations` hands the result straight back as the updated row — so a
  // succeeded write would render as a registrant that lost every field.
  it('falls back to the submitted payload when the update answers without a body', async () => {
    proxyRequest.mockResolvedValue(null);

    const result = await service.updateMeetingRegistrant(req, 'meeting-1', 'reg-1', {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
    });

    expect(result).toMatchObject({ email: 'a@example.com', first_name: 'A', last_name: 'B' });
    // The identity is the routed one, not the body's. `uid` isn't in the update body at all and
    // `MeetingRegistrant` declares it required, so an unasserted fallback could drop it and still
    // type-check; `meeting_id` is in the body, and the routed meeting is the authoritative one.
    expect(result).toMatchObject({ uid: 'reg-1', meeting_id: 'meeting-1' });
  });

  // The routed identity is written after the spread for the same reason the create fallback's is:
  // the batch endpoint reads `changes` straight off `req.body`, so a client can name a `uid` and a
  // `meeting_id` of its own. Spread last, they would overwrite the ones the request actually routed
  // on and be echoed back as the updated registrant's identity.
  it('does not let a body-supplied identity override the routed one in the update fallback', async () => {
    proxyRequest.mockResolvedValue(null);

    const result = await service.updateMeetingRegistrant(req, 'meeting-1', 'reg-1', {
      meeting_id: 'other-meeting',
      uid: 'other-registrant',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
    } as UpdateMeetingRegistrantRequest & { uid: string });

    expect(result).toMatchObject({ uid: 'reg-1', meeting_id: 'meeting-1' });
  });

  // Where upstream did answer, its body is the whole answer: merging the request underneath it would
  // report an omitted `org_name: null` as cleared when upstream still holds the old organization.
  it('does not merge the submitted payload under a body upstream did answer with', async () => {
    proxyRequest.mockResolvedValue({ uid: 'reg-1', org: 'Acme' });

    const result = await service.updateMeetingRegistrant(req, 'meeting-1', 'reg-1', {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      org_name: null,
    });

    expect(result).toMatchObject({ uid: 'reg-1', org_name: 'Acme' });
    expect(result).not.toHaveProperty('email');
  });

  // Same reasoning as the update fallback above, on the two create paths: `ApiClientService` maps an
  // empty response body to `null`, and a 201 carrying a literal `{}` is truthy — so both were mapped
  // straight through and reported a created registrant with every field missing. The submitted payload
  // is the closest description of what upstream now holds; `uid` is the one thing it can't supply, so
  // it is stated as `''` — falsy, so a caller's `if (uid)` still routes to a read-back.
  it.each([
    ['null', null],
    ['an empty object', {}],
  ])('falls back to the submitted payload when the create answers with %s', async (_label, body) => {
    proxyRequest.mockResolvedValue(body);

    const result = await service.addMeetingRegistrant(req, {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
    });

    expect(result).toMatchObject({ email: 'a@example.com', first_name: 'A', last_name: 'B' });
    expect(result.uid).toBe('');
  });

  // The fallback used to spread the request shape and cast the result, which asserted a dozen required
  // fields the request does not carry — a consumer typing them as present read `undefined`. This pins
  // the whole surface rather than the handful the other tests happen to touch, because the failure it
  // guards against is a field going missing, not one holding the wrong value.
  it('states every field MeetingRegistrant declares, not just the ones the request carries', async () => {
    proxyRequest.mockResolvedValue(null);

    const result = await service.addMeetingRegistrant(req, { meeting_id: 'meeting-1', email: 'a@example.com', first_name: 'A', last_name: 'B' });

    for (const key of ['uid', 'meeting_id', 'email', 'first_name', 'last_name', 'host', 'job_title', 'org_name', 'occurrence_id'] as const) {
      expect(result[key]).toBeDefined();
    }
    for (const key of ['avatar_url', 'username', 'linkedin_profile', 'org_is_member', 'org_is_project_member', 'created_at', 'updated_at', 'type'] as const) {
      expect(result[key]).toBeDefined();
    }
    expect(result.type).toBe('direct');
    expect(result).not.toHaveProperty('committee_uid');
  });

  // Upstream derives `type` from the committee it stores, so a committee-sourced create whose body
  // never came back must not describe itself as a direct guest.
  it('describes a committee-sourced create as a committee registrant', async () => {
    proxyRequest.mockResolvedValue(null);

    const result = await service.addMeetingRegistrant(req, {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      committee_uid: 'cmt-1',
    });

    expect(result.type).toBe('committee');
    expect(result.committee_uid).toBe('cmt-1');
  });

  // `registrantData` comes from `req.body` and the create route carries no express-validator, so a
  // client can name a `uid`. Spread over the placeholder it would be echoed back as the created
  // registrant's identity — a UID upstream never minted, presented as though it had, and falsy
  // checks like `if (registrant.uid)` would route past the read-back that exists to find the real
  // one.
  it('does not let a body-supplied uid stand in for the one upstream never minted', async () => {
    proxyRequest.mockResolvedValue(null);

    const result = await service.addMeetingRegistrant(req, {
      meeting_id: 'meeting-1',
      uid: 'client-chosen',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
    } as CreateMeetingRegistrantRequest & { uid: string });

    expect(result.uid).toBe('');
  });

  // The outbound mapper is an allowlist, not a copy-with-deletions. `req.body` is untyped JSON and
  // both batch controllers spread it, so a key no request shape declares used to be forwarded
  // unexamined — `uid` being the one that matters, since ITX derives the registrant's identity from
  // the path and an extra body key is exactly the kind of thing a proxy should not be relaying.
  it('forwards no key that neither request shape declares', async () => {
    await service.addMeetingRegistrant(req, {
      meeting_id: 'meeting-1',
      uid: 'client-chosen',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      totally_made_up: 'x',
    } as CreateMeetingRegistrantRequest & { uid: string; totally_made_up: string });

    expect(bodyOf()).toMatchObject({ email: 'a@example.com', first_name: 'A', last_name: 'B' });
    for (const key of ['uid', 'totally_made_up', 'meeting_id']) {
      expect(bodyOf()).not.toHaveProperty(key);
    }
  });

  // Same allowlist, other verb. `toUpstreamRegistrantBody` is shared between the two writes, so a
  // regression that scoped the allowlist loop to the create path would keep every test above green
  // while the `PUT` went back to forwarding a client-named `uid` — the one key ITX derives from the
  // path, on the branch whose controller spreads `req.body` wholesale.
  it('forwards no undeclared key on the update path either', async () => {
    await service.updateMeetingRegistrant(req, 'meeting-1', 'reg-1', {
      meeting_id: 'other-meeting',
      uid: 'client-chosen',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      totally_made_up: 'x',
    } as UpdateMeetingRegistrantRequest & { uid: string; totally_made_up: string });

    expect(proxyRequest.mock.calls[0][2]).toBe('/itx/meetings/meeting-1/registrants/reg-1');
    expect(bodyOf()).toMatchObject({ email: 'a@example.com', first_name: 'A', last_name: 'B' });
    for (const key of ['uid', 'totally_made_up', 'meeting_id']) {
      expect(bodyOf()).not.toHaveProperty(key);
    }
  });

  // Self-registration is the path a registrant drives from the public meeting page, so the same
  // unusable body used to surface to them as a `{}` "created" record. Its success line has to say
  // which branch produced the result — without `has_upstream_body` and an explicit `null` uid, the
  // fallback's placeholder would log as an empty UID rather than as one upstream never minted.
  it('logs which branch the self-registration create returned from when upstream sends no body', async () => {
    proxyRequest.mockResolvedValue(null);

    const result = await service.addMeetingRegistrantSelf(req, 'meeting-1', {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
    });

    expect(result).toMatchObject({ meeting_id: 'meeting-1', first_name: 'A', last_name: 'B' });
    expect(logger.success).toHaveBeenCalledWith(
      req,
      'add_meeting_registrant_self',
      expect.anything(),
      expect.objectContaining({ registrant_uid: null, has_upstream_body: false })
    );
  });

  // The fallback answers a registrant, not an admin: `PUBLIC_SELF_REGISTRATION_RESPONSE_KEYS` carries
  // `host`, `created_at` and `updated_at` back out, and a write upstream acknowledged with no body
  // says nothing about any of them. Omitting is what keeps "the write response didn't say" distinct
  // from "upstream stored nothing" — a fabricated `host: false` with empty timestamps reads as the row.
  // `email` and `username` are absent for a second reason: this route never sends them, so the body's
  // copy would be a reading of the request rather than of the registrant upstream identified.
  it.each(['uid', 'host', 'created_at', 'updated_at', 'email', 'username', 'org_is_member', 'invite_accepted', 'attended'])(
    'omits %s from the self-registration fallback rather than inventing one',
    async (field) => {
      proxyRequest.mockResolvedValue(null);

      const result = await service.addMeetingRegistrantSelf(req, 'meeting-1', {
        meeting_id: 'meeting-1',
        email: 'a@example.com',
        first_name: 'A',
        last_name: 'B',
      });

      expect(result).not.toHaveProperty(field);
    }
  );

  // The renames are the whole reason this is a separate fallback from the M2M one: what comes back
  // has to be spelled the way the response allowlist reads it, and only the fields the request
  // actually carried may appear.
  it('carries the submitted optional fields through the self-registration fallback under their app spelling', async () => {
    proxyRequest.mockResolvedValue(null);

    const result = await service.addMeetingRegistrantSelf(req, 'meeting-1', {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      org_name: 'Acme',
      job_title: 'Engineer',
      occurrence_id: 'occ-42',
    });

    expect(result).toMatchObject({ org_name: 'Acme', job_title: 'Engineer', occurrence_id: 'occ-42' });
  });

  it('reports the upstream branch on the self-registration create when upstream does answer', async () => {
    proxyRequest.mockResolvedValue({ uid: 'reg-1' });

    await service.addMeetingRegistrantSelf(req, 'meeting-1', { meeting_id: 'meeting-1', email: 'a@example.com', first_name: 'A', last_name: 'B' });

    expect(logger.success).toHaveBeenCalledWith(
      req,
      'add_meeting_registrant_self',
      expect.anything(),
      expect.objectContaining({ registrant_uid: 'reg-1', has_upstream_body: true })
    );
  });

  // Self-registration builds its own payload against a different endpoint, and it's the one path
  // where a registrant types their own organization — so it has to rename too.
  it('renames on the self-registration path', async () => {
    await service.addMeetingRegistrantSelf(req, 'meeting-1', {
      meeting_id: 'meeting-1',
      email: 'a@example.com',
      first_name: 'A',
      last_name: 'B',
      org_name: 'Acme',
    });

    expect(bodyOf()).toMatchObject({ org: 'Acme' });
    expect(bodyOf()).not.toHaveProperty('org_name');
    expect(bodyOf()).not.toHaveProperty('meeting_id');
  });

  // ITX answers a write with `ITXZoomMeetingRegistrant`, which uses the upstream spelling. Without
  // the inverse rename the returned object satisfies `MeetingRegistrant` only nominally, and the
  // modal renders a just-saved registrant with no organization.
  it.each([
    ['create', (s: MeetingService) => s.addMeetingRegistrant(req, { meeting_id: 'm', email: 'a@example.com', first_name: 'A', last_name: 'B' })],
    ['update', (s: MeetingService) => s.updateMeetingRegistrant(req, 'm', 'r', { meeting_id: 'm', email: 'a@example.com', first_name: 'A', last_name: 'B' })],
    [
      'self-registration',
      (s: MeetingService) => s.addMeetingRegistrantSelf(req, 'm', { meeting_id: 'm', email: 'a@example.com', first_name: 'A', last_name: 'B' }),
    ],
  ])('maps the %s response back to the app spelling', async (_label, call) => {
    proxyRequest.mockResolvedValue({
      uid: 'reg-1',
      org: 'Acme',
      profile_picture: 'https://example.com/a.png',
      occurrence: '1666848600',
      modified_at: '2026-08-17T00:00:00Z',
    });

    const result = await call(service);

    expect(result).toMatchObject({
      uid: 'reg-1',
      org_name: 'Acme',
      avatar_url: 'https://example.com/a.png',
      occurrence_id: '1666848600',
      updated_at: '2026-08-17T00:00:00Z',
    });
    for (const upstreamKey of ['org', 'profile_picture', 'occurrence', 'modified_at']) {
      expect(result).not.toHaveProperty(upstreamKey);
    }
  });
});

/**
 * `encodePathSegment` guards every registrant path, but the guard is one call away from being
 * reverted to raw interpolation and nothing here would have gone red. These cases pin the
 * behaviour at the call sites rather than only on the helper: a slash or a space has to arrive
 * upstream percent-encoded, and a dot-only segment has to be refused outright before the request
 * is built, so `..` can never walk the ITX path.
 */
describe('MeetingService registrant paths reject hostile identifiers', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    proxyRequest.mockResolvedValue({});
    service = new MeetingService();
  });

  const pathOf = (): string => proxyRequest.mock.calls[0][2] as string;

  it('encodes a slash in the create path', async () => {
    await service.addMeetingRegistrant(req, { meeting_id: 'mtg/1', email: 'a@example.com', first_name: 'A', last_name: 'B' });

    expect(pathOf()).toBe('/itx/meetings/mtg%2F1/registrants');
  });

  it('encodes both identifiers in the update path', async () => {
    await service.updateMeetingRegistrant(req, 'mtg 1', 'reg/1', { meeting_id: 'mtg 1', email: 'a@example.com', first_name: 'A', last_name: 'B' });

    expect(pathOf()).toBe('/itx/meetings/mtg%201/registrants/reg%2F1');
  });

  it('encodes both identifiers in the delete path', async () => {
    await service.deleteMeetingRegistrant(req, 'mtg/1', 'reg 1');

    expect(pathOf()).toBe('/itx/meetings/mtg%2F1/registrants/reg%201');
  });

  it('encodes both identifiers in the resend path', async () => {
    await service.resendMeetingInvitation(req, 'mtg/1', 'reg/1');

    expect(pathOf()).toBe('/itx/meetings/mtg%2F1/registrants/reg%2F1/resend');
  });

  it('encodes the meeting id in the self-registration path', async () => {
    await service.addMeetingRegistrantSelf(req, 'mtg/1', { meeting_id: 'mtg/1', email: 'a@example.com', first_name: 'A', last_name: 'B' });

    expect(pathOf()).toBe('/itx/meetings/mtg%2F1/registrants/self');
  });

  it.each([['..'], ['.']])('refuses a %s meeting id before any request goes out', async (hostile) => {
    await expect(service.addMeetingRegistrant(req, { meeting_id: hostile, email: 'a@example.com', first_name: 'A', last_name: 'B' })).rejects.toThrow();

    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it.each([['..'], ['.']])('refuses a %s registrant id before any request goes out', async (hostile) => {
    await expect(service.deleteMeetingRegistrant(req, 'mtg-1', hostile)).rejects.toThrow();

    expect(proxyRequest).not.toHaveBeenCalled();
  });

  // The past-meeting participant writes interpolate the same way and were the three call sites still
  // reaching for bare `encodeURIComponent`. Encoding is the half those already had; refusing a
  // dot-only segment is the half only `encodePathSegment` adds, and it is the half that matters —
  // `%2E%2E` percent-decodes before the URL is normalized, so an encoded `..` traverses exactly as a
  // raw one does.
  it.each([
    ['create', (s: MeetingService, hostile: string) => s.createPastMeetingParticipant(req, hostile, {} as never)],
    ['update', (s: MeetingService, hostile: string) => s.updatePastMeetingParticipant(req, hostile, 'p-1', {} as never)],
    ['delete', (s: MeetingService, hostile: string) => s.deletePastMeetingParticipant(req, hostile, 'p-1')],
  ])('refuses a dot-only past meeting id on the participant %s path', async (_label, call) => {
    await expect(call(service, '..')).rejects.toThrow();

    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['update', (s: MeetingService, hostile: string) => s.updatePastMeetingParticipant(req, 'pm-1', hostile, {} as never)],
    ['delete', (s: MeetingService, hostile: string) => s.deletePastMeetingParticipant(req, 'pm-1', hostile)],
  ])('refuses a dot-only participant id on the participant %s path', async (_label, call) => {
    await expect(call(service, '..')).rejects.toThrow();

    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('still encodes a slash in the participant path', async () => {
    await service.updatePastMeetingParticipant(req, 'pm/1', 'p 1', {} as never);

    expect(pathOf()).toBe('/itx/past_meetings/pm%2F1/participants/p%201');
  });
});

describe('MeetingService.updateMeeting attendee visibility lock', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    proxyRequestWithResponse.mockReset();
    vi.mocked(getUsernameFromAuth).mockResolvedValue('alice');
    service = new MeetingService();
  });

  const baseUpdate = {
    project_uid: 'project-1',
    start_time: '2026-01-01T00:00:00Z',
    duration: 30,
    timezone: 'UTC',
    title: 'Test',
    description: '',
    show_meeting_attendees: true,
  };

  // An update body that makes no choice at all, which is the case upstream merges rather than replaces.
  const { show_meeting_attendees: baseChoice, ...baseUpdateWithoutChoice } = baseUpdate;

  it('forces show_meeting_attendees off for board meetings', async () => {
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Board', restricted: false, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdate, meeting_type: 'Board' });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(false);
  });

  it('forces show_meeting_attendees off when the stored meeting is restricted', async () => {
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Technical', restricted: true, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdate });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(false);
  });

  it('locks on the stored values as they actually arrive, untrimmed and stringified', async () => {
    // Neither field is validated between v1 and here, so the gate has to hold on the shapes the
    // proxy really returns rather than on canonical ones.
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Board ', restricted: 'true', organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdate });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(false);
  });

  it('does not let a blank meeting_type lift the lock off a board meeting', async () => {
    // `""` is not nullish, so a nullish-only fallback would compare against the empty string and
    // read a board meeting as unlocked — an unvalidated body must not be able to do that.
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Board', restricted: false, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdate, meeting_type: '' });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(false);
  });

  it('still locks a board meeting when the update explicitly clears restricted', async () => {
    // `restricted: false` is meaningful, not absent, so the resolution has to be nullish —
    // a truthiness fallback would read the stored `true` here and pass for the wrong reason.
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Board', restricted: true, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdate, restricted: false });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(false);
  });

  it("does not inherit a locked meeting's stale visibility when the update unlocks it", async () => {
    // Upstream preserves fields the body omits, so a legacy board row holding `true` would keep it
    // through an unlock that makes no choice, and the next invites would expose the guest list.
    expect(baseChoice).toBe(true);
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Board', restricted: false, show_meeting_attendees: true, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdateWithoutChoice, meeting_type: 'Technical' });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(false);
  });

  it('honors an explicit choice made on the update that unlocks the meeting', async () => {
    // The organizer may legitimately turn sharing on as part of the same edit that lifts the lock.
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Board', restricted: false, show_meeting_attendees: false, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdate, meeting_type: 'Technical' });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(true);
  });

  it('leaves an unlocked meeting alone when the update makes no choice', async () => {
    // Only the unlock transition drops the stored value; an ordinary partial update must not.
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Technical', restricted: false, show_meeting_attendees: true, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdateWithoutChoice });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBeUndefined();
  });

  it('forwards true when the meeting is unlocked', async () => {
    proxyRequest.mockResolvedValueOnce({ meeting_type: 'Technical', restricted: false, organizers: [] });
    proxyRequestWithResponse.mockResolvedValueOnce({});

    await service.updateMeeting(req, 'meeting-1', { ...baseUpdate, meeting_type: 'Technical', restricted: false });

    const payload = proxyRequestWithResponse.mock.calls[0][5];
    expect(payload.show_meeting_attendees).toBe(true);
  });
});

describe('MeetingService.createMeeting attendee visibility lock', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    vi.mocked(getUsernameFromAuth).mockResolvedValue('alice');
    service = new MeetingService();
  });

  const baseCreate = {
    project_uid: 'project-1',
    start_time: '2026-01-01T00:00:00Z',
    duration: 30,
    timezone: 'UTC',
    title: 'Test',
    description: '',
    show_meeting_attendees: true,
  };

  it('forces show_meeting_attendees off for board meetings', async () => {
    proxyRequest.mockResolvedValueOnce({ id: 'meeting-1' }).mockResolvedValueOnce({ id: 'meeting-1', meeting_type: 'Board' });

    await service.createMeeting(req, { ...baseCreate, meeting_type: 'Board' });

    expect(proxyRequest.mock.calls[0][5].show_meeting_attendees).toBe(false);
  });

  it('forces show_meeting_attendees off when restricted', async () => {
    proxyRequest.mockResolvedValueOnce({ id: 'meeting-1' }).mockResolvedValueOnce({ id: 'meeting-1', restricted: true });

    await service.createMeeting(req, { ...baseCreate, meeting_type: 'Technical', restricted: true });

    expect(proxyRequest.mock.calls[0][5].show_meeting_attendees).toBe(false);
  });
});
