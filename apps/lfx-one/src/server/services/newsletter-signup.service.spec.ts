// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';

const proxyRequest = vi.fn();
const getProjectIdBySlug = vi.fn();
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

function mockUpstream(group: Record<string, unknown>, settings: Record<string, unknown> | Error = {}): void {
  proxyRequest.mockImplementation((_req: Request, _svc: string, path: string) => {
    if (path.startsWith('/projects/')) {
      return Promise.resolve(project);
    }
    if (path.endsWith('/settings')) {
      return settings instanceof Error ? Promise.reject(settings) : Promise.resolve(settings);
    }
    return Promise.resolve(group);
  });
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
        accepting_signups: true,
      });
      expect(getProjectIdBySlug).toHaveBeenCalledWith(req, 'acme', { strict: true });
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
        path.startsWith('/projects/') || path.endsWith('/settings')
          ? Promise.resolve(project)
          : Promise.reject(new MicroserviceError('Not found', 404, 'NOT_FOUND'))
      );
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('reports a voting-enabled group as not accepting signups', async () => {
      mockUpstream(committee({ enable_voting: true }));
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).resolves.toMatchObject({ accepting_signups: false });
    });

    it('reports a business-email-required group as not accepting signups', async () => {
      mockUpstream(committee(), { business_email_required: true });
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).resolves.toMatchObject({ accepting_signups: false });
    });

    it('assumes signups are open when the settings read fails', async () => {
      mockUpstream(committee(), new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).resolves.toMatchObject({ accepting_signups: true });
    });

    it('propagates a slug-lookup outage instead of reporting the link as not found', async () => {
      getProjectIdBySlug.mockRejectedValue(new MicroserviceError('unavailable', 503, 'SERVICE_UNAVAILABLE'));
      await expect(service.getSignupInfo(req, 'acme', GROUP_UID)).rejects.toMatchObject({ statusCode: 503 });
    });
  });

  describe('subscribe', () => {
    it('rejects an invalid email before any upstream call', async () => {
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'not-an-email')).rejects.toBeInstanceOf(ServiceValidationError);
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });

    it('sends a normalized email-only payload with a scoped M2M token and notification suppressed', async () => {
      const result = await service.subscribe(req, 'acme', GROUP_UID, '  Jane@Example.org ');

      expect(result).toEqual({ status: 'subscribed' });
      expect(createCommitteeMember).toHaveBeenCalledWith(req, GROUP_UID, { email: 'jane@example.org' }, true, { bearerToken: 'm2m-token' });
    });

    it('treats an existing membership (409) as subscribed', async () => {
      createCommitteeMember.mockRejectedValue(new MicroserviceError('Conflict', 409, 'CONFLICT'));
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'new@example.org')).resolves.toEqual({ status: 'subscribed' });
    });

    it('propagates other upstream failures', async () => {
      createCommitteeMember.mockRejectedValue(new MicroserviceError('Boom', 500, 'INTERNAL_ERROR'));
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'new@example.org')).rejects.toBeInstanceOf(MicroserviceError);
    });

    it('refuses a group that is not accepting signups, naming the group field', async () => {
      mockUpstream(committee({ enable_voting: true }));
      const error = await service.subscribe(req, 'acme', GROUP_UID, 'new@example.org').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceValidationError);
      expect((error as ServiceValidationError).validationErrors[0].field).toBe('group');
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });

    it('does not subscribe to a group outside the project', async () => {
      mockUpstream(committee({ project_uid: OTHER_PROJECT_UID }));
      await expect(service.subscribe(req, 'acme', GROUP_UID, 'new@example.org')).rejects.toBeInstanceOf(ResourceNotFoundError);
      expect(createCommitteeMember).not.toHaveBeenCalled();
    });
  });
});
