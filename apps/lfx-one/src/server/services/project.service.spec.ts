// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectFunding } from '@lfx-one/shared/enums';
import type { Project, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meeting.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub. `ProjectService`'s
// constructor also builds `NatsService`/`SnowflakeService`/`ETagService` — none of the methods
// under test here touch them, so they're stubbed to trivial classes to keep construction cheap.
const { proxyRequest, addAccessToResources, checkAccess, snowflakeExecute } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  addAccessToResources: vi.fn(),
  checkAccess: vi.fn(),
  snowflakeExecute: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({
  EVENT_GROWTH_TOP_EVENTS_LIMIT: 0,
  getYearForRange: vi.fn(),
  HEALTH_METRICS_RANGES: {},
  isHealthMetricsRange: vi.fn(),
  NATS_CONFIG: {},
  PENDING_ACTION_SEVERITY: {},
  PENDING_ACTION_SURVEYS_ROW_LIMIT: 0,
  PROJECT_HEALTH_SCORE_CATEGORIES: [],
  ROOT_PROJECT_SLUG: 'root',
}));
vi.mock('@lfx-one/shared/enums', () => ({}));
// computeIsFoundation and summarizeWriterGrants are pulled in from the REAL implementation
// (not hand-copied) so foundation-classification drift — e.g. a change to computeIsFoundation's
// Membership/stage rules — fails these tests too. summarizeWriterGrants's own `writer === true`
// filter can't be exercised from here (getDirectGrantProjects has already applied it before
// getWriterSummary ever calls summarizeWriterGrants); that's covered by
// packages/shared/src/utils/project.utils.spec.ts. Other `@lfx-one/shared/utils` exports this
// file doesn't touch stay stubbed.
//
// Deep-imports the single pure file rather than `vi.importActual('@lfx-one/shared/utils')`:
// the barrel re-exports Angular-dependent utils that pull in `@angular/common`'s `PlatformLocation`,
// which needs the Angular JIT compiler — unavailable under this plain-Node Vitest environment, so
// importing the barrel here throws at module-load time. `project.utils.ts` itself has no such
// dependency.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/project.utils')>(
    '../../../../../packages/shared/src/utils/project.utils'
  );
  return {
    computeIsFoundation: actual.computeIsFoundation,
    summarizeWriterGrants: actual.summarizeWriterGrants,
    getDefaultMarketingImpactMonth: vi.fn(),
    nullifyEmptyStrings: vi.fn(),
    resolvePeriodRange: vi.fn(),
  };
});
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public addAccessToResources = addAccessToResources;
    public checkAccess = checkAccess;
  },
}));
vi.mock('./nats.service', () => ({ NatsService: class {} }));
vi.mock('./etag.service', () => ({ ETagService: class {} }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute: snowflakeExecute }) } }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { ProjectService } from './project.service';

const req = {} as unknown as Request;

function pageOf(projects: Partial<Project>[], pageToken?: string): QueryServiceResponse<Project> {
  return { resources: projects.map((p) => ({ id: `project:${p.uid}`, data: p as Project })), page_token: pageToken } as QueryServiceResponse<Project>;
}

/** Every param object any of the three create-picker project methods sent to the query service. */
function paramsSentTo(type: 'project'): Record<string, any>[] {
  return proxyRequest.mock.calls.filter((call) => call[3] === 'GET' && call[2] === '/query/resources' && call[4]?.type === type).map((call) => call[4]);
}

