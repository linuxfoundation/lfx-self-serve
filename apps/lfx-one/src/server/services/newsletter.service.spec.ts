// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectFunding } from '@lfx-one/shared/enums';
import type { CommitteeNewsletter, CommitteeNewsletterListResponse, Project } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirror meeting.service.spec.ts: isolate constructed collaborators at the module boundary.
// The pure project classifier is real, resolved by the server Vitest alias.
const { listCommitteeNewsletters, getMyCommitteeUids, getProjectsByIds } = vi.hoisted(() => ({
  listCommitteeNewsletters: vi.fn(),
  getMyCommitteeUids: vi.fn(),
  getProjectsByIds: vi.fn(),
}));

vi.mock('./newsletter-service.client', () => ({
  NewsletterServiceClient: class {
    public listCommitteeNewsletters = listCommitteeNewsletters;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getMyCommitteeUids = getMyCommitteeUids;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectsByIds = getProjectsByIds;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { NewsletterService } from './newsletter.service';

const req = {} as unknown as Request;

function newsletter(id: string, sentAt: string): CommitteeNewsletter {
  return { id, project_uid: `project-${id}`, subject: `Subject ${id}`, sent_at: sentAt };
}

function pageOf(newsletters: CommitteeNewsletter[], nextPageToken?: string): CommitteeNewsletterListResponse {
  return { newsletters, ...(nextPageToken && { next_page_token: nextPageToken }) };
}

describe('NewsletterService.getMyNewsletters', () => {
  let service: NewsletterService;

  beforeEach(() => {
    listCommitteeNewsletters.mockReset();
    getMyCommitteeUids.mockReset();
    getProjectsByIds.mockReset().mockResolvedValue(new Map());
    service = new NewsletterService();
  });

  it('returns an empty list without upstream calls when the user has no committees', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set());

    const result = await service.getMyNewsletters(req);

    expect(result).toEqual({ newsletters: [], complete: true });
    expect(getMyCommitteeUids).toHaveBeenCalledWith(req, undefined, { failOnPartial: true });
    expect(listCommitteeNewsletters).not.toHaveBeenCalled();
    expect(getProjectsByIds).not.toHaveBeenCalled();
  });

  it('dedupes newsletters reachable via multiple committees and sorts by sent_at descending', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set(['committee-a', 'committee-b']));
    const shared = newsletter('n1', '2026-07-01T12:00:00Z');
    const older = newsletter('n2', '2026-06-01T12:00:00Z');
    const newest = newsletter('n3', '2026-07-15T12:00:00Z');
    listCommitteeNewsletters.mockImplementation(async (_req: Request, committeeUid: string) => {
      if (committeeUid === 'committee-a') return pageOf([shared, newest]);
      return pageOf([shared, older]);
    });

    const result = await service.getMyNewsletters(req);

    expect(result.newsletters.map((n) => n.id)).toEqual(['n3', 'n1', 'n2']);
    expect(result.complete).toBe(true);
    expect(listCommitteeNewsletters).toHaveBeenCalledTimes(2);
    expect(getProjectsByIds).toHaveBeenCalledTimes(1);
  });

  it('follows next_page_token until the upstream list is exhausted', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set(['committee-a']));
    listCommitteeNewsletters
      .mockResolvedValueOnce(pageOf([newsletter('n1', '2026-07-01T12:00:00Z')], 'token-2'))
      .mockResolvedValueOnce(pageOf([newsletter('n2', '2026-06-01T12:00:00Z')]));

    const result = await service.getMyNewsletters(req);

    expect(result.newsletters.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(result.complete).toBe(true);
    expect(listCommitteeNewsletters).toHaveBeenCalledTimes(2);
    expect(listCommitteeNewsletters).toHaveBeenNthCalledWith(2, req, 'committee-a', 'token-2');
  });

  it('skips a failing committee and still returns the others', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set(['committee-a', 'committee-b']));
    listCommitteeNewsletters.mockImplementation(async (_req: Request, committeeUid: string) => {
      if (committeeUid === 'committee-a') throw new Error('403 from gateway');
      return pageOf([newsletter('n1', '2026-07-01T12:00:00Z')]);
    });

    const result = await service.getMyNewsletters(req);

    expect(result.newsletters.map((n) => n.id)).toEqual(['n1']);
    expect(result.complete).toBe(false); // Message strings never establish a structured 403.
  });

  it('drops all pages for a committee when a later page fails (all-or-nothing)', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set(['committee-a', 'committee-b']));
    listCommitteeNewsletters.mockImplementation(async (_req: Request, committeeUid: string, pageToken?: string) => {
      if (committeeUid === 'committee-a') {
        if (!pageToken) return pageOf([newsletter('n1', '2026-07-01T12:00:00Z')], 'token-2');
        throw new Error('upstream 500 on page 2');
      }
      return pageOf([newsletter('n2', '2026-06-01T12:00:00Z')]);
    });

    const result = await service.getMyNewsletters(req);

    // committee-a's page 1 must not leak through as a silently incomplete result.
    expect(result.newsletters.map((n) => n.id)).toEqual(['n2']);
    expect(result.complete).toBe(false);
  });

  it('propagates discovery failure before issuing committee reads', async () => {
    const error = new Error('membership page failed');
    getMyCommitteeUids.mockRejectedValue(error);
    await expect(service.getMyNewsletters(req)).rejects.toBe(error);
    expect(listCommitteeNewsletters).not.toHaveBeenCalled();
  });

  it('reports successful empty committee reads as complete', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set(['a']));
    listCommitteeNewsletters.mockResolvedValue(pageOf([]));
    await expect(service.getMyNewsletters(req)).resolves.toEqual({ newsletters: [], complete: true });
  });

  it.each([403, 404, 429, 500, 503])('classifies structured %s and discards earlier pages while retaining healthy rows', async (status) => {
    getMyCommitteeUids.mockResolvedValue(new Set(['a', 'b']));
    listCommitteeNewsletters.mockImplementation(async (_req: Request, uid: string, token?: string) => {
      if (uid === 'b') return pageOf([newsletter('healthy', '2026-07-01')]);
      if (!token) return pageOf([newsletter('discarded', '2026-07-02')], 'next');
      throw new MicroserviceError('upstream failure', status, 'UPSTREAM_ERROR');
    });
    const result = await service.getMyNewsletters(req);
    expect(result.newsletters.map((row) => row.id)).toEqual(['healthy']);
    expect(result.complete).toBe(status === 403 || status === 404);
  });

  it.each([new Error('transport failure'), new MicroserviceError('rate limit', 429, 'RATE_LIMITED')])(
    'reports failed zero-row enumeration as incomplete',
    async (error) => {
      getMyCommitteeUids.mockResolvedValue(new Set(['a']));
      listCommitteeNewsletters.mockRejectedValue(error);
      await expect(service.getMyNewsletters(req)).resolves.toEqual({ newsletters: [], complete: false });
    }
  );

  it('rethrows structured 401, including after a successful page', async () => {
    const error = new MicroserviceError('expired', 401, 'UNAUTHORIZED');
    getMyCommitteeUids.mockResolvedValue(new Set(['a']));
    listCommitteeNewsletters.mockResolvedValueOnce(pageOf([newsletter('n1', '2026-07-01')], 'next')).mockRejectedValueOnce(error);
    await expect(service.getMyNewsletters(req)).rejects.toBe(error);
    expect(getProjectsByIds).not.toHaveBeenCalled();
  });

  it('preserves bounded rows and marks the 20-page cap incomplete only with an outstanding cursor', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set(['a']));
    listCommitteeNewsletters.mockResolvedValue(pageOf([newsletter('n1', '2026-07-01')], 'more'));
    const capped = await service.getMyNewsletters(req);
    expect(capped.newsletters).toHaveLength(1);
    expect(capped.complete).toBe(false);
    expect(listCommitteeNewsletters).toHaveBeenCalledTimes(20);
    listCommitteeNewsletters.mockReset().mockImplementation(async () => pageOf([], listCommitteeNewsletters.mock.calls.length < 20 ? 'more' : undefined));
    expect((await service.getMyNewsletters(req)).complete).toBe(true);
  });

  it('batches unique owners then unresolved direct parents, reuses owners, and classifies real metadata', async () => {
    const project = (uid: string, overrides: Partial<Project> = {}) => ({ uid, name: uid, slug: uid, ...overrides }) as Project;
    const foundation = project('foundation', { stage: 'Active', funding: ProjectFunding.Funded, funding_model: ['Membership'] });
    const owners = [
      foundation,
      project('child', { parent_uid: 'foundation' }),
      project('other', { parent_uid: 'parent' }),
      project('root-child', { parent_uid: 'root' }),
    ];
    getMyCommitteeUids.mockResolvedValue(new Set(['a']));
    listCommitteeNewsletters.mockResolvedValue(
      pageOf(['foundation', 'child', 'other', 'root-child', 'missing'].map((id) => ({ ...newsletter(id, '2026-07-01'), project_uid: id })))
    );
    getProjectsByIds
      .mockResolvedValueOnce(new Map(owners.map((owner) => [owner.uid, owner])))
      .mockResolvedValueOnce(new Map([['parent', project('parent', { parent_uid: 'ancestor' })]]));
    const result = await service.getMyNewsletters(req);
    expect(getProjectsByIds).toHaveBeenNthCalledWith(1, req, ['foundation', 'child', 'other', 'root-child', 'missing']);
    expect(getProjectsByIds).toHaveBeenNthCalledWith(2, req, new Set(['parent', 'root']));
    expect(getProjectsByIds).toHaveBeenCalledTimes(2);
    expect(result.newsletters[0]).toMatchObject({ project_name: 'foundation', project_slug: 'foundation', is_foundation: true });
    expect(result.newsletters[1]).toMatchObject({
      parent_project_uid: 'foundation',
      parent_project_name: 'foundation',
      parent_is_foundation: true,
      is_foundation: false,
    });
    expect(result.newsletters[2]).toMatchObject({ parent_project_name: 'parent', parent_is_foundation: false });
    expect(result.newsletters[3]).not.toHaveProperty('parent_is_foundation'); // ROOT excluded by ProjectService.
    expect(result.newsletters[4]).not.toHaveProperty('is_foundation');
    expect(result.complete).toBe(true);
  });

  it('enriches a child-only feed from the parent batch and preserves rows when parent metadata is unavailable', async () => {
    getMyCommitteeUids.mockResolvedValue(new Set(['a']));
    listCommitteeNewsletters.mockResolvedValue(pageOf([newsletter('n1', '2026-07-01')]));
    const owner = { uid: 'project-n1', name: 'Child', parent_uid: 'foundation' } as Project;
    const parent = {
      uid: 'foundation',
      name: 'Synthetic Foundation',
      stage: 'Active',
      funding: ProjectFunding.Funded,
      funding_model: ['Membership'],
    } as Project;
    getProjectsByIds.mockResolvedValueOnce(new Map([[owner.uid, owner]])).mockResolvedValueOnce(new Map([[parent.uid, parent]]));
    const enriched = await service.getMyNewsletters(req);
    expect(enriched.newsletters[0]).toMatchObject({ parent_project_name: parent.name, parent_is_foundation: true });
    expect(enriched.newsletters[0].project_slug).toBeUndefined();
    getProjectsByIds.mockResolvedValueOnce(new Map([[owner.uid, owner]])).mockResolvedValueOnce(new Map());
    const unresolved = await service.getMyNewsletters(req);
    expect(unresolved.newsletters[0]).toMatchObject({ id: 'n1', parent_project_uid: 'foundation' });
    expect(unresolved.newsletters[0]).not.toHaveProperty('parent_is_foundation');
    expect(unresolved.complete).toBe(true);
  });
});
