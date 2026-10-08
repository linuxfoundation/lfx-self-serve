// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';

const proxyRequest = vi.fn();
const getProjectIdBySlug = vi.fn();
const getUserInfo = vi.fn();
const createCommitteeMember = vi.fn();
const generateM2MToken = vi.fn();

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = (...args: unknown[]) => proxyRequest(...args);
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = (...args: unknown[]) => getProjectIdBySlug(...args);
    public getUserInfo = (...args: unknown[]) => getUserInfo(...args);
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public createCommitteeMember = (...args: unknown[]) => createCommitteeMember(...args);
  },
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: (...args: unknown[]) => generateM2MToken(...args) }));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { NewsletterSignupService } = await import('./newsletter-signup.service');

const PROJECT_UID = '3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';
const OTHER_PROJECT_UID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const GROUP_UID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const req = { path: '/public/api/projects/acme/newsletter-signup' } as unknown as Request;

const project = { uid: PROJECT_UID, slug: 'acme', name: 'Acme Project', logo_url: 'https://cdn.example.org/acme.png' };

function committee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { uid: GROUP_UID, name: 'acme-news', display_name: 'Acme News', category: 'Newsletter', project_uid: PROJECT_UID, ...overrides };
}

function mockUpstream(group: Record<string, unknown>): void {
  proxyRequest.mockImplementation((_req: Request, _svc: string, path: string) => Promise.resolve(path.startsWith('/projects/') ? project : group));
}

describe('NewsletterSignupService', () => {
  let service: InstanceType<typeof NewsletterSignupService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NewsletterSignupService();
    generateM2MToken.mockResolvedValue('m2m-token');
    getProjectIdBySlug.mockResolvedValue({ exists: true, uid: PROJECT_UID });
    mockUpstream(committee());
  });

  describe('getSignupInfo', () => {
    it('returns the slim project + group projection using a scoped M2M token', async () => {
      const info = await service.getSignupInfo(req, 'acme', GROUP_UID);

      expect(info).toEqual({
        project: { name: 'Acme Project', slug: 'acme', logo_url: 'https://cdn.example.org/acme.png' },
        group: { uid: GROUP_UID, name: 'Acme News' },
      });
      for (const call of proxyRequest.mock.calls) {
        expect(call[7]).toEqual({ bearerToken: 'm2m-token' });
      }
    });

    it('rejects a group that is not a Newsletter group', async () => {
      mockUpstream(committee({ category: 'Technical Steering Committee' }));
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('rejects a Newsletter group from another project', async () => {
      mockUpstream(committee({ project_uid: OTHER_PROJECT_UID }));
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('rejects an unknown project slug', async () => {
      getProjectIdBySlug.mockResolvedValue({ exists: false });
      await expect(service.getSignupInfo(req, 'nope', GROUP_UID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('rejects a non-UUID group id without calling upstream', async () => {
      await expect(service.getSignupInfo(req, 'acme', '../projects/x')).rejects.toBeInstanceOf(ResourceNotFoundError);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('maps an upstream committee 404 to a not-found', async () => {
      proxyRequest.mockImplementation((_req: Request, _svc: string, path: string) =>
        path.startsWith('/projects/') ? Promise.resolve(project) : Promise.reject(new MicroserviceError('Not found', 404, 'NOT_FOUND'))
      );
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  describe('subscribe', () => {
    it('rejects an invalid email before any upstream call', async () => {
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'not-an-email')).rejects.toBeInstanceOf(ServiceValidationError);
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });

    it('attaches the LF username and name when the email matches an account', async () => {
      getUserInfo.mockResolvedValue({ username: 'jdoe', name: 'Jane Q Doe', email: 'jane@example.org' });

      const result = await service.subscribe(req, 'acme', GROUP_UID, '  Jane@Example.org ');

      expect(result).toEqual({ status: 'subscribed' });
      expect(createCommitteeMember).toHaveBeenCalledWith(
        req,
        GROUP_UID,
        { email: 'jane@example.org', username: 'jdoe', first_name: 'Jane', last_name: 'Q Doe' },
        true,
        { bearerToken: 'm2m-token' }
      );
    });

    it('does not store the username fallback as a first name', async () => {
      getUserInfo.mockResolvedValue({ username: 'jdoe', name: 'jdoe', email: 'jane@example.org' });
      await service.subscribe(req, 'acme', GROUP_UID, 'jane@example.org');
      expect(createCommitteeMember.mock.calls[0][2]).toEqual({ email: 'jane@example.org', username: 'jdoe' });
    });

    it('subscribes by email only when no LF account matches', async () => {
      getUserInfo.mockRejectedValue(new ResourceNotFoundError('User', 'x'));
      await service.subscribe(req, 'acme', GROUP_UID, 'new@example.org');
      expect(createCommitteeMember.mock.calls[0][2]).toEqual({ email: 'new@example.org' });
    });

    it('subscribes by email only when the directory lookup fails', async () => {
      getUserInfo.mockRejectedValue(new MicroserviceError('timeout', 503, 'SERVICE_UNAVAILABLE'));
      await service.subscribe(req, 'acme', GROUP_UID, 'new@example.org');
      expect(createCommitteeMember.mock.calls[0][2]).toEqual({ email: 'new@example.org' });
    });

    it('treats an existing membership (409) as subscribed', async () => {
      getUserInfo.mockRejectedValue(new ResourceNotFoundError('User', 'x'));
      createCommitteeMember.mockRejectedValue(new MicroserviceError('Conflict', 409, 'CONFLICT'));
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'new@example.org')).resolves.toEqual({ status: 'subscribed' });
    });

    it('propagates other upstream failures', async () => {
      getUserInfo.mockRejectedValue(new ResourceNotFoundError('User', 'x'));
      createCommitteeMember.mockRejectedValue(new MicroserviceError('Boom', 500, 'INTERNAL_ERROR'));
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'new@example.org')).rejects.toBeInstanceOf(MicroserviceError);
    });

    it('does not subscribe to a group outside the project', async () => {
      mockUpstream(committee({ project_uid: OTHER_PROJECT_UID }));
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'new@example.org')).rejects.toBeInstanceOf(ResourceNotFoundError);
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });
  });
});
