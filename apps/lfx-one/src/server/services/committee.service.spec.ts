// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Committee, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts / meeting.service.spec.ts: the `@lfx-one/shared/*` alias isn't
// wired into this app's vitest config, so runtime (non-type-only) imports need stubs.
const { proxyRequest, addAccessToResources } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  addAccessToResources: vi.fn(),
}));

vi.mock('@lfx-one/shared/enums', () => ({ CommitteeMemberRole: {} }));
vi.mock('@lfx-one/shared/utils', () => ({ invitationRequiresOrganization: vi.fn() }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public addAccessToResources = addAccessToResources;
  },
}));
vi.mock('./etag.service', () => ({ ETagService: class {} }));
vi.mock('./project.service', () => ({ ProjectService: class {} }));
vi.mock('../utils/auth-helper', () => ({ cleanUserDisplayName: vi.fn(), getUsernameFromAuth: vi.fn() }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { CommitteeService } from './committee.service';

const req = {} as unknown as Request;

function pageOf(committees: Partial<Committee>[]): QueryServiceResponse<Committee> {
  return { resources: committees.map((c) => ({ id: `committee:${c.uid}`, data: c as Committee })), page_token: undefined } as QueryServiceResponse<Committee>;
}

describe('CommitteeService — create picker methods', () => {
  let service: CommitteeService;

  beforeEach(() => {
    proxyRequest.mockReset();
    addAccessToResources.mockReset();
    service = new CommitteeService();
  });

  describe('getDirectGrantCommittees', () => {
    it('queries filter_grants=direct and returns only writer-permitted committees', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'a' }, { uid: 'b' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, committees: Committee[]) =>
        Promise.resolve(committees.map((c) => ({ ...c, writer: c.uid === 'a' })))
      );

      const result = await service.getDirectGrantCommittees(req);

      expect(result.map((c) => c.uid)).toEqual(['a']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'committee', filter_grants: 'direct' });
    });
  });

  describe('searchCreatableCommittees', () => {
    it('queries name=<term> with a small page size and filters to writer-permitted matches', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'match-1' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, committees: Committee[]) => Promise.resolve(committees.map((c) => ({ ...c, writer: true }))));

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result.map((c) => c.uid)).toEqual(['match-1']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'committee', name: 'security', page_size: 20 });
    });

    it('excludes non-writer matches even when the query service returns them', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'writer-committee' }, { uid: 'inherited-not-writer' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, committees: Committee[]) =>
        Promise.resolve(committees.map((c) => ({ ...c, writer: c.uid === 'writer-committee' })))
      );

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result.map((c) => c.uid)).toEqual(['writer-committee']);
    });
  });

  it('never issues a type=committee query-service call without filter_grants or name', async () => {
    proxyRequest.mockResolvedValue(pageOf([]));
    addAccessToResources.mockImplementation((_req: Request, committees: Committee[]) => Promise.resolve(committees));

    await service.getDirectGrantCommittees(req);
    await service.searchCreatableCommittees(req, 'term');

    const paramsSent = proxyRequest.mock.calls.filter((call) => call[4]?.type === 'committee').map((call) => call[4]);
    expect(paramsSent.length).toBeGreaterThan(0);
    for (const params of paramsSent) {
      expect(params['filter_grants'] === 'direct' || typeof params['name'] === 'string').toBe(true);
    }
  });
});
