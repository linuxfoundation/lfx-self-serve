// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectFunding } from '@lfx-one/shared/enums';
import type { CommitteeNewsletter, CommitteeNewsletterListResponse, Newsletter, Project } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirror meeting.service.spec.ts: isolate constructed collaborators at the module boundary.
// The pure project classifier is real, resolved by the server Vitest alias.
const { listCommitteeNewsletters, listNewsletters, listOptOuts, getNewsletter, getMyCommitteeUids, getProjectsByIds, getProjectIdBySlug } = vi.hoisted(() => ({
  listCommitteeNewsletters: vi.fn(),
  listNewsletters: vi.fn(),
  listOptOuts: vi.fn(),
  getNewsletter: vi.fn(),
  getMyCommitteeUids: vi.fn(),
  getProjectsByIds: vi.fn(),
  getProjectIdBySlug: vi.fn(),
}));

vi.mock('./newsletter-service.client', () => ({
  NewsletterServiceClient: class {
    public listCommitteeNewsletters = listCommitteeNewsletters;
    public listNewsletters = listNewsletters;
    public listOptOuts = listOptOuts;
    public getNewsletter = getNewsletter;
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
    public getProjectIdBySlug = getProjectIdBySlug;
  },
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn().mockResolvedValue('m2m-token') }));
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
    expect(result.newsletters[1]).toMatchObject({
      foundation_uid: 'foundation',
      foundation_slug: 'foundation',
      foundation_name: 'foundation',
      foundation_logo_url: null,
    });
    expect(result.newsletters[2]).toMatchObject({ parent_project_name: 'parent', parent_is_foundation: false });
    expect(result.newsletters[2]).not.toHaveProperty('foundation_uid'); // Parent is not a foundation: grouped by its own project.
    expect(result.newsletters[3]).not.toHaveProperty('parent_is_foundation'); // ROOT excluded by ProjectService.
    expect(result.newsletters[3]).not.toHaveProperty('foundation_uid'); // Parent unresolved: grouped by its own project.
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

