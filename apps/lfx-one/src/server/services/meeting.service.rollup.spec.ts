// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers the GH-5566 roll-up wiring only: that `root_project_uid` resolves the project tree with the
// caller's own request and reaches query-service as a `filters_or` scope, for both meeting indexes.
const { proxyRequest, getFoundationProjectUids, withPerUserCache } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getFoundationProjectUids: vi.fn(),
  withPerUserCache: vi.fn((_ns: string, _user: string, _root: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));

// The utils barrel reaches Angular-only modules; this spec needs the two normalizers getMeetings calls and
// the real identifier checks single-flight uses to decide whether a fetch may be shared.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<typeof import('@lfx-one/shared/utils/org-selector.utils')>('@lfx-one/shared/utils/org-selector.utils')),
  normalizeIndexedMeetingAiSummary: (meeting: unknown) => meeting,
  normalizeIndexedMeetingInviteResponses: (meeting: unknown) => meeting,
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getFoundationProjectUids = getFoundationProjectUids;
    public enrichWithProjectData = async (_req: unknown, meetings: unknown[]) => meetings;
  },
}));
vi.mock('./valkey.service', () => ({ withPerUserCache }));
vi.mock('./access-check.service', () => ({ AccessCheckService: class {} }));
vi.mock('./committee.service', () => ({ CommitteeService: class {} }));
vi.mock('./user-verified-emails.service', () => ({ UserVerifiedEmailsService: class {} }));
vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'jdoe'),
  getUsernameFromAuth: vi.fn(),
  stripAuthPrefix: (v: string) => v,
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn() }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { resetSingleFlightForTests } from '../utils/single-flight';
import { MeetingService } from './meeting.service';

const req = { id: 'caller' } as unknown as Request;
const ROOT = 'foundation-uid';

describe('MeetingService roll-up scope', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    getFoundationProjectUids.mockReset().mockResolvedValue([ROOT, 'child-uid']);
    withPerUserCache.mockClear();
    resetSingleFlightForTests();
    service = new MeetingService();
  });

  it.each(['v1_meeting', 'v1_past_meeting'] as const)('scopes the %s list to every project in the tree', async (type) => {
    proxyRequest.mockResolvedValue({ resources: [], page_token: 'next' });

    const result = await service.getMeetings(req, { root_project_uid: ROOT, page_token: 'p1', filters: ['meeting_type:Technical'] }, type, false);

    expect(getFoundationProjectUids).toHaveBeenCalledWith(req, ROOT);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      page_token: 'p1',
      filters: ['meeting_type:Technical'],
      filters_or: [`project_uid:${ROOT}`, 'project_uid:child-uid'],
      type,
    });
    expect(result.page_token).toBe('next');
  });

  it('scopes the count the same way, through the per-user scope cache', async () => {
    proxyRequest.mockResolvedValue({ count: 7 });

    const count = await service.getMeetingsCount(req, { root_project_uid: ROOT }, 'v1_past_meeting');

    expect(count).toBe(7);
    expect(withPerUserCache).toHaveBeenCalledWith('meeting-rollup-scope:v1', 'jdoe', ROOT, 300, expect.any(Function), expect.any(Function));
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', {
      filters_or: [`project_uid:${ROOT}`, 'project_uid:child-uid'],
      type: 'v1_past_meeting',
    });
  });

  it('passes a query without the roll-up param through unchanged', async () => {
    proxyRequest.mockResolvedValue({ count: 1 });

    await service.getMeetingsCount(req, { tags: 'project_uid:single' }, 'v1_meeting');

    expect(getFoundationProjectUids).not.toHaveBeenCalled();
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', { tags: 'project_uid:single', type: 'v1_meeting' });
  });

  it('rejects a malformed root before any upstream call', async () => {
    await expect(service.getMeetingsCount(req, { root_project_uid: 'a:b' }, 'v1_meeting')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(getFoundationProjectUids).not.toHaveBeenCalled();
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});
