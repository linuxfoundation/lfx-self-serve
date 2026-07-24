// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Project, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meeting.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub. `ProjectService`'s
// constructor also builds `NatsService`/`SnowflakeService`/`ETagService` — none of the methods
// under test here touch them, so they're stubbed to trivial classes to keep construction cheap.
const { proxyRequest, addAccessToResources, checkAccess } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  addAccessToResources: vi.fn(),
  checkAccess: vi.fn(),
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
vi.mock('@lfx-one/shared/utils', () => ({
  computeIsFoundation: vi.fn(),
  getDefaultMarketingImpactMonth: vi.fn(),
  nullifyEmptyStrings: vi.fn(),
  resolvePeriodRange: vi.fn(),
}));
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
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({}) } }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { ProjectService } from './project.service';

const req = {} as unknown as Request;

function pageOf(projects: Partial<Project>[]): QueryServiceResponse<Project> {
  return { resources: projects.map((p) => ({ id: `project:${p.uid}`, data: p as Project })), page_token: undefined } as QueryServiceResponse<Project>;
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
      checkAccess.mockResolvedValueOnce(new Map([['b', true]]));

      const result = await service.getDirectGrantProjects(req, true);

      expect(result.map((p) => p.uid).sort()).toEqual(['a', 'b']);
      // Only the non-writer ('b') needed the extra round trip.
      expect(checkAccess).toHaveBeenCalledTimes(1);
      expect(checkAccess.mock.calls[0][1]).toEqual([{ resource: 'project', id: 'b', access: 'meeting_coordinator' }]);
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
