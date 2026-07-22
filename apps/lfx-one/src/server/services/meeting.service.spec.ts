// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting, MeetingUserInfo, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here, so runtime shared subpaths and the constructed collaborators must be
// mocked (mirrors session-store.service.spec.ts / meeting.helper.spec.ts). Only the
// microservice-proxy call path is exercised; the query-service pagination helper runs for real.
const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

vi.mock('@lfx-one/shared/enums', () => ({}));
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
vi.mock('./access-check.service', () => ({ AccessCheckService: class {} }));
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

import { MeetingService } from './meeting.service';

const req = {} as any;
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

  it('maps meeting uid → created_by from the v1_meeting index', async () => {
    proxyRequest.mockResolvedValueOnce(
      pageOf([
        { id: 'a', created_by: human('a') },
        { id: 'b', created_by: human('b') },
      ])
    );

    const result = await service.resolveCreatedByForMeetings(req, ['a', 'b']);

    expect(result.get('a')).toEqual(human('a'));
    expect(result.get('b')).toEqual(human('b'));
    // Single chunk → single query; the tags param carries the batched OR list.
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'v1_meeting', tags: ['a', 'b'] });
  });

  it('dedupes repeated uids before querying', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ id: 'a', created_by: human('a') }]));

    await service.resolveCreatedByForMeetings(req, ['a', 'a', 'a']);

    expect(proxyRequest.mock.calls[0][4]).toMatchObject({ tags: ['a'] });
  });

  it('omits meetings that carry no created_by', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ id: 'a', created_by: human('a') }, { id: 'b' }]));

    const result = await service.resolveCreatedByForMeetings(req, ['a', 'b']);

    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false);
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