describe('ProjectService — create picker methods', () => {
  let service: ProjectService;

  beforeEach(() => {
    proxyRequest.mockReset();
    addAccessToResources.mockReset();
    checkAccess.mockReset();
    service = new ProjectService();
  });

  describe('getDirectGrantProjects', () => {
    it('queries filter_grants=direct and returns only writer-permitted projects', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([
          { uid: 'a', slug: 'a' },
          { uid: 'b', slug: 'b' },
        ])
      );
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) =>
        Promise.resolve(projects.map((p) => ({ ...p, writer: p.uid === 'a' })))
      );

      const result = await service.getDirectGrantProjects(req);

      expect(result.map((p) => p.uid)).toEqual(['a']);
      expect(proxyRequest).toHaveBeenCalledTimes(1);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', filter_grants: 'direct' });
    });

    it('excludes the ROOT pseudo-project', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'root', slug: 'root' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getDirectGrantProjects(req);

      expect(result).toEqual([]);
      expect(addAccessToResources).not.toHaveBeenCalled();
    });

    it('OR-includes meeting_coordinator when requested, without re-checking existing writers', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([
          { uid: 'a', slug: 'a' },
          { uid: 'b', slug: 'b' },
        ])
      );
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) =>
        Promise.resolve(projects.map((p) => ({ ...p, writer: p.uid === 'a' })))
      );
      checkAccess.mockResolvedValueOnce(new Map([['b#meeting_coordinator', true]]));

      const result = await service.getDirectGrantProjects(req, true);

      expect(result.map((p) => p.uid).sort()).toEqual(['a', 'b']);
      // Only the non-writer ('b') needed the extra round trip.
      expect(checkAccess).toHaveBeenCalledTimes(1);
      expect(checkAccess.mock.calls[0][1]).toEqual([{ resource: 'project', id: 'b', access: 'meeting_coordinator' }]);
    });
  });

  // Membership-funded + Active + not an Internal Allocation, per the real computeIsFoundation.
  function foundation(uid: string): Partial<Project> {
    return { uid, slug: uid, stage: 'Active', legal_entity_type: '', funding: 'Funded' as ProjectFunding, funding_model: ['Membership'] };
  }
  // Missing the Membership funding model — the real computeIsFoundation returns false.
  function nonFoundation(uid: string): Partial<Project> {
    return { uid, slug: uid, stage: 'Active', legal_entity_type: '', funding: 'Funded' as ProjectFunding, funding_model: [] };
  }

  describe('getWriterSummary', () => {
    it('returns {true, false} when the only direct-writer project is a foundation', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([foundation('fdn')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: true, hasWriterProject: false });
    });

    it('returns {false, true} when the only direct-writer project is non-foundation', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([nonFoundation('proj')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: false, hasWriterProject: true });
    });

    it('returns {true, true} when direct-writer grants span both a foundation and a non-foundation project', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([foundation('fdn'), nonFoundation('proj')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: true, hasWriterProject: true });
    });

    it('returns {false, false} when the caller holds no direct writer grants', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([foundation('visible-only')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: false }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: false, hasWriterProject: false });
    });

    it('propagates upstream errors rather than resolving a fail-closed summary', async () => {
      proxyRequest.mockRejectedValueOnce(new Error('upstream unavailable'));

      await expect(service.getWriterSummary(req)).rejects.toThrow('upstream unavailable');
    });
  });

  describe('getChildProjects', () => {
    it('queries parent=project:<uid> and filters to writer-permitted children', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'child-1', slug: 'child-1' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getChildProjects(req, 'parent-uid');

      expect(result.map((p) => p.uid)).toEqual(['child-1']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', parent: 'project:parent-uid' });
    });
  });

  describe('searchCreatableProjects', () => {
    it('queries name=<term> with a small page size and filters to writer-permitted matches', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'match-1', slug: 'match-1' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.searchCreatableProjects(req, 'kubernetes');

      expect(result.map((p) => p.uid)).toEqual(['match-1']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', name: 'kubernetes', page_size: 20 });
    });

    it('continues to the next page when the first page has no writer-permitted matches', async () => {
      // Page 1: visible-but-non-writable matches only. Page 2: the actual inherited-writer match.
      // A single-page search would return [] here even though a real target exists.
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'visible-only', slug: 'visible-only' }], 'token-2'));
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'inherited-writer', slug: 'inherited-writer' }]));
      addAccessToResources.mockImplementation((_req: Request, projects: Project[]) =>
        Promise.resolve(projects.map((p) => ({ ...p, writer: p.uid === 'inherited-writer' })))
      );

      const result = await service.searchCreatableProjects(req, 'kubernetes');

      expect(result.map((p) => p.uid)).toEqual(['inherited-writer']);
      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(proxyRequest.mock.calls[1][4]).toMatchObject({ page_token: 'token-2' });
    });

    it('stops paging once the page cap is reached, even if pages remain', async () => {
      proxyRequest.mockResolvedValue(pageOf([{ uid: 'no-match', slug: 'no-match' }], 'more'));
      addAccessToResources.mockImplementation((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: false }))));

      const result = await service.searchCreatableProjects(req, 'kubernetes');

      expect(result).toEqual([]);
      expect(proxyRequest).toHaveBeenCalledTimes(5);
    });
  });

  it('never issues a type=project query-service call without filter_grants, parent, or name', async () => {
    proxyRequest.mockResolvedValue(pageOf([]));
    addAccessToResources.mockImplementation((_req: Request, projects: Project[]) => Promise.resolve(projects));

    await service.getDirectGrantProjects(req);
    await service.getChildProjects(req, 'uid-1');
    await service.searchCreatableProjects(req, 'term');

    const calls = paramsSentTo('project');
    expect(calls.length).toBeGreaterThan(0);
    for (const params of calls) {
      expect(params['filter_grants'] === 'direct' || typeof params['parent'] === 'string' || typeof params['name'] === 'string').toBe(true);
    }
  });
});

describe('ProjectService — Snowflake-backed marketing reads', () => {
  let service: ProjectService;

  beforeEach(() => {
    snowflakeExecute.mockReset();
    service = new ProjectService();
  });

  describe('getSocialReach', () => {
    // Regression guard for the zero-fill bug: this method used to swallow Snowflake failures and
    // resolve a defaults object, which reached the dashboard as a 200 and rendered "zero spend,
    // 0.0x ROAS" — indistinguishable from a genuine measurement of zero. The rethrow is the whole
    // contract the callers' unavailable states depend on, so it needs coverage of its own;
    // otherwise a later refactor could reinstate the fallback with every test still green.
    it('propagates Snowflake failures rather than resolving zero-filled defaults', async () => {
      const failure = new Error('snowflake timeout');
      snowflakeExecute.mockRejectedValue(failure);

      await expect(service.getSocialReach('tlf', undefined, { start: '2026-01-01', end: '2026-07-01', label: 'test' } as any)).rejects.toBe(failure);
    });
  });
});
