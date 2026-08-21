// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting, MeetingRegistrant, MeetingUserInfo, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here, so runtime shared subpaths and the constructed collaborators must be
// mocked (mirrors session-store.service.spec.ts / meeting.helper.spec.ts). Only the
// microservice-proxy call path is exercised; the query-service pagination helper runs for real.
const { proxyRequest, committeeSvc, accessCheckSvc } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  committeeSvc: { getCommitteeById: vi.fn() },
  accessCheckSvc: { checkSingleAccess: vi.fn() },
}));

vi.mock('@lfx-one/shared/enums', async (importOriginal) => importOriginal());
vi.mock('@lfx-one/shared/utils', () => ({
  buildRecurrenceNeverEndDate: vi.fn(),
  getPastMeetingTranscriptUrl: vi.fn(),
  mapITXResponseToMeetingRsvp: vi.fn(),
  normalizeIndexedMeetingAiSummary: vi.fn(),
  selectPrimaryPastMeetingSummary: vi.fn(),
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
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

import { MeetingService } from './meeting.service';

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
});

describe('MeetingService.getMeetingRegistrantCounts', () => {
  let service: MeetingService;

  const MEETING_UID = 'meeting-1';
  const M2M_TOKEN = 'm2m-token';

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new MeetingService();
  });

  it('splits the total into individual/committee counts and reports exhaustive when neither query has more', async () => {
    proxyRequest.mockResolvedValueOnce({ count: 10, has_more: false }).mockResolvedValueOnce({ count: 3, has_more: false });

    const result = await service.getMeetingRegistrantCounts(req, MEETING_UID, M2M_TOKEN);

    expect(result).toEqual({ individual_registrants_count: 7, committee_members_count: 3, exhaustive: true });
  });

  it('falls back to total-only, non-exhaustive, when the committee sub-count rejects', async () => {
    proxyRequest.mockResolvedValueOnce({ count: 10, has_more: false }).mockRejectedValueOnce(new Error('query service down'));

    const result = await service.getMeetingRegistrantCounts(req, MEETING_UID, M2M_TOKEN);

    expect(result).toEqual({ individual_registrants_count: 10, committee_members_count: 0, exhaustive: false });
  });

  it('reports exhaustive: false when either count call reports has_more', async () => {
    proxyRequest.mockResolvedValueOnce({ count: 10, has_more: true }).mockResolvedValueOnce({ count: 3, has_more: false });

    const result = await service.getMeetingRegistrantCounts(req, MEETING_UID, M2M_TOKEN);

    expect(result.exhaustive).toBe(false);
  });

  it('propagates the error instead of returning a zero count when the total query rejects', async () => {
    proxyRequest.mockRejectedValueOnce(new Error('query service down')).mockResolvedValueOnce({ count: 3, has_more: false });

    await expect(service.getMeetingRegistrantCounts(req, MEETING_UID, M2M_TOKEN)).rejects.toThrow('query service down');
  });

  it('sends the committee filter without page_size, and carries the M2M token as the Authorization header', async () => {
    proxyRequest.mockResolvedValueOnce({ count: 10, has_more: false }).mockResolvedValueOnce({ count: 3, has_more: false });

    await service.getMeetingRegistrantCounts(req, MEETING_UID, M2M_TOKEN);

    expect(proxyRequest).toHaveBeenCalledTimes(2);

    const [, , totalPath, totalMethod, totalParams, , totalHeaders] = proxyRequest.mock.calls[0];
    expect(totalPath).toBe('/query/resources/count');
    expect(totalMethod).toBe('GET');
    expect(totalParams).toMatchObject({ type: 'v1_meeting_registrant', parent: `meeting:${MEETING_UID}` });
    expect(totalParams.page_size).toBeUndefined();
    expect(totalHeaders).toEqual({ Authorization: `Bearer ${M2M_TOKEN}` });

    const [, , , , committeeParams] = proxyRequest.mock.calls[1];
    expect(committeeParams).toMatchObject({ filters: ['type:committee'] });
    expect(committeeParams.page_size).toBeUndefined();
  });
});
