// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { FormationPipelineQuery, UpstreamPipelineProject, UpstreamPipelineSettings } from '@lfx-one/shared/interfaces';
import { FORMATION_PIPELINE_STAGES } from '@lfx-one/shared/constants';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const natsRequest = vi.fn();
const proxyRequest = vi.fn();
const checkSingleAccess = vi.fn();

vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccess = (...args: unknown[]) => checkSingleAccess(...args);
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = (...args: unknown[]) => proxyRequest(...args);
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('./nats.service', () => ({
  NatsService: vi.fn().mockImplementation(function () {
    return { getCodec: () => ({ encode: (v: string) => v, decode: (v: unknown) => v as string }), request: natsRequest };
  }),
}));

const { FormationPipelineService } = await import('./formation-pipeline.service');
const { logger } = await import('./logger.service');
const { resetRootProjectUidCacheForTests } = await import('../helpers/root-project.helper');

const req = { path: '/api/formations/pipeline' } as Request;
const allStages: FormationPipelineQuery = { stages: [...FORMATION_PIPELINE_STAGES] };

function project(overrides: Partial<UpstreamPipelineProject>): UpstreamPipelineProject {
  return { uid: 'p1', slug: 'p1', name: 'Alpha', stage: 'Formation - Engaged', parent_uid: '', ...overrides };
}

function resources<T>(items: T[]) {
  return { resources: items.map((data) => ({ type: 'x', id: 'x', data })) };
}

interface Fixtures {
  projects?: UpstreamPipelineProject[];
  settings?: UpstreamPipelineSettings[];
  checklistUids?: string[];
  parents?: Record<string, { uid: string; name: string; parent_uid?: string; is_foundation?: boolean }>;
}

function mockUpstream({ projects = [], settings = [], checklistUids = [], parents = {} }: Fixtures): void {
  proxyRequest.mockImplementation(async (_req: unknown, _service: string, _path: string, _method: string, params: Record<string, unknown>) => {
    if (params['type'] === 'project') {
      const filters = params['filters_or'] as string[];
      if (filters[0].startsWith('stage:')) return resources(projects);
      return resources(filters.map((filter) => parents[filter.slice(4)]).filter(Boolean));
    }
    if (params['type'] === 'project_settings') return resources(settings);
    if (params['type'] === 'formation') return resources(checklistUids.map((uid) => ({ project_uid: uid })));
    throw new Error(`unexpected read ${String(params['type'])}`);
  });
}

