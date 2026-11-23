// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QUERY_SERVICE_MAX_PAGE_SIZE, QUERY_SERVICE_MAX_PAGES } from '@lfx-one/shared/constants';
import { MailingListAudienceAccess, MailingListMemberDeliveryMode, MailingListMemberModStatus, MailingListMemberType } from '@lfx-one/shared/enums';
import type { GroupsIOMemberResponse, MailingListMember } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSingleAccessStrict, addAccessToResource, addAccessToResources, proxyRequest, getEffectiveEmail } = vi.hoisted(() => ({
  checkSingleAccessStrict: vi.fn(),
  addAccessToResource: vi.fn(async (_req: unknown, resource: unknown) => resource),
  addAccessToResources: vi.fn(async (_req: unknown, resources: unknown) => resources),
  proxyRequest: vi.fn(),
  getEffectiveEmail: vi.fn(),
}));

vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
    public addAccessToResource = addAccessToResource;
    public addAccessToResources = addAccessToResources;
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {},
}));
vi.mock('../utils/auth-helper', async () => {
  const actual = await vi.importActual<typeof import('../utils/auth-helper')>('../utils/auth-helper');
  return { ...actual, getEffectiveEmail };
});

import { MailingListService } from './mailing-list.service';

const req = { log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as Request;

// Mirrors the upstream single-GET `GroupsioMember` response, which carries `id` but no `uid` or
// `mailing_list_uid`.
const existingMember: GroupsIOMemberResponse = {
  id: 'member-1',
  email: 'self@example.com',
  member_type: MailingListMemberType.DIRECT,
  delivery_mode: MailingListMemberDeliveryMode.NORMAL,
  mod_status: MailingListMemberModStatus.NONE,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// The query-service index document for the same member, tagged with its mailing list.
const indexedMember: MailingListMember = { ...existingMember, uid: 'member-1', mailing_list_uid: 'list-1' };

/**
 * Routes proxied calls for update/delete: the membership lookup (`tags_all` with `member_uid:`)
 * answers from the index (or rejects with `lookupError`), any other query-service call (the delete
 * removal poll) finds nothing, the member GET returns `member`, and PUT/DELETE return `mutation`.
 */
function routeProxy({
  member = existingMember,
  indexed = true,
  lookupError,
  mutation,
}: { member?: GroupsIOMemberResponse; indexed?: boolean; lookupError?: Error; mutation?: unknown } = {}): void {
  proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, path: string, method: string, params?: Record<string, unknown>) => {
    if (path === '/query/resources') {
      const tagsAll = params?.['tags_all'];
      if (Array.isArray(tagsAll) && tagsAll.some((tag) => String(tag).startsWith('member_uid:'))) {
        if (lookupError) {
          throw lookupError;
        }
        return { resources: indexed ? [{ data: indexedMember }] : [] };
      }
      return { resources: [] };
    }
    if (method === 'GET') {
      return member;
    }
    return mutation;
  });
}

function proxiedMethods(): string[] {
  return proxyRequest.mock.calls.map(([, , , method]) => method as string);
}

