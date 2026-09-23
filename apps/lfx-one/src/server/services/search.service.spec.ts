// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service imports the shared `utils` barrel, which statically pulls in `@angular/forms`; under
// vitest's plain Node runtime that needs the JIT compiler loaded first (as `formation.service.spec.ts` does).
import '@angular/compiler';

import type { CommitteeMember, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyRequest = vi.fn();

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = (...args: unknown[]) => proxyRequest(...args);
  },
}));

import { SearchService } from './search.service';

function member(overrides: Partial<CommitteeMember>): CommitteeMember {
  return {
    uid: 'member:1',
    email: 'kim.park@partner-corp.example',
    first_name: 'Kim',
    last_name: 'Park',
    job_title: 'Counsel',
    organization: { name: 'Partner Corp', website: 'https://partner-corp.example' },
    committee_uid: 'committee:1',
    committee_name: 'Governing Board',
    username: 'kim.park',
    ...overrides,
  } as unknown as CommitteeMember;
}

function upstream(members: CommitteeMember[]): QueryServiceResponse<CommitteeMember> {
  return { resources: members.map((data) => ({ data })) } as unknown as QueryServiceResponse<CommitteeMember>;
}

describe('SearchService (server)', () => {
  const req = {} as Request;
  let service: SearchService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new SearchService();
  });

  it('forwards a name typeahead with best_match ordering to the query service', async () => {
    proxyRequest.mockResolvedValue(upstream([]));

    await service.searchUsers(req, { name: 'kim', type: 'committee_member', sort: 'best_match' });

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      name: 'kim',
      sort: 'best_match',
      type: 'committee_member',
    });
  });

  it('forwards an exact email tag lookup without a sort', async () => {
    proxyRequest.mockResolvedValue(upstream([]));

    await service.searchUsers(req, { tags: 'email:kim.park@partner-corp.example', type: 'committee_member' });

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      tags: 'email:kim.park@partner-corp.example',
      type: 'committee_member',
    });
  });

  it('maps committee members and collapses repeated memberships of the same person', async () => {
    proxyRequest.mockResolvedValue(
      upstream([
        member({}),
        member({ uid: 'member:2', committee_uid: 'committee:2', committee_name: 'TOC' }),
        member({ uid: 'member:3', username: '', email: 'pat@partner-corp.example', first_name: 'Pat', last_name: 'Lee', organization: undefined }),
      ])
    );

    const response = await service.searchUsers(req, { name: 'p', type: 'committee_member', sort: 'best_match' });

    expect(response.total).toBe(2);
    expect(response.results[0]).toEqual({
      uid: 'member:1',
      email: 'kim.park@partner-corp.example',
      first_name: 'Kim',
      last_name: 'Park',
      job_title: 'Counsel',
      organization: { name: 'Partner Corp', website: 'https://partner-corp.example' },
      committee: { uid: 'committee:1', name: 'Governing Board' },
      type: 'committee_member',
      username: 'kim.park',
    });
    expect(response.results[1]).toEqual(expect.objectContaining({ uid: 'member:3', username: null, organization: null }));
  });
});