describe('FormationPipelineService.getPipeline', () => {
  let service: InstanceType<typeof FormationPipelineService>;

  beforeEach(() => {
    vi.mocked(logger.warning).mockClear();
    natsRequest.mockReset();
    natsRequest.mockResolvedValue({ data: '' });
    resetRootProjectUidCacheForTests();
    proxyRequest.mockReset();
    checkSingleAccess.mockReset();
    checkSingleAccess.mockResolvedValue(true);
    service = new FormationPipelineService();
  });

  it('rejects a non-member with FORMATION_TEAM_REQUIRED and makes no upstream call', async () => {
    checkSingleAccess.mockResolvedValue(false);

    await expect(service.getPipeline(req, allStages)).rejects.toMatchObject({ statusCode: 403, code: 'FORMATION_TEAM_REQUIRED' });

    expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'team', id: 'formation', access: 'member' });
    expect(proxyRequest).not.toHaveBeenCalled();
    expect(natsRequest).not.toHaveBeenCalled();
  });

  it('reads every non-Active stage with filters_or and never asks for Active', async () => {
    mockUpstream({});

    await service.getPipeline(req, allStages);

    const params = proxyRequest.mock.calls.find((call) => call[4]?.type === 'project' && call[4].filters_or[0].startsWith('stage:'))?.[4];
    expect(params.filters_or).toEqual([
      'stage:Prospect',
      'stage:Formation - Exploratory',
      'stage:Formation - Engaged',
      'stage:Formation - On Hold',
      'stage:Formation - Disengaged',
      'stage:Formation - Confidential',
      'stage:Archived',
    ]);
    expect(params.filters_or).not.toContain('stage:Active');
  });

  it('applies the stage selection to rows but not to counts', async () => {
    mockUpstream({
      projects: [
        project({ uid: 'a', name: 'A', stage: 'Prospect' }),
        project({ uid: 'b', name: 'B', stage: 'Formation - Engaged' }),
        project({ uid: 'c', name: 'C', stage: 'Archived' }),
      ],
    });

    const result = await service.getPipeline(req, { stages: ['engaged'] });

    expect(result.rows.map((row) => row.uid)).toEqual(['b']);
    expect(result.counts).toMatchObject({ prospect: 1, engaged: 1, archived: 1, total: 3 });
  });

  it('drops a project whose stage is not a pipeline stage', async () => {
    mockUpstream({ projects: [project({ uid: 'a', stage: 'Active' }), project({ uid: 'b', stage: 'Prospect' })] });

    const result = await service.getPipeline(req, allStages);

    expect(result.rows.map((row) => row.uid)).toEqual(['b']);
    expect(result.counts.total).toBe(1);
  });

  it('joins settings by uid and sets has_checklist from the formation read', async () => {
    mockUpstream({
      projects: [project({ uid: 'a', name: 'A' }), project({ uid: 'b', name: 'B' })],
      settings: [{ uid: 'a', announcement_date: '2026-12-01T00:00:00Z', executive_director: { name: 'Ed', email: 'ed@example.com', avatar: 'secret.png' } }],
      checklistUids: ['b'],
    });

    const { rows } = await service.getPipeline(req, allStages);
    const a = rows.find((row) => row.uid === 'a');
    const b = rows.find((row) => row.uid === 'b');

    expect(a).toMatchObject({ announcement_date: '2026-12-01T00:00:00Z', executive_director: { name: 'Ed', email: 'ed@example.com' }, has_checklist: false });
    expect(a?.executive_director).not.toHaveProperty('avatar');
    expect(b).toMatchObject({ announcement_date: null, executive_director: null, program_manager: null, opportunity_owner: null, has_checklist: true });
  });

  it('gives empty fields, not an error, when a project has no settings document', async () => {
    mockUpstream({ projects: [project({ uid: 'a' })], settings: [] });

    const { rows } = await service.getPipeline(req, allStages);

    expect(rows[0]).toMatchObject({ announcement_date: null, executive_director: null, opportunity_owner: null });
  });

  it('reads settings with uid filters in chunks of the batch size', async () => {
    const many = Array.from({ length: 101 }, (_, i) => project({ uid: `u${i}`, name: `N${String(i).padStart(3, '0')}` }));
    mockUpstream({ projects: many });

    await service.getPipeline(req, allStages);

    const settingsCalls = proxyRequest.mock.calls.filter((call) => call[4]?.type === 'project_settings');
    expect(settingsCalls).toHaveLength(2);
    expect(settingsCalls[0][4].filters_or).toHaveLength(100);
    expect(settingsCalls[0][4].filters_or[0]).toBe('uid:u0');
  });

  it('fails the request when a settings read fails instead of returning blank fields', async () => {
    mockUpstream({ projects: [project({ uid: 'a' })] });
    const ok = proxyRequest.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
    proxyRequest.mockImplementation(async (...args: unknown[]) => {
      if ((args[4] as Record<string, unknown>)['type'] === 'project_settings') throw new Error('boom');
      return ok(...args);
    });

    await expect(service.getPipeline(req, allStages)).rejects.toThrow();
  });

  it('filters by name search, case-insensitively', async () => {
    mockUpstream({ projects: [project({ uid: 'a', name: 'Open Fleet' }), project({ uid: 'b', name: 'Rail Exchange' })] });

    const { rows, counts } = await service.getPipeline(req, { ...allStages, search: 'fleet' });

    expect(rows.map((row) => row.uid)).toEqual(['a']);
    expect(counts.total).toBe(1);
  });

  it('resolves the parent foundation name and collapses the ROOT parent to null', async () => {
    natsRequest.mockResolvedValue({ data: 'root-uid' });
    mockUpstream({
      projects: [project({ uid: 'a', name: 'A', parent_uid: 'f1' }), project({ uid: 'b', name: 'B', parent_uid: 'root-uid' })],
      parents: { f1: { uid: 'f1', name: 'Foundation One', is_foundation: true } },
    });

    const { rows } = await service.getPipeline(req, allStages);

    expect(rows.find((row) => row.uid === 'a')?.parent).toEqual({ uid: 'f1', name: 'Foundation One' });
    expect(rows.find((row) => row.uid === 'b')?.parent).toBeNull();
  });

  it('limits to a foundation subtree through an Active intermediate parent', async () => {
    mockUpstream({
      projects: [
        project({ uid: 'in', name: 'Inside', parent_uid: 'mid' }),
        project({ uid: 'direct', name: 'Direct', parent_uid: 'F' }),
        project({ uid: 'out', name: 'Outside', parent_uid: 'other' }),
      ],
      parents: {
        mid: { uid: 'mid', name: 'Mid', parent_uid: 'F' },
        F: { uid: 'F', name: 'Foundation', is_foundation: true },
        other: { uid: 'other', name: 'Other' },
      },
    });

    const { rows, counts } = await service.getPipeline(req, { ...allStages, foundationUid: 'F' });

    expect(rows.map((row) => row.uid).sort()).toEqual(['direct', 'in']);
    expect(counts.total).toBe(2);
  });

  it('terminates on a parent cycle', async () => {
    mockUpstream({
      projects: [project({ uid: 'a', parent_uid: 'x' })],
      parents: { x: { uid: 'x', name: 'X', parent_uid: 'y' }, y: { uid: 'y', name: 'Y', parent_uid: 'x' } },
    });

    const { rows } = await service.getPipeline(req, { ...allStages, foundationUid: 'F' });

    expect(rows).toEqual([]);
  });

  it('reads each level of parents in batches, not one read per row', async () => {
    const many = Array.from({ length: 150 }, (_, i) => project({ uid: `c${i}`, name: `N${String(i).padStart(3, '0')}`, parent_uid: `p${i}` }));
    const parents = Object.fromEntries(many.map((_, i) => [`p${i}`, { uid: `p${i}`, name: `P${i}`, is_foundation: true }]));
    mockUpstream({ projects: many, parents });

    await service.getPipeline(req, allStages);

    const parentReads = proxyRequest.mock.calls.filter((call) => call[4]?.type === 'project' && call[4].filters_or[0].startsWith('uid:'));
    expect(parentReads).toHaveLength(2);
    expect(parentReads[0][4].filters_or).toHaveLength(100);
    expect(parentReads[1][4].filters_or).toHaveLength(50);
  });

  it('fails the request when a parent read fails instead of dropping rows', async () => {
    mockUpstream({ projects: [project({ uid: 'a', parent_uid: 'p' })] });
    const ok = proxyRequest.getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
    proxyRequest.mockImplementation(async (...args: unknown[]) => {
      const params = args[4] as Record<string, unknown>;
      if (params['type'] === 'project' && (params['filters_or'] as string[])[0].startsWith('uid:')) throw new Error('boom');
      return ok(...args);
    });

    await expect(service.getPipeline(req, { ...allStages, foundationUid: 'F' })).rejects.toThrow();
  });

  it('keeps a row whose parent has no document in All foundations, warns with the uid, and drops it under a foundation filter', async () => {
    mockUpstream({ projects: [project({ uid: 'a', parent_uid: 'ghost' })] });

    const all = await service.getPipeline(req, allStages);
    expect(all.rows.map((row) => row.uid)).toEqual(['a']);
    expect(all.rows[0].parent).toBeNull();
    expect(logger.warning).toHaveBeenCalledWith(req, 'get_formation_pipeline', expect.any(String), expect.objectContaining({ parent_uid: 'ghost' }));

    const scoped = await service.getPipeline(req, { ...allStages, foundationUid: 'F' });
    expect(scoped.rows).toEqual([]);
  });

  it('warns with the uid when the ancestry walk reaches the depth cap', async () => {
    const chain: Record<string, { uid: string; name: string; parent_uid: string }> = {};
    for (let i = 0; i < 12; i++) chain[`x${i}`] = { uid: `x${i}`, name: `X${i}`, parent_uid: `x${i + 1}` };
    mockUpstream({ projects: [project({ uid: 'a', parent_uid: 'x0' })], parents: chain });

    await service.getPipeline(req, { ...allStages, foundationUid: 'F' });

    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'get_formation_pipeline',
      'Parent walk stopped at the depth cap',
      expect.objectContaining({ parent_uids: ['x8'] })
    );
  });

  it('reports the nearest foundation ancestor, not the direct parent, for a project under an Active child of a foundation', async () => {
    mockUpstream({
      projects: [project({ uid: 'c', name: 'Nested', parent_uid: 'm' })],
      parents: {
        m: { uid: 'm', name: 'Active Mid', parent_uid: 'F' },
        F: { uid: 'F', name: 'Top Foundation', is_foundation: true },
      },
    });

    const { rows } = await service.getPipeline(req, allStages);

    expect(rows[0].parent).toEqual({ uid: 'F', name: 'Top Foundation' });
    const parentReads = proxyRequest.mock.calls.filter((call) => call[4]?.type === 'project' && call[4].filters_or[0].startsWith('uid:'));
    expect(parentReads.map((call) => call[4].filters_or)).toEqual([['uid:m'], ['uid:F']]);
  });

  it('uses a direct foundation parent as is, and the nearest of two nested foundations', async () => {
    mockUpstream({
      projects: [project({ uid: 'a', name: 'A', parent_uid: 'sub' })],
      parents: {
        sub: { uid: 'sub', name: 'Sub Foundation', parent_uid: 'F', is_foundation: true },
        F: { uid: 'F', name: 'Top Foundation', is_foundation: true },
      },
    });

    const { rows } = await service.getPipeline(req, allStages);

    expect(rows[0].parent).toEqual({ uid: 'sub', name: 'Sub Foundation' });
  });

  it('lets the foundation filter select a foundation whose only pipeline projects sit under an Active child', async () => {
    mockUpstream({
      projects: [project({ uid: 'c', name: 'Nested', parent_uid: 'm' })],
      parents: {
        m: { uid: 'm', name: 'Active Mid', parent_uid: 'F' },
        F: { uid: 'F', name: 'Top Foundation', is_foundation: true },
      },
    });

    const { rows } = await service.getPipeline(req, { ...allStages, foundationUid: 'F' });

    expect(rows.map((row) => row.uid)).toEqual(['c']);
    expect(rows[0].parent).toEqual({ uid: 'F', name: 'Top Foundation' });
  });

  it('gives no foundation for a project whose chain holds none', async () => {
    mockUpstream({
      projects: [project({ uid: 'c', parent_uid: 'm' })],
      parents: { m: { uid: 'm', name: 'Plain Parent' } },
    });

    const { rows } = await service.getPipeline(req, allStages);

    expect(rows[0].parent).toBeNull();
  });
});
