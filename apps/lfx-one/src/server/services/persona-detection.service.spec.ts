// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSingleAccess, getProjectIdBySlug, natsRequest, logger } = vi.hoisted(() => ({
  checkSingleAccess: vi.fn(),
  getProjectIdBySlug: vi.fn(),
  natsRequest: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

vi.mock('./access-check.service', () => ({
  AccessCheckService: vi.fn().mockImplementation(() => ({
    checkSingleAccess,
  })),
}));

vi.mock('./project.service', () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    getProjectIdBySlug,
  })),
}));

// NatsService is only exercised here through resolveRootUid (ROOT slug -> uid). A trivial passthrough
// codec keeps encode/decode out of scope for these tests, which are about the access-check fan-out, not
// wire encoding.
vi.mock('./nats.service', () => ({
  NatsService: vi.fn().mockImplementation(() => ({
    getCodec: () => ({
      encode: (v: string) => v,
      decode: (v: unknown) => v as string,
    }),
    request: natsRequest,
  })),
}));

vi.mock('./logger.service', () => ({ logger }));

import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { PersonaDetectionService } from './persona-detection.service';

const req = {} as unknown as Request;

function resolvesRootUid(uid = 'uid-root'): void {
  natsRequest.mockResolvedValue({ data: uid });
}