describe('NewsletterService.getNewsletterStatusCounts', () => {
  let service: NewsletterService;
  const row = (status: string, scheduledAt?: string) => ({ id: `n-${Math.random()}`, status, ...(scheduledAt && { scheduled_at: scheduledAt }) });

  beforeEach(() => {
    listNewsletters.mockReset();
    listOptOuts.mockReset().mockResolvedValue({ opt_outs: [{ id: 'o1' }, { id: 'o2' }] });
    service = new NewsletterService();
  });

  it('buckets rows across pages like the list tabs and counts opt-outs', async () => {
    listNewsletters
      .mockResolvedValueOnce({ newsletters: [row('draft'), row('sent'), row('sending', '2026-12-01T00:00:00Z')], next_page_token: 't2' })
      .mockResolvedValueOnce({ newsletters: [row('scheduled'), row('sending'), row('draft')] });

    const result = await service.getNewsletterStatusCounts(req, 'p1');

    expect(result).toEqual({ draft: 2, scheduled: 2, sent: 2, optout: 2, truncated: false });
    expect(listNewsletters).toHaveBeenNthCalledWith(1, req, 'p1', { page_token: undefined });
    expect(listNewsletters).toHaveBeenNthCalledWith(2, req, 'p1', { page_token: 't2' });
  });

  it('marks the counts truncated when the page cap is hit with a cursor outstanding', async () => {
    listNewsletters.mockResolvedValue({ newsletters: [row('draft')], next_page_token: 'more' });

    const result = await service.getNewsletterStatusCounts(req, 'p1');

    expect(listNewsletters).toHaveBeenCalledTimes(20);
    expect(result).toMatchObject({ draft: 20, truncated: true });
  });

  it('drops only the opt-out count when the opt-out read fails', async () => {
    listNewsletters.mockResolvedValue({ newsletters: [row('sent')] });
    listOptOuts.mockRejectedValue(new MicroserviceError('forbidden', 403, 'FORBIDDEN'));

    const result = await service.getNewsletterStatusCounts(req, 'p1');

    expect(result).toEqual({ draft: 0, scheduled: 0, sent: 1, optout: null, truncated: false });
  });

  it('fails the request when the list read fails, without an unhandled opt-out rejection', async () => {
    listNewsletters.mockRejectedValue(new MicroserviceError('upstream down', 503, 'UNAVAILABLE'));
    listOptOuts.mockRejectedValue(new MicroserviceError('also down', 503, 'UNAVAILABLE'));

    await expect(service.getNewsletterStatusCounts(req, 'p1')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('does not raise an unhandled rejection when the opt-out 401 lands while the page walk is still pending', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      listNewsletters.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ newsletters: [] }), 20)));
      listOptOuts.mockRejectedValue(new MicroserviceError('expired', 401, 'UNAUTHORIZED'));

      await expect(service.getNewsletterStatusCounts(req, 'p1')).rejects.toMatchObject({ statusCode: 401 });
      // unhandledRejection fires after the microtask queue drains; give it a tick to surface.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('rethrows a 401 from the opt-out read', async () => {
    listNewsletters.mockResolvedValue({ newsletters: [] });
    listOptOuts.mockRejectedValue(new MicroserviceError('expired', 401, 'UNAUTHORIZED'));

    await expect(service.getNewsletterStatusCounts(req, 'p1')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('NewsletterService.getSharePreview', () => {
  let service: NewsletterService;

  function sentIssue(overrides: Partial<Newsletter> = {}): Newsletter {
    return {
      id: 'news-1',
      project_uid: 'proj-1',
      subject: 'Weekly Update #42',
      body_html: '<p>members-only body</p>',
      ed_reply_email: 'ed@acme-motors.example',
      committee_uids: ['group-1'],
      status: 'sent',
      sent_at: '2026-10-30T10:00:00Z',
      total_recipients: 10,
      created_by: 'sender',
      version: 1,
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    getNewsletter.mockReset().mockResolvedValue(sentIssue());
    getProjectIdBySlug.mockReset().mockResolvedValue({ uid: 'proj-1', slug: 'acme', exists: true });
    service = new NewsletterService();
  });

  it('returns only the subject of a sent issue, read with an M2M token scoped to that call', async () => {
    const preview = await service.getSharePreview(req, 'acme', 'news-1');

    expect(preview).toEqual({ subject: 'Weekly Update #42' });
    expect(getProjectIdBySlug).toHaveBeenCalledWith(req, 'acme', { unavailableAsMissing: false });
    expect(getNewsletter).toHaveBeenCalledWith(req, 'proj-1', 'news-1', { bearerToken: 'm2m-token' });
  });

  it.each(['draft', 'scheduled', 'sending'] as const)('shows nothing for a %s issue', async (status) => {
    getNewsletter.mockResolvedValue(sentIssue({ status }));

    expect(await service.getSharePreview(req, 'acme', 'news-1')).toBeNull();
  });

  it('shows nothing for an issue of another project', async () => {
    getNewsletter.mockResolvedValue(sentIssue({ project_uid: 'other-proj' }));

    expect(await service.getSharePreview(req, 'acme', 'news-1')).toBeNull();
  });

  it('shows nothing for an unknown slug, without reading any issue', async () => {
    getProjectIdBySlug.mockResolvedValue({ uid: '', slug: 'nope', exists: false });

    expect(await service.getSharePreview(req, 'nope', 'news-1')).toBeNull();
    expect(getNewsletter).not.toHaveBeenCalled();
  });

  it.each([400, 403, 404])('folds an upstream %i into "nothing to show" so no upstream detail leaks', async (status) => {
    getNewsletter.mockRejectedValue(new MicroserviceError('upstream says no', status, 'UPSTREAM_ERROR'));

    expect(await service.getSharePreview(req, 'acme', 'news-1')).toBeNull();
  });

  it('propagates an upstream 5xx as a failure, not a missing issue', async () => {
    const failure = new MicroserviceError('upstream down', 502, 'BAD_GATEWAY');
    getNewsletter.mockRejectedValue(failure);

    await expect(service.getSharePreview(req, 'acme', 'news-1')).rejects.toBe(failure);
  });
});

describe('NewsletterService.assertLiveSendAllowed', () => {
  const lockReq = { path: '/x' } as unknown as Request;

  beforeEach(() => {
    getNewsletter.mockReset();
  });

  it('refuses a draft with a layout while live send is off', async () => {
    getNewsletter.mockResolvedValue({ version: 3, body_layout: { blocks: [] } });

    await expect(new NewsletterService().assertLiveSendAllowed(lockReq, 'p1', 'n1', 3, 'newsletter_send')).rejects.toMatchObject({
      statusCode: 403,
      code: 'NEWSLETTER_LIVE_SEND_LOCKED',
    });
  });

  it('refuses a stale version before checking the layout', async () => {
    getNewsletter.mockResolvedValue({ version: 4, body_layout: null });

    await expect(new NewsletterService().assertLiveSendAllowed(lockReq, 'p1', 'n1', 3, 'newsletter_send')).rejects.toMatchObject({ statusCode: 412 });
  });

  it('allows a basic editor draft at the expected version', async () => {
    getNewsletter.mockResolvedValue({ version: 3, body_layout: null });

    await expect(new NewsletterService().assertLiveSendAllowed(lockReq, 'p1', 'n1', 3, 'newsletter_send')).resolves.toBeUndefined();
    expect(getNewsletter).toHaveBeenCalledWith(lockReq, 'p1', 'n1', undefined);
  });

  it('fails closed when the read fails', async () => {
    const err = new MicroserviceError('upstream down', 503, 'UPSTREAM_ERROR');
    getNewsletter.mockRejectedValue(err);

    await expect(new NewsletterService().assertLiveSendAllowed(lockReq, 'p1', 'n1', 3, 'newsletter_send')).rejects.toBe(err);
  });
});
