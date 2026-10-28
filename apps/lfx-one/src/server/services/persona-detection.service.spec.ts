// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkSingleAccess, checkAccess, getProjectIdBySlug, natsRequest, logger } = vi.hoisted(() => ({
  checkSingleAccess: vi.fn(),
  checkAccess: vi.fn(),
  getProjectIdBySlug: vi.fn(),
  natsRequest: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

// The strict variants answer from the same stubs (a stub that rejects stands in for an upstream
// failure), so tests read the same either way; only the service's handling of a rejection differs.
vi.mock('./access-check.service', () => ({
  AccessCheckService: vi.fn().mockImplementation(() => ({
    checkSingleAccess,
    checkAccess,
    checkSingleAccessStrict: (...args: unknown[]) => checkSingleAccess(...args),
    checkAccessStrict: (...args: unknown[]) => checkAccess(...args),
  })),
}));

// Answers a batched check from the per-relation stub each test sets on checkSingleAccess, without
// recording checkSingleAccess calls, so a test can tell one batch apart from separate round trips.
function answerBatchesFromSingleAccessStub(): void {
  checkAccess.mockImplementation(async (r: Request, resources: { id: string; access: string }[]) => {
    const answer = checkSingleAccess.getMockImplementation();
    const entries = await Promise.all(resources.map(async (resource) => [`${resource.id}#${resource.access}`, Boolean(await answer?.(r, resource))] as const));
    return new Map(entries);
  });
}

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

