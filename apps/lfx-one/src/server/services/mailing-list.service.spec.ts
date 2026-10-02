// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MailingListAudienceAccess, MailingListMemberDeliveryMode, MailingListMemberModStatus, MailingListMemberType } from '@lfx-one/shared/enums';
import type { MailingListMember } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSingleAccessStrict, addAccessToResource, proxyRequest, getEffectiveEmail } = vi.hoisted(() => ({
  checkSingleAccessStrict: vi.fn(),
  addAccessToResource: vi.fn(async (_req: unknown, resource: unknown) => resource),
  proxyRequest: vi.fn(),
  getEffectiveEmail: vi.fn(),
}));

vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
    public addAccessToResource = addAccessToResource;
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

const req = {} as unknown as Request;

const existingMember: MailingListMember = {
  uid: 'member-1',
  mailing_list_uid: 'list-1',
  email: 'self@example.com',
  member_type: MailingListMemberType.DIRECT,
  delivery_mode: MailingListMemberDeliveryMode.NORMAL,
  mod_status: MailingListMemberModStatus.NONE,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('MailingListService member authorization', () => {
  let service: MailingListService;

  beforeEach(() => {
    checkSingleAccessStrict.mockReset();
    addAccessToResource.mockReset().mockImplementation(async (_req: unknown, resource: unknown) => resource);
    proxyRequest.mockReset();
    getEffectiveEmail.mockReset();
    service = new MailingListService();
  });

  describe('createMember', () => {
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
      proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, _path: string, method: string) => {
        if (method === 'GET') {
          return existingMember;
        }
        return { ...existingMember, name: 'Updated Name' };
      });

      await expect(service.updateMember(req, 'list-1', 'member-1', { name: 'Updated Name' })).resolves.toBeDefined();
      expect(checkSingleAccessStrict).not.toHaveBeenCalled();
    });

    it('rejects a self-service caller attempting to escalate their own mod_status', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);
      proxyRequest.mockResolvedValue(existingMember);

      await expect(service.updateMember(req, 'list-1', 'member-1', { mod_status: MailingListMemberModStatus.MODERATOR })).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects a self-service caller updating a record that is already privileged', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);
      proxyRequest.mockResolvedValue({ ...existingMember, mod_status: MailingListMemberModStatus.MODERATOR });

      await expect(service.updateMember(req, 'list-1', 'member-1', { name: 'New Name' })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a confused-deputy update where the member belongs to a different mailing list', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      proxyRequest.mockResolvedValue({ ...existingMember, mailing_list_uid: 'other-list' });

      await expect(service.updateMember(req, 'list-1', 'member-1', { name: 'New Name' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('allows a writer to update any member including mod_status', async () => {
      getEffectiveEmail.mockReturnValue('writer@example.com');
      checkSingleAccessStrict.mockResolvedValue(true);
      proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, _path: string, method: string) => {
        if (method === 'GET') {
          return existingMember;
        }
        return { ...existingMember, mod_status: MailingListMemberModStatus.MODERATOR };
      });

      await expect(service.updateMember(req, 'list-1', 'member-1', { mod_status: MailingListMemberModStatus.MODERATOR })).resolves.toBeDefined();
    });
  });

  describe('deleteMember', () => {
    it('allows a self-service caller to remove their own membership', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, path: string) => {
        if (path === '/query/resources') {
          return { resources: [] };
        }
        return existingMember;
      });

      await expect(service.deleteMember(req, 'list-1', 'member-1')).resolves.toBeUndefined();
      expect(checkSingleAccessStrict).not.toHaveBeenCalled();
    });

    it('rejects a caller deleting someone else without writer access', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      checkSingleAccessStrict.mockResolvedValue(false);
      proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, path: string) => {
        if (path === '/query/resources') {
          return { resources: [] };
        }
        return { ...existingMember, email: 'other@example.com' };
      });

      await expect(service.deleteMember(req, 'list-1', 'member-1')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a confused-deputy delete where the member belongs to a different mailing list', async () => {
      getEffectiveEmail.mockReturnValue('self@example.com');
      proxyRequest.mockImplementation(async (_req: unknown, _svc: unknown, path: string) => {
        if (path === '/query/resources') {
          return { resources: [] };
        }
        return { ...existingMember, mailing_list_uid: 'other-list' };
      });

      await expect(service.deleteMember(req, 'list-1', 'member-1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
