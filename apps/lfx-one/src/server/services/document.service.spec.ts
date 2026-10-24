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

describe('DocumentService.getCommitteeDocumentCount', () => {
  const req = { bearerToken: 'user-token' } as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sums the count of every document source for the committee', async () => {
    proxyRequestMock.mockResolvedValue({ count: 2, has_more: false });

    const total = await new DocumentService().getCommitteeDocumentCount(req, COMMITTEE_UID);

    const calls = proxyRequestMock.mock.calls.map((call) => ({ path: call[2], params: call[4] as Record<string, unknown> }));
    expect(calls.every((call) => call.path === '/query/resources/count')).toBe(true);
    expect(calls.map((call) => call.params['type'])).toEqual([
      'committee_link',
      'committee_document',
      'groupsio_artifact',
      'v1_meeting_attachment',
      'v1_past_meeting_attachment',
      'v1_past_meeting_recording',
      'v1_past_meeting_transcript',
      'v1_past_meeting_summary',
    ]);
    expect(calls[0].params['tags']).toBe(`committee_uid:${COMMITTEE_UID}`);
    expect(calls[7].params['parent']).toBe(`committee:${COMMITTEE_UID}`);
    expect(total).toBe(16);
  });

  it('throws when a source fails, so a partial total is never presented as exact', async () => {
    proxyRequestMock.mockImplementation(async (_req: Request, _service: string, _path: string, _method: string, params: Record<string, unknown>) => {
      if (params['type'] === 'v1_past_meeting_recording') throw new Error('upstream unavailable');
      return { count: 1, has_more: false };
    });

    await expect(new DocumentService().getCommitteeDocumentCount(req, COMMITTEE_UID)).rejects.toThrow('upstream unavailable');
  });

  it('throws when a source reports an incomplete count', async () => {
    proxyRequestMock.mockImplementation(async (_req: Request, _service: string, _path: string, _method: string, params: Record<string, unknown>) => ({
      count: 1,
      has_more: params['type'] === 'groupsio_artifact',
    }));

    await expect(new DocumentService().getCommitteeDocumentCount(req, COMMITTEE_UID)).rejects.toThrow('incomplete');
  });

  it('returns a genuine zero when every source reports zero', async () => {
    proxyRequestMock.mockResolvedValue({ count: 0, has_more: false });

    await expect(new DocumentService().getCommitteeDocumentCount(req, COMMITTEE_UID)).resolves.toBe(0);
  });
});

describe('DocumentService.getMyDocuments — meeting summaries', () => {
  const req = { bearerToken: 'user-token' } as unknown as Request;
  const baseSummary = { meeting_id: 'meeting-1', meeting_and_occurrence_id: 'meeting-1-occ-1', created_at: '2026-10-14T12:00:00Z' };

  const summariesFetch = (rows: Record<string, unknown>[]) =>
    fetchAllQueryResourcesMock.mockImplementation(async (_req: Request, fetchPage: (pageToken?: string) => Promise<unknown>) => {
      // fetchPage issues its proxy call synchronously, so read it before yielding to the other parallel fetchers.
      const pending = fetchPage();
      const type = (proxyRequestMock.mock.calls.at(-1)?.[4] as Record<string, unknown>)['type'];
      await pending;
      return type === 'v1_past_meeting_summary' ? rows : [];
    });

  beforeEach(() => {
    vi.clearAllMocks();
    getMyCommitteesMock.mockResolvedValue([]);
    getPastMeetingOccurrenceIdsMock.mockResolvedValue([]);
    proxyRequestMock.mockResolvedValue({ resources: [] });
  });

  it('falls back to content when edited_content is an empty string (an unedited summary)', async () => {
    summariesFetch([{ ...baseSummary, id: 'unedited', content: '# Notes', edited_content: '' }]);

    const [summary] = await new DocumentService().getMyDocuments(req, { committee_uid: COMMITTEE_UID });

    expect(summary.source).toBe('summary');
    expect(summary.summaryContent).toBe('# Notes');
  });

  it('prefers edited_content when the summary was edited', async () => {
    summariesFetch([{ ...baseSummary, id: 'edited', content: '# Notes', edited_content: '# Edited notes' }]);

    const [summary] = await new DocumentService().getMyDocuments(req, { committee_uid: COMMITTEE_UID });

    expect(summary.summaryContent).toBe('# Edited notes');
  });
});