import { resetRootProjectUidCacheForTests } from '../helpers/root-project.helper';
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
    checkAccess.mockReset();
    answerBatchesFromSingleAccessStub();
    getProjectIdBySlug.mockReset();
    natsRequest.mockReset();
    logger.warning.mockReset();
    // getPersonas's isMarketingAuditor/isCampaignManager fan-out is gated by this flag — the
    // "marketing auditor / campaign access OR path" tests below need it on to exercise checkMarketingAuditorAccess
    // / checkCampaignManagerAccess at all.
    process.env[ServerFeatureFlag.MarketingOpsFga] = 'true';
    // resolveRootProjectUid's cache is module-level (shared across every consumer by design — see
    // root-project.helper.ts) and would otherwise leak a resolved/failed ROOT uid across `it()` blocks.
    resetRootProjectUidCacheForTests();
    service = new PersonaDetectionService();
  });

  afterEach(() => {
    delete process.env[ServerFeatureFlag.MarketingOpsFga];
  });

  describe('checkLFStaff', () => {
    // Staff-only by decision: its consumers are the dashboard / ED / marketing bypasses, none of
    // which were extended to contractors — and `OrgLensEventsService`, where a `true` DISCLOSES the
    // event registration goal. Adding `lf-contractor` back to this check fails here: the authorizer
    // is told the caller is a contractor and the answer must still be "not staff".
    it('asks the authorizer for `team:lf-staff` membership only — a contractor-only caller is not staff', async () => {
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string }) => Promise.resolve(args.id === 'lf-contractor'));

      const result = await service.checkLFStaff(req);

      expect(result).toBe(false);
      expect(checkSingleAccess).toHaveBeenCalledTimes(1);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'team', id: 'lf-staff', access: 'member' });
    });

    // The `.catch` here is load-bearing for `OrgLensEventsService`, which awaits this outside every
    // query try: a rejection would 500 the whole Events list, and reject unhandled on the early
    // returns that never await it, rather than withhold one field. Fail-closed
    // is also the right direction for a disclosure gate — a staff member briefly missing a number
    // they can get elsewhere beats an external admin seeing one they should not.
    it('degrades to `not staff` when the access check fails, rather than rejecting', async () => {
      checkSingleAccess.mockRejectedValue(new Error('fga unavailable'));

      await expect(service.checkLFStaff(req)).resolves.toBe(false);
    });
  });

  describe('checkRootCampaignManager', () => {
    it('checks ROOT `global_marketing_ops` only, not `marketing_ops` or `campaign_manager`', async () => {
      resolvesRootUid();
      checkSingleAccess.mockResolvedValue(false);

      const result = await service.checkRootCampaignManager(req);

      expect(result).toBe(false);
      expect(checkAccess).toHaveBeenCalledTimes(1);
      expect(checkAccess).toHaveBeenCalledWith(req, [{ resource: 'project', id: 'uid-root', access: 'global_marketing_ops' }]);
      expect(checkSingleAccess).not.toHaveBeenCalled();
    });

    it('is granted by ROOT `global_marketing_ops`', async () => {
      resolvesRootUid();
      checkSingleAccess.mockImplementation((_req: Request, args: { access: string }) => Promise.resolve(args.access === 'global_marketing_ops'));

      await expect(service.checkRootCampaignManager(req)).resolves.toBe(true);
    });

    it('fails closed when the ROOT uid cannot be resolved', async () => {
      natsRequest.mockResolvedValue({ data: '' });

      const result = await service.checkRootCampaignManager(req);

      expect(result).toBe(false);
      expect(checkAccess).not.toHaveBeenCalled();
    });

    it('fails closed when the access-check call rejects', async () => {
      resolvesRootUid();
      checkSingleAccess.mockRejectedValue(new Error('fga unavailable'));

      const result = await service.checkRootCampaignManager(req);

      expect(result).toBe(false);
      expect(logger.warning).toHaveBeenCalled();
    });
  });

  // Staff whose access is a per-project `global_writer`/`global_auditor` grant hold the guard
  // relations, not the bare ones — checking bare `writer`/`auditor` would silently drop them.
  describe('checkRootWriter / checkRootAuditor', () => {
    it('checks ROOT `writer_guard`', async () => {
      resolvesRootUid();
      checkSingleAccess.mockResolvedValue(true);

      await expect(service.checkRootWriter(req)).resolves.toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'project', id: 'uid-root', access: 'writer_guard' });
    });

    it('checks ROOT `auditor_guard`', async () => {
      resolvesRootUid();
      checkSingleAccess.mockResolvedValue(true);

      await expect(service.checkRootAuditor(req)).resolves.toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'project', id: 'uid-root', access: 'auditor_guard' });
    });

    it('checkProjectWriter checks `writer_guard` on the named project, failing closed for an unknown slug', async () => {
      getProjectIdBySlug.mockResolvedValueOnce({ uid: 'uid-project', slug: 'some-project', exists: true });
      checkSingleAccess.mockResolvedValue(true);

      await expect(service.checkProjectWriter(req, 'some-project')).resolves.toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'project', id: 'uid-project', access: 'writer_guard' });

      getProjectIdBySlug.mockResolvedValueOnce({ uid: '', slug: 'ghost', exists: false });
      await expect(service.checkProjectWriter(req, 'ghost')).resolves.toBe(false);
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

    it('is granted via ROOT `global_marketing_ops` when no projectSlug is given', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { access: string }) => Promise.resolve(args.access === 'global_marketing_ops'));

      const response = await service.getPersonas(req, undefined, 'campaign_manager');

      expect(response.isCampaignManager).toBe(true);
      expect(getProjectIdBySlug).not.toHaveBeenCalled();
    });

    it('fails closed when the ROOT result omits the relation', async () => {
      personaEnv();
      checkSingleAccess.mockResolvedValue(true);
      checkAccess.mockResolvedValue(new Map());

      const response = await service.getPersonas(req, undefined, 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
      expect(response.isCampaignManagerRootGrant).toBe(false);
    });

    // `global_marketing_ops` does not cascade, so a ROOT-only grant must not answer for a named
    // project; that project's own `campaign_manager` (which folds in the per-project grant) does.
    it('does not let a ROOT `global_marketing_ops` grant answer for a named project', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string; access: string }) =>
        Promise.resolve(args.id === 'uid-root' && args.access === 'global_marketing_ops')
      );
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
      expect(response.isCampaignManagerRootGrant).toBe(false);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'project', id: 'uid-project', access: 'campaign_manager' });
    });

    // The frontend stores a true `isCampaignManagerRootGrant` as a grant on every project, so a
    // non-cascading ROOT `global_marketing_ops` must not set it.
    it('reports a ROOT `global_marketing_ops` grant as not cascading', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string; access: string }) =>
        Promise.resolve((args.id === 'uid-root' && args.access === 'global_marketing_ops') || (args.id === 'uid-project' && args.access === 'campaign_manager'))
      );
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(true);
      expect(response.isCampaignManagerRootGrant).toBe(false);
    });

    it('is granted via the requested project scoped `campaign_manager`', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string; access: string }) => {
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

    it('reports a failed project grant check as unverified, not as a denial', async () => {
      personaEnv();
      checkSingleAccess.mockImplementation((_req: Request, args: { access: string }) =>
        args.access === 'campaign_manager' ? Promise.reject(new Error('fga unavailable')) : Promise.resolve(false)
      );
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas(req, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
      expect(response.marketingGrantCheckFailed).toBe(true);
    });

    it('reports a slug lookup that times out as unverified, asking the lookup not to read it as a missing project', async () => {
      personaEnv();
      checkSingleAccess.mockResolvedValue(false);
      getProjectIdBySlug.mockRejectedValue(new Error('timeout'));

      const response = await service.getPersonas({} as unknown as Request, 'some-project', 'campaign_manager');

      expect(getProjectIdBySlug).toHaveBeenCalledWith(expect.anything(), 'some-project', { unavailableAsMissing: false });
      expect(response.marketingGrantCheckFailed).toBe(true);
    });

    // Persona detection answers; only the ROOT slug -> uid lookup times out.
    function rootLookupTimesOut(): void {
      natsRequest.mockImplementation((subject: string) => {
        if (subject.includes('personas')) {
          return Promise.resolve({ data: JSON.stringify({ projects: [] }) });
        }
        return Promise.reject(new Error('timeout'));
      });
    }

    it('reports a ROOT lookup timeout on the campaign path (global_marketing_ops) as unverified', async () => {
      rootLookupTimesOut();
      checkSingleAccess.mockResolvedValue(true);

      const response = await service.getPersonas({} as unknown as Request, undefined, 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
      expect(response.marketingGrantCheckFailed).toBe(true);
      expect(checkAccess).not.toHaveBeenCalled();
    });

    it('treats a verified project grant as verified even when the ROOT check for the same relation failed', async () => {
      natsRequest.mockImplementation((subject: string) => {
        if (subject.includes('personas')) {
          return Promise.resolve({ data: JSON.stringify({ projects: [] }) });
        }
        return Promise.reject(new Error('timeout'));
      });
      checkSingleAccess.mockImplementation((_req: Request, args: { id: string; access: string }) =>
        Promise.resolve(args.id === 'uid-project' && args.access === 'marketing_auditor')
      );
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas({} as unknown as Request, 'some-project', 'marketing_auditor');

      expect(response.isMarketingAuditor).toBe(true);
      expect(response.marketingGrantCheckFailed).toBe(false);
    });

    it('reports a ROOT lookup timeout on the marketing-auditor path as unverified', async () => {
      rootLookupTimesOut();
      checkSingleAccess.mockResolvedValue(true);

      const response = await service.getPersonas({} as unknown as Request, undefined, 'marketing_auditor');

      expect(response.isMarketingAuditor).toBe(false);
      expect(response.marketingGrantCheckFailed).toBe(true);
    });

    it('does not count a failed ROOT lookup for a non-marketing check (auditor_guard) as a marketing failure', async () => {
      rootLookupTimesOut();
      checkSingleAccess.mockResolvedValue(false);

      const response = await service.getPersonas({} as unknown as Request, undefined, 'none');

      expect(response.isAuditor).toBe(false);
      expect(response.marketingGrantCheckFailed).toBe(false);
    });

    it('reports a plain denial as verified', async () => {
      personaEnv();
      checkSingleAccess.mockResolvedValue(false);
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-project', slug: 'some-project', exists: true });

      const response = await service.getPersonas({} as unknown as Request, 'some-project', 'campaign_manager');

      expect(response.isCampaignManager).toBe(false);
      expect(response.marketingGrantCheckFailed).toBe(false);
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
      // The ROOT `marketing_auditor` check fails, forcing checkMarketingAuditorAccess to fall through
      // to the project-scoped lookup that checkCampaignManagerAccess always makes for a named
      // project — both via resolveProjectSlug, the path that exercises projectSlugRequestCache.
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
      expect(checkSingleAccess).not.toHaveBeenCalledWith(req, expect.objectContaining({ access: 'campaign_manager' }));
    });
  });
});