describe('MailingListService member authorization', () => {
  let service: MailingListService;

  beforeEach(() => {
    checkSingleAccessStrict.mockReset();
    addAccessToResource.mockReset().mockImplementation(async (_req: unknown, resource: unknown) => resource);
    addAccessToResources.mockReset().mockImplementation(async (_req: unknown, resources: unknown) => resources);
    proxyRequest.mockReset();
    getEffectiveEmail.mockReset();
    service = new MailingListService();
  });

  describe('getMembers completeness', () => {
    it('returns and enriches a complete roster across pages', async () => {
      proxyRequest
        .mockResolvedValueOnce({ resources: [{ type: 'groupsio_member', id: 'groupsio_member:member-1', data: indexedMember }], page_token: 'next' })
        .mockResolvedValueOnce({ resources: [] });

      await expect(service.getMembers(req, 'list-1', { page_size: 1, page_token: 'ignored' })).resolves.toEqual([indexedMember]);
      expect(proxyRequest.mock.calls[0][4]).toEqual({ type: 'groupsio_member', tags: 'mailing_list_uid:list-1', page_size: QUERY_SERVICE_MAX_PAGE_SIZE });
      expect(proxyRequest.mock.calls[1][4]).toEqual({
        type: 'groupsio_member',
        tags: 'mailing_list_uid:list-1',
        page_size: QUERY_SERVICE_MAX_PAGE_SIZE,
        page_token: 'next',
      });
      expect(addAccessToResources).toHaveBeenCalledWith(req, [indexedMember], 'groupsio_member');
    });

    it('rejects a repeated token instead of enriching a partial roster', async () => {
      proxyRequest.mockResolvedValue({
        resources: [{ type: 'groupsio_member', id: 'groupsio_member:member-1', data: indexedMember }],
        page_token: 'repeated',
      });

      await expect(service.getMembers(req, 'list-1')).rejects.toMatchObject({ code: 'QUERY_SERVICE_PAGINATION_LIMIT', statusCode: 502 });
      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(addAccessToResources).not.toHaveBeenCalled();
    });

    it('rejects a continuing roster at the page cap instead of reporting a complete list', async () => {
      let page = 0;
      proxyRequest.mockImplementation(async () => ({
        resources: [{ type: 'groupsio_member', id: 'groupsio_member:member-1', data: indexedMember }],
        page_token: `page-${++page}`,
      }));

      await expect(service.getMembers(req, 'list-1')).rejects.toMatchObject({ code: 'QUERY_SERVICE_PAGINATION_LIMIT', statusCode: 502 });
      expect(proxyRequest).toHaveBeenCalledTimes(QUERY_SERVICE_MAX_PAGES);
      expect(addAccessToResources).not.toHaveBeenCalled();
    });

    it('propagates a later-page error rather than returning a successful prefix', async () => {
      const failure = Object.assign(new Error('page failed'), { statusCode: 400 });
      proxyRequest
        .mockResolvedValueOnce({ resources: [{ type: 'groupsio_member', id: 'groupsio_member:member-1', data: indexedMember }], page_token: 'next' })
        .mockRejectedValueOnce(failure);

      await expect(service.getMembers(req, 'list-1')).rejects.toBe(failure);
      expect(addAccessToResources).not.toHaveBeenCalled();
    });
  });

  describe('createMember', () => {
    it('rejects a non-string email', async () => {
      await expect(service.createMember(req, 'list-1', { email: 1 as unknown as string })).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('rejects a blank email', async () => {
      await expect(service.createMember(req, 'list-1', { email: '   ' })).rejects.toMatchObject({ statusCode: 400 });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('allows a self-service caller to add themselves as a plain direct subscriber to a public list', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, path: string, method: string) => {
        if (method === 'GET') {
          return { resources: [{ data: { uid: 'list-1', audience_access: MailingListAudienceAccess.PUBLIC } }] };
        }
        expect(path).toBe('/groupsio/mailing-lists/list-1/members');
        return { ...existingMember, uid: 'new-member' };
      });

      await service.createMember(req, 'list-1', { email: 'self@example.com' });

      expect(checkSingleAccessStrict).not.toHaveBeenCalled();
    });

    it('rejects a self-service caller joining a non-public list without writer access', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);
      proxyRequest.mockResolvedValue({ resources: [{ data: { uid: 'list-1', audience_access: MailingListAudienceAccess.APPROVAL_REQUIRED } }] });

      await expect(service.createMember(req, 'list-1', { email: 'self@example.com' })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a self-service caller attempting to add themselves with an escalated mod_status', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);

      await expect(service.createMember(req, 'list-1', { email: 'self@example.com', mod_status: MailingListMemberModStatus.OWNER })).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('rejects adding a different email without writer access', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);

      await expect(service.createMember(req, 'list-1', { email: 'other@example.com' })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows a writer to add any member regardless of payload', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      proxyRequest.mockResolvedValue({ ...existingMember, uid: 'new-member' });

      await expect(service.createMember(req, 'list-1', { email: 'other@example.com', mod_status: MailingListMemberModStatus.OWNER })).resolves.toBeDefined();
    });
  });

  describe('updateMember', () => {
    it('allows a self-service caller to update their own already-plain record without escalation', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      routeProxy({ mutation: { ...existingMember, name: 'Updated Name' } });

      await expect(service.updateMember(req, 'list-1', 'member-1', { name: 'Updated Name' })).resolves.toBeDefined();
      expect(checkSingleAccessStrict).not.toHaveBeenCalled();
    });

    it('rejects a self-service caller attempting to escalate their own mod_status', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);
      routeProxy();

      await expect(service.updateMember(req, 'list-1', 'member-1', { mod_status: MailingListMemberModStatus.MODERATOR })).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects a self-service caller updating a record that is already privileged', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);
      routeProxy({ member: { ...existingMember, mod_status: MailingListMemberModStatus.MODERATOR } });

      await expect(service.updateMember(req, 'list-1', 'member-1', { name: 'New Name' })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a confused-deputy update where the member belongs to a different mailing list', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      routeProxy({ indexed: false });

      await expect(service.updateMember(req, 'list-1', 'member-1', { name: 'New Name' })).rejects.toMatchObject({ statusCode: 404 });
      expect(proxiedMethods()).not.toContain('PUT');
    });

    it('fails closed without updating when the membership lookup errors', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      const lookupError = new Error('query service unavailable');
      routeProxy({ lookupError });

      await expect(service.updateMember(req, 'list-1', 'member-1', { name: 'New Name' })).rejects.toBe(lookupError);
      expect(proxiedMethods()).not.toContain('PUT');
    });

    it('allows a writer to update any member including mod_status', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      routeProxy({ mutation: { ...existingMember, mod_status: MailingListMemberModStatus.MODERATOR } });

      await expect(service.updateMember(req, 'list-1', 'member-1', { mod_status: MailingListMemberModStatus.MODERATOR })).resolves.toBeDefined();
    });

    it('updates a member when the upstream GET carries no mailing_list_uid', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      routeProxy({ mutation: { ...existingMember, mod_status: MailingListMemberModStatus.MODERATOR } });
      expect(existingMember).not.toHaveProperty('mailing_list_uid');

      await expect(service.updateMember(req, 'list-1', 'member-1', { mod_status: MailingListMemberModStatus.MODERATOR })).resolves.toBeDefined();
      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        '/groupsio/mailing-lists/list-1/members/member-1',
        'PUT',
        undefined,
        expect.objectContaining({ mod_status: MailingListMemberModStatus.MODERATOR })
      );
    });

    it('scopes the membership lookup to the member and mailing list', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      routeProxy({ mutation: existingMember });

      await service.updateMember(req, 'list-1', 'member-1', { name: 'New Name' });

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'groupsio_member',
        tags_all: ['member_uid:member-1', 'mailing_list_uid:list-1'],
      });
    });
  });

  describe('deleteMember', () => {
    it('allows a self-service caller to remove their own membership', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      routeProxy();

      await expect(service.deleteMember(req, 'list-1', 'member-1')).resolves.toBeUndefined();
      expect(checkSingleAccessStrict).not.toHaveBeenCalled();
      expect(proxiedMethods()).toContain('DELETE');
    });

    it('rejects a caller deleting someone else without writer access', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);
      routeProxy({ member: { ...existingMember, email: 'other@example.com' } });

      await expect(service.deleteMember(req, 'list-1', 'member-1')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a confused-deputy delete where the member belongs to a different mailing list', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      routeProxy({ indexed: false });

      await expect(service.deleteMember(req, 'list-1', 'member-1')).rejects.toMatchObject({ statusCode: 404 });
      expect(proxiedMethods()).not.toContain('DELETE');
    });

    it('fails closed without deleting when the membership lookup errors', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      const lookupError = new Error('query service unavailable');
      routeProxy({ lookupError });

      await expect(service.deleteMember(req, 'list-1', 'member-1')).rejects.toBe(lookupError);
      expect(proxiedMethods()).not.toContain('DELETE');
    });
  });
});

