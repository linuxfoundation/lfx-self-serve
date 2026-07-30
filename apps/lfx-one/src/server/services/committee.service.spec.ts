// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Committee, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts / meeting.service.spec.ts: the `@lfx-one/shared/*` alias isn't
// wired into this app's vitest config, so runtime (non-type-only) imports need stubs.
const { proxyRequest, addAccessToResources, resolveAuditUserDisplayName } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  addAccessToResources: vi.fn(),
  resolveAuditUserDisplayName: vi.fn(),
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
vi.mock('../helpers/query-service.helper', () => ({
  fetchAllQueryResources: vi.fn(),
}));
vi.mock('../utils/auth-helper', () => ({ resolveAuditUserDisplayName, getUsernameFromAuth: vi.fn() }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { CommitteeService } from './committee.service';

const req = {} as unknown as Request;

function pageOf(committees: Partial<Committee>[], pageToken?: string): QueryServiceResponse<Committee> {
  return { resources: committees.map((c) => ({ id: `committee:${c.uid}`, data: c as Committee })), page_token: pageToken } as QueryServiceResponse<Committee>;
}

describe('CommitteeService — create picker methods', () => {
  let service: CommitteeService;

  beforeEach(() => {
    proxyRequest.mockReset();
    addAccessToResources.mockReset();
    resolveAuditUserDisplayName.mockReset();
    vi.mocked(fetchAllQueryResources).mockReset();
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

    it('continues to the next page when the first page has no writer-permitted matches', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'visible-only' }], 'token-2'));
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'inherited-writer' }]));
      addAccessToResources.mockImplementation((_req: Request, committees: Committee[]) =>
        Promise.resolve(committees.map((c) => ({ ...c, writer: c.uid === 'inherited-writer' })))
      );

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result.map((c) => c.uid)).toEqual(['inherited-writer']);
      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(proxyRequest.mock.calls[1][4]).toMatchObject({ page_token: 'token-2' });
    });

    it('stops paging once the page cap is reached, even if pages remain', async () => {
      proxyRequest.mockResolvedValue(pageOf([{ uid: 'no-match' }], 'more'));
      addAccessToResources.mockImplementation((_req: Request, committees: Committee[]) => Promise.resolve(committees.map((c) => ({ ...c, writer: false }))));

      const result = await service.searchCreatableCommittees(req, 'security');

      expect(result).toEqual([]);
      expect(proxyRequest).toHaveBeenCalledTimes(5);
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

describe('CommitteeService — getCommitteeDocuments', () => {
  let service: CommitteeService;

  beforeEach(() => {
    proxyRequest.mockReset();
    resolveAuditUserDisplayName.mockReset();
    vi.mocked(fetchAllQueryResources).mockReset();
    resolveAuditUserDisplayName.mockReturnValue('Resolved Display Name');
    service = new CommitteeService();
  });

  it('threads resolveAuditUserDisplayName into uploaded_by for folders, links, and files', async () => {
    proxyRequest
      .mockResolvedValueOnce([{ uid: 'folder-1', name: 'Folder', created_by: { name: 'Ada Lovelace' }, committee_uid: 'committee-1' }])
      .mockResolvedValueOnce([
        { uid: 'link-1', name: 'Link', url: 'https://example.com', created_by: { name: 'Bob Builder' }, committee_uid: 'committee-1' },
      ]);
    vi.mocked(fetchAllQueryResources).mockResolvedValueOnce([
      {
        uid: 'file-1',
        name: 'File',
        content_type: 'application/pdf',
        created_by: { name: 'Carol Danvers' },
        uploaded_by_username: 'legacyuser',
        committee_uid: 'committee-1',
      },
    ]);

    const result = await service.getCommitteeDocuments(req, 'committee-1');

    expect(result).toHaveLength(3);
    expect(result.every((doc) => doc.uploaded_by === 'Resolved Display Name')).toBe(true);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledTimes(3);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledWith({ name: 'Ada Lovelace' }, undefined);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledWith({ name: 'Bob Builder' }, undefined);
    expect(resolveAuditUserDisplayName).toHaveBeenCalledWith({ name: 'Carol Danvers' }, 'legacyuser');
  });
});
