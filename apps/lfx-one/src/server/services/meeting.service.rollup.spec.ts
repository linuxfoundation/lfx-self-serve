// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers the GH-5566 roll-up wiring only: that `root_project_uid` resolves the project tree with the
// caller's own request and reaches query-service as a `filters_or` scope, for both meeting indexes.
const { proxyRequest, getFoundationProjectUids, getProjectsByIds, withPerUserCache, storeDecisions } = vi.hoisted(() => {
  const decisions: boolean[] = [];
  return {
    proxyRequest: vi.fn(),
    getFoundationProjectUids: vi.fn(),
    getProjectsByIds: vi.fn(),
    storeDecisions: decisions,
    // Runs the fetcher (args[4]) and records what the `storable` gate (args[6]) decides right after it, while
    // the flight is still in progress — the same point the real cache asks before writing.
    withPerUserCache: vi.fn(async (...args: unknown[]) => {
      const value = await (args[4] as () => Promise<unknown>)();
      decisions.push((args[6] as (v: unknown) => boolean)(value));
      return value;
    }),
  };
});

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
    public getProjectsByIds = getProjectsByIds;
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
import { evictPerUserOrgFetch, resetSingleFlightForTests } from '../utils/single-flight';
import { MeetingService } from './meeting.service';

const req = { id: 'caller' } as unknown as Request;
const ROOT = 'foundation-uid';