describe('PersonaDetectionService', () => {
  let service: PersonaDetectionService;

  beforeEach(() => {
    checkSingleAccess.mockReset();
    getProjectIdBySlug.mockReset();
    natsRequest.mockReset();
    logger.warning.mockReset();
    // getPersonas's isMarketingAuditor/isCampaignManager fan-out is gated by this flag — the
    // "marketing auditor / campaign access OR path" tests below need it on to exercise checkMarketingAuditorAccess
    // / checkCampaignManagerAccess at all.
    process.env[ServerFeatureFlag.MarketingOpsFga] = 'true';
    service = new PersonaDetectionService();
  });

  afterEach(() => {
    delete process.env[ServerFeatureFlag.MarketingOpsFga];
  });

  describe('checkRootCampaignManager', () => {
    it('checks ROOT `marketing_ops`, not `campaign_manager`', async () => {
      resolvesRootUid();
      checkSingleAccess.mockResolvedValue(true);

      const result = await service.checkRootCampaignManager(req);

      expect(result).toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'project', id: 'uid-root', access: 'marketing_ops' });
    });

    it('fails closed when the ROOT uid cannot be resolved', async () => {
      natsRequest.mockResolvedValue({ data: '' });

      const result = await service.checkRootCampaignManager(req);

      expect(result).toBe(false);
      expect(checkSingleAccess).not.toHaveBeenCalled();
    });

    it('fails closed when the access-check call rejects', async () => {
      resolvesRootUid();
      checkSingleAccess.mockRejectedValue(new Error('fga unavailable'));

      const result = await service.checkRootCampaignManager(req);

      expect(result).toBe(false);
      expect(logger.warning).toHaveBeenCalled();
    });
  });

  describe('checkRootMarketingAuditor', () => {
    it('checks ROOT `marketing_auditor`', async () => {
      resolvesRootUid();
      checkSingleAccess.mockResolvedValue(true);

      const result = await service.checkRootMarketingAuditor(req);

      expect(result).toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'project', id: 'uid-root', access: 'marketing_auditor' });
    });

    it('fails closed when the NATS ROOT lookup throws', async () => {
      natsRequest.mockRejectedValue(new Error('nats timeout'));

      const result = await service.checkRootMarketingAuditor(req);

      expect(result).toBe(false);
      expect(checkSingleAccess).not.toHaveBeenCalled();
    });
  });

  describe('getPersonas — campaign access OR path', () => {
    function personaEnv(): void {
      natsRequest.mockImplementation((subject: string) => {
        if (subject.includes('personas')) {
          return Promise.resolve({ data: JSON.stringify({ projects: [] }) });
        }
        return Promise.resolve({ data: 'uid-root' });
      });
    }

    it('is granted via the ROOT `marketing_ops` short-circuit without ever consulting the project slug', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { access: string }) => Promise.resolve(args.access === 'marketing_ops'));

      const response = await service.getPersonas(req, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(true);
      expect(getProjectIdBySlug).not.toHaveBeenCalled();
    });

    it('falls back to the requested project scoped `campaign_manager` when ROOT `marketing_ops` is absent', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string; access: string }) => {
        if (args.access === 'marketing_ops') return Promise.resolve(false);
        return Promise.resolve(args.id === 'uid-project' && args.access === 'campaign_manager');
      });
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'project', id: 'uid-project', access: 'campaign_manager' });
    });

    it('denies campaign access when neither ROOT nor the project grant is present', async () => {
      personaEnv();
      checkSingleAccess.mockResolvedValue(false);
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
    });

    it('denies campaign access without ever calling the project check when no projectSlug is given', async () => {
      personaEnv();
      checkSingleAccess.mockResolvedValue(false);

      const response = await service.getPersonas(req, undefined, 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
      expect(getProjectIdBySlug).not.toHaveBeenCalled();
    });

    it('fails closed when the project slug does not resolve to an existing project', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { access: string }) => Promise.resolve(args.access === 'campaign_manager'));
      getProjectIdBySlug.mockResolvedValue({ uid: '', slug: 'ghost-project', exists: false });

      const response = await service.getPersonas(req, 'ghost-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
    });

    it('fails closed when the upstream project-slug lookup throws', async () => {
      personaEnv();
      checkSingleAccess.mockResolvedValue(false);
      getProjectIdBySlug.mockRejectedValue(new Error('nats unavailable'));

      const response = await service.getPersonas(req, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
      expect(logger.warning).toHaveBeenCalled();
    });
  });

  describe('getPersonas — marketing auditor OR path', () => {
    function personaEnv(): void {
      natsRequest.mockImplementation((subject: string) => {
        if (subject.includes('personas')) {
          return Promise.resolve({ data: JSON.stringify({ projects: [] }) });
        }
        return Promise.resolve({ data: 'uid-root' });
      });
    }

    it('is granted via the ROOT `marketing_auditor` short-circuit', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { access: string }) => Promise.resolve(args.access === 'marketing_auditor'));

      const response = await service.getPersonas(req, 'some-project', 'marketing_auditor');

      expect(response.isMarketingAuditor).toBe(true);
      expect(getProjectIdBySlug).not.toHaveBeenCalled();
    });

    it('falls back to the requested project scoped `marketing_auditor` when ROOT is absent', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string; access: string }) =>
        Promise.resolve(args.id === 'uid-project' && args.access === 'marketing_auditor')
      );
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'marketing_auditor');

      expect(response.isMarketingAuditor).toBe(true);
    });
  });

  describe('getPersonas — marketingRelations dedup and skip', () => {
    function personaEnv(): void {
      natsRequest.mockImplementation((subject: string) => {
        if (subject.includes('personas')) {
          return Promise.resolve({ data: JSON.stringify({ projects: [] }) });
        }
        return Promise.resolve({ data: 'uid-root' });
      });
    }

    it('dedupes the slug -> uid lookup across both marketing checks when marketingRelations is `both`', async () => {
      personaEnv();
      // Both ROOT checks (`marketing_ops`, `marketing_auditor`) fail, forcing checkMarketingAuditorAccess
      // AND checkCampaignManagerAccess to each fall through to the project-scoped lookup via
      // resolveProjectSlug — the path that exercises projectSlugRequestCache.
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string; access: string }) => {
        if (args.id === 'uid-root') return Promise.resolve(false);
        return Promise.resolve(args.id === 'uid-project' && (args.access === 'marketing_auditor' || args.access === 'campaign_manager'));
      });
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'both');

      expect(response.isMarketingAuditor).toBe(true);
      expect(response.isCampaignManager).toBe(true);
      // A regression dropping projectSlugRequestCache would call getProjectIdBySlug twice here.
      expect(getProjectIdBySlug).toHaveBeenCalledTimes(1);
    });

    it('skips both marketing FGA round trips when marketingRelations is `none`', async () => {
      personaEnv();
      checkSingleAccess.mockResolvedValue(true);
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'none');

      expect(response.isMarketingAuditor).toBe(false);
      expect(response.isCampaignManager).toBe(false);
      expect(getProjectIdBySlug).not.toHaveBeenCalled();
      expect(checkSingleAccess).not.toHaveBeenCalledWith(req, expect.objectContaining({ access: 'marketing_auditor' }));
      expect(checkSingleAccess).not.toHaveBeenCalledWith(req, expect.objectContaining({ access: 'marketing_ops' }));
      expect(checkSingleAccess).not.toHaveBeenCalledWith(req, expect.objectContaining({ access: 'campaign_manager' }));
    });
  });
});