describe('MailingListService.updateMailingList index wait', () => {
  const service = new MailingListService();

  beforeEach(() => {
    proxyRequest.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function routeUpdate(indexedCommittees: { uid: string }[][]): void {
    let queryCalls = 0;
    proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, path: string) => {
      if (path === '/query/resources') {
        const committees = indexedCommittees[Math.min(queryCalls++, indexedCommittees.length - 1)];
        return { resources: [{ data: { uid: 'list-1', committees } }] };
      }
      return { uid: 'list-1', committees: [] };
    });
  }

  it('waits until the linked group is visible in the index before returning', async () => {
    routeUpdate([[], [], [{ uid: 'committee-1' }]]);

    const pending = service.updateMailingList(req, 'list-1', { committee_uid: 'committee-1' });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result.committees).toEqual([{ uid: 'committee-1' }]);
    expect(proxyRequest.mock.calls.filter((call) => call[2] === '/query/resources')).toHaveLength(3);
  });

  it('does not wait on a specific group when unlinking', async () => {
    routeUpdate([[]]);

    const result = await service.updateMailingList(req, 'list-1', { committee_uid: null });

    expect(result.uid).toBe('list-1');
    expect(proxyRequest.mock.calls.filter((call) => call[2] === '/query/resources')).toHaveLength(1);
  });
});
