// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const COMMITTEE_UID = 'committee-1111';

const { getMyCommitteesMock, getPastMeetingOccurrenceIdsMock, proxyRequestMock, fetchAllQueryResourcesMock } = vi.hoisted(() => ({
  getMyCommitteesMock: vi.fn(),
  getPastMeetingOccurrenceIdsMock: vi.fn(),
  proxyRequestMock: vi.fn(),
  fetchAllQueryResourcesMock: vi.fn(),
}));

vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getMyCommittees = getMyCommitteesMock;
  },
}));

vi.mock('./user.service', () => ({
  UserService: class {
    public getPastMeetingOccurrenceIds = getPastMeetingOccurrenceIdsMock;
    public getUserRegisteredMeetingIds = vi.fn().mockResolvedValue(new Set<string>());
  },
}));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequestMock;
  },
}));

vi.mock('../helpers/query-service.helper', () => ({
  fetchAllQueryResources: fetchAllQueryResourcesMock,
}));

vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: vi.fn().mockReturnValue('user@example.com'),
}));

vi.mock('./logger.service', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { DocumentService } from './document.service';

describe('DocumentService.getMyDocuments — committee-scoped request from a non-member', () => {
  const req = { bearerToken: 'user-token' } as unknown as Request;
  let queriedTypes: string[];
  let queriedParams: Record<string, unknown>[];

  beforeEach(() => {
    vi.clearAllMocks();
    queriedTypes = [];
    queriedParams = [];

    // The caller belongs to no committees.
    getMyCommitteesMock.mockResolvedValue([]);
    getPastMeetingOccurrenceIdsMock.mockResolvedValue([]);

    // Run each fetcher's page callback so the query params it builds are captured; every query returns no rows.
    proxyRequestMock.mockImplementation(async (_req: Request, _service: string, _path: string, _method: string, params: Record<string, unknown>) => {
      queriedTypes.push(params['type'] as string);
      queriedParams.push(params);
      return { resources: [] };
    });
    fetchAllQueryResourcesMock.mockImplementation(async (_req: Request, fetchPage: (pageToken?: string) => Promise<unknown>) => {
      await fetchPage();
      return [];
    });
  });

  it('issues no committee_link query because committee links come from the caller memberships', async () => {
    const result = await new DocumentService().getMyDocuments(req, { committee_uid: COMMITTEE_UID });

    expect(result).toEqual([]);
    expect(queriedTypes).not.toContain('committee_link');
  });

  it('still queries meeting and mailing list sources by the committee ref, with the caller request', async () => {
    await new DocumentService().getMyDocuments(req, { committee_uid: COMMITTEE_UID });

    expect(queriedTypes).toEqual(
      expect.arrayContaining([
        'groupsio_artifact',
        'v1_meeting_attachment',
        'v1_past_meeting_attachment',
        'v1_past_meeting_recording',
        'v1_past_meeting_transcript',
        'v1_past_meeting_summary',
      ])
    );
    expect(queriedParams.find((p) => p['type'] === 'groupsio_artifact')?.['tags']).toBe(`committee_uid:${COMMITTEE_UID}`);
    expect(queriedParams.find((p) => p['type'] === 'v1_past_meeting_summary')?.['parent']).toBe(`committee:${COMMITTEE_UID}`);

    // Every upstream call is made with the caller's own request (user bearer token), never an M2M override.
    for (const call of proxyRequestMock.mock.calls) {
      expect(call[0]).toBe(req);
      expect(call).toHaveLength(5);
    }
  });
});