describe('MeetingService roll-up scope', () => {
  let service: MeetingService;

  beforeEach(() => {
    proxyRequest.mockReset();
    getFoundationProjectUids.mockReset().mockResolvedValue([ROOT, 'child-uid']);
    withPerUserCache.mockClear();
    storeDecisions.length = 0;
    resetSingleFlightForTests();
    service = new MeetingService();
  });

  it.each(['v1_meeting', 'v1_past_meeting'] as const)('scopes the %s list to every project in the tree', async (type) => {
    proxyRequest.mockResolvedValue({ resources: [], page_token: 'next' });

    const result = await service.getMeetings(req, { root_project_uid: ROOT, page_token: 'p1', filters: ['meeting_type:Technical'] }, type, false);

    expect(getFoundationProjectUids).toHaveBeenCalledWith(req, ROOT, { onIncomplete: expect.any(Function) });
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
    expect(withPerUserCache).toHaveBeenCalledWith(
      'meeting-rollup-scope:v1',
      'jdoe',
      ROOT,
      300,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', {
      filters_or: [`project_uid:${ROOT}`, 'project_uid:child-uid'],
      type: 'v1_past_meeting',
    });
  });

  it('serves but never caches a scope whose tree walk missed a branch', async () => {
    proxyRequest.mockResolvedValue({ count: 3 });
    getFoundationProjectUids.mockImplementation(async (_req: unknown, root: string, options?: { onIncomplete?: () => void }) => {
      options?.onIncomplete?.();
      return [root];
    });

    await service.getMeetingsCount(req, { root_project_uid: ROOT }, 'v1_meeting');

    expect(storeDecisions).toEqual([false]);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', {
      filters_or: [`project_uid:${ROOT}`],
      type: 'v1_meeting',
    });
  });

  it('does not cache a scope whose flight was superseded while it ran', async () => {
    proxyRequest.mockResolvedValue({ count: 3 });
    getFoundationProjectUids.mockImplementation(async (_req: unknown, root: string) => {
      // After a tick, so the flight is registered before it is evicted (a write invalidating it mid-walk).
      await Promise.resolve();
      evictPerUserOrgFetch('meeting-rollup-scope:v1', 'jdoe', ROOT);
      return [root];
    });

    await service.getMeetingsCount(req, { root_project_uid: ROOT }, 'v1_meeting');

    expect(storeDecisions).toEqual([false]);
  });

  it('caches a complete scope', async () => {
    proxyRequest.mockResolvedValue({ count: 3 });

    await service.getMeetingsCount(req, { root_project_uid: ROOT }, 'v1_meeting');

    expect(storeDecisions).toEqual([true]);
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

  describe('roll-up filters', () => {
    const committees = {
      resources: [
        { id: 'committee:b1', data: { uid: 'b1', name: ' Board One ', category: 'Board', project_uid: ROOT } },
        { id: 'committee:b2', data: { uid: 'b2', name: 'Board Two', category: 'Board', project_uid: 'child-uid' } },
        { id: 'committee:w1', data: { uid: 'w1', name: 'Working Group', category: 'Working Group', project_uid: 'child-uid' } },
      ],
      page_token: undefined,
    };
    const countCall = (): Record<string, unknown> => proxyRequest.mock.calls.find((call) => call[2] === '/query/resources/count')?.[4];

    it('limits the scope to the selected projects inside the tree', async () => {
      proxyRequest.mockResolvedValue({ count: 2 });

      await service.getMeetingsCount(req, { root_project_uid: ROOT, project_uids: 'child-uid,outside' }, 'v1_meeting');

      expect(countCall()).toEqual({ filters_or: ['project_uid:child-uid'], type: 'v1_meeting' });
    });

    it('falls back to the root project when the tree is larger than one OR batch', async () => {
      proxyRequest.mockResolvedValue({ count: 3 });
      getFoundationProjectUids.mockResolvedValue([ROOT, ...Array.from({ length: 150 }, (_, i) => `child-${i}`)]);

      await service.getMeetingsCount(req, { root_project_uid: ROOT }, 'v1_meeting');

      expect(countCall()).toEqual({ filters_or: [`project_uid:${ROOT}`], type: 'v1_meeting' });
    });

    it('keeps a selection of up to one OR batch inside a large tree', async () => {
      proxyRequest.mockResolvedValue({ count: 3 });
      getFoundationProjectUids.mockResolvedValue([ROOT, ...Array.from({ length: 150 }, (_, i) => `child-${i}`)]);

      await service.getMeetingsCount(req, { root_project_uid: ROOT, project_uids: 'child-1,child-2' }, 'v1_meeting');

      expect(countCall()).toEqual({ filters_or: ['project_uid:child-1', 'project_uid:child-2'], type: 'v1_meeting' });
    });

    it('answers empty without querying when no selected project is in the tree', async () => {
      const count = await service.getMeetingsCount(req, { root_project_uid: ROOT, project_uids: 'outside' }, 'v1_meeting');
      const list = await service.getMeetings(req, { root_project_uid: ROOT, project_uids: 'outside' }, 'v1_meeting', false);

      expect(count).toBe(0);
      expect(list).toEqual({ data: [], page_token: undefined });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('resolves a group type to the groups of that category in scope', async () => {
      proxyRequest.mockImplementation(async (_req: unknown, _svc: string, path: string) => (path === '/query/resources/count' ? { count: 4 } : committees));

      await service.getMeetingsCount(req, { root_project_uid: ROOT, group_type: 'Board' }, 'v1_meeting');

      expect(countCall()).toEqual({
        tags: ['committee_uid:b1', 'committee_uid:b2'],
        filters_or: [`project_uid:${ROOT}`, 'project_uid:child-uid'],
        type: 'v1_meeting',
      });
    });

    it('caches the groups of a complete tree per user and root', async () => {
      proxyRequest.mockImplementation(async (_req: unknown, _svc: string, path: string) => (path === '/query/resources/count' ? { count: 4 } : committees));

      await service.getMeetingsCount(req, { root_project_uid: ROOT, group_type: 'Board' }, 'v1_meeting');

      // One tree walk feeds both caches, and both store what a complete walk produced.
      expect(withPerUserCache.mock.calls.map((call) => call[0])).toEqual(['meeting-rollup-scope:v1', 'meeting-rollup-groups:v1']);
      expect(storeDecisions).toEqual([true, true]);
      expect(getFoundationProjectUids).toHaveBeenCalledTimes(1);
    });

    it('does not cache or share the groups of an incomplete tree', async () => {
      proxyRequest.mockImplementation(async (_req: unknown, _svc: string, path: string) => (path === '/query/resources/count' ? { count: 4 } : committees));
      getFoundationProjectUids.mockImplementation(async (_req: unknown, root: string, options?: { onIncomplete?: () => void }) => {
        options?.onIncomplete?.();
        return [root, 'child-uid'];
      });

      await service.getMeetingsCount(req, { root_project_uid: ROOT, group_type: 'Board' }, 'v1_meeting');

      // One tree walk; an incomplete one is not cached, and its groups skip the shared cache entirely.
      expect(withPerUserCache.mock.calls.map((call) => call[0])).toEqual(['meeting-rollup-scope:v1']);
      expect(storeDecisions).toEqual([false]);
      expect(getFoundationProjectUids).toHaveBeenCalledTimes(1);
    });

    it('answers empty when the selected group is not of the selected type', async () => {
      proxyRequest.mockResolvedValue(committees);

      const count = await service.getMeetingsCount(req, { root_project_uid: ROOT, group_type: 'Board', committee_uid: 'w1' }, 'v1_meeting');

      expect(count).toBe(0);
      expect(countCall()).toBeUndefined();
    });

    it('filters by one group without looking up groups', async () => {
      proxyRequest.mockResolvedValue({ count: 1 });

      await service.getMeetingsCount(req, { root_project_uid: ROOT, committee_uid: 'w1' }, 'v1_meeting');

      expect(proxyRequest).toHaveBeenCalledTimes(1);
      expect(countCall()).toEqual({ tags: ['committee_uid:w1'], filters_or: [`project_uid:${ROOT}`, 'project_uid:child-uid'], type: 'v1_meeting' });
    });

    it('marks the options incomplete when a resolved project has no details', async () => {
      proxyRequest.mockResolvedValue(committees);
      getProjectsByIds.mockResolvedValue(new Map([[ROOT, { uid: ROOT, name: 'FINOS', slug: 'finos' }]]));

      const options = await service.getRollupFilterOptions(req, ROOT);

      expect(options.complete).toBe(false);
    });

    it('returns the tree projects and their groups as filter options, sorted and trimmed', async () => {
      proxyRequest.mockResolvedValue(committees);
      getProjectsByIds.mockResolvedValue(
        new Map([
          ['child-uid', { uid: 'child-uid', name: 'Zenith', slug: 'zenith' }],
          [ROOT, { uid: ROOT, name: 'FINOS', slug: 'finos' }],
        ])
      );

      const options = await service.getRollupFilterOptions(req, ROOT);

      expect(options.projects).toEqual([
        { uid: ROOT, name: 'FINOS', slug: 'finos' },
        { uid: 'child-uid', name: 'Zenith', slug: 'zenith' },
      ]);
      expect(options.groups.map((group) => group.name)).toEqual(['Board One', 'Board Two', 'Working Group']);
      expect(options.complete).toBe(true);
      expect(options.groups[0]).toEqual({ uid: 'b1', name: 'Board One', category: 'Board', project_uid: ROOT });
    });
  });
});
