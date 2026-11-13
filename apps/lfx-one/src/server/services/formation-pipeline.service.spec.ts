// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { FormationPipelineQuery, UpstreamPipelineProject, UpstreamPipelineSettings } from '@lfx-one/shared/interfaces';
import { FORMATION_PIPELINE_STAGES } from '@lfx-one/shared/constants';
import { ProjectFunding } from '@lfx-one/shared/enums';
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
/** What the `type=project` index document carries for a membership-funded foundation; `is_foundation` is not stored, `computeIsFoundation` derives it. */
const FOUNDATION_FIELDS = { stage: 'Active', legal_entity_type: 'Non-profit', funding: ProjectFunding.Funded, funding_model: ['Membership'] };
/** An ordinary Active project: not funded by membership, so not a foundation. */
const PLAIN_FIELDS = { stage: 'Active', legal_entity_type: 'Non-profit', funding: ProjectFunding.SupportedByParent, funding_model: [] };

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
  parents?: Record<string, Partial<UpstreamPipelineProject> & { uid: string; name: string }>;
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

  // #5619 Part C: the PCC classification arrays ride on the `project` documents the pipeline already reads; no extra upstream call.
  it('maps the classification arrays: present, empty, missing and null', async () => {
    mockUpstream({
      projects: [
        project({
          uid: 'a',
          name: 'A',
          technical_activity_type: ['Open Source Software', 'Open Standard / Specification'],
          technology: ['Quantum'],
          industry: ['Finance'],
        }),
        project({ uid: 'b', name: 'B', technical_activity_type: [], technology: [], industry: [] }),
        project({ uid: 'c', name: 'C' }),
        project({ uid: 'd', name: 'D', technical_activity_type: null, technology: null, industry: null }),
        project({ uid: 'e', name: 'E', technology: [' Quantum ', 'Quantum', ''] }),
      ],
    });

    const { rows } = await service.getPipeline(req, allStages);
    const of = (uid: string) => rows.find((row) => row.uid === uid);

    expect(of('a')).toMatchObject({
      technical_activity_type: ['Open Source Software', 'Open Standard / Specification'],
      technology: ['Quantum'],
      industry: ['Finance'],
    });
    for (const uid of ['b', 'c', 'd']) {
      expect(of(uid)).toMatchObject({ technical_activity_type: [], technology: [], industry: [] });
    }
    expect(of('e')?.technology).toEqual(['Quantum']);
  });

  it('makes no extra upstream read for the classification fields', async () => {
    mockUpstream({ projects: [project({ uid: 'a', name: 'A', technology: ['Quantum'] })] });

    await service.getPipeline(req, allStages);

    const types = proxyRequest.mock.calls.map((call) => call[4]?.type);
    expect(types.filter((type) => type === 'project').length).toBeGreaterThanOrEqual(1);
    expect([...new Set(types)].sort()).toEqual(['formation', 'project', 'project_settings']);
  });

  // #5619 D8: the Formation Lead arrives on `project_settings.formation_lead`; values land once lfx-v1-sync-helper#216's backfill has run.
  it('serves the formation lead from settings (name, email, username only), and null when empty or missing', async () => {
    mockUpstream({
      projects: [project({ uid: 'a', name: 'A' }), project({ uid: 'b', name: 'B' }), project({ uid: 'c', name: 'C' }), project({ uid: 'd', name: 'D' })],
      settings: [
        { uid: 'a', formation_lead: { name: 'Lee Lead', email: 'lee@example.com', username: 'llead', avatar: 'secret.png' } },
        { uid: 'b', formation_lead: { name: '', email: '' } },
        { uid: 'c' },
      ],
    });

    const { rows } = await service.getPipeline(req, allStages);
    const lead = (uid: string) => rows.find((row) => row.uid === uid)?.formation_lead;

    expect(lead('a')).toEqual({ name: 'Lee Lead', email: 'lee@example.com', username: 'llead' });
    expect(lead('b')).toBeNull();
    expect(lead('c')).toBeNull();
    expect(lead('d')).toBeNull(); // no settings document at all
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
      parents: { f1: { uid: 'f1', name: 'Foundation One', ...FOUNDATION_FIELDS } },
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
        mid: { uid: 'mid', name: 'Mid', parent_uid: 'F', ...PLAIN_FIELDS },
        F: { uid: 'F', name: 'Foundation', ...FOUNDATION_FIELDS },
        other: { uid: 'other', name: 'Other', ...PLAIN_FIELDS },
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
    const parents = Object.fromEntries(many.map((_, i) => [`p${i}`, { uid: `p${i}`, name: `P${i}`, ...FOUNDATION_FIELDS }]));
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
        m: { uid: 'm', name: 'Active Mid', parent_uid: 'F', ...PLAIN_FIELDS },
        F: { uid: 'F', name: 'Top Foundation', ...FOUNDATION_FIELDS },
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
        sub: { uid: 'sub', name: 'Sub Foundation', parent_uid: 'F', ...FOUNDATION_FIELDS },
        F: { uid: 'F', name: 'Top Foundation', ...FOUNDATION_FIELDS },
      },
    });

    const { rows } = await service.getPipeline(req, allStages);

    expect(rows[0].parent).toEqual({ uid: 'sub', name: 'Sub Foundation' });
  });

  it('lets the foundation filter select a foundation whose only pipeline projects sit under an Active child', async () => {
    mockUpstream({
      projects: [project({ uid: 'c', name: 'Nested', parent_uid: 'm' })],
      parents: {
        m: { uid: 'm', name: 'Active Mid', parent_uid: 'F', ...PLAIN_FIELDS },
        F: { uid: 'F', name: 'Top Foundation', ...FOUNDATION_FIELDS },
      },
    });

    const { rows } = await service.getPipeline(req, { ...allStages, foundationUid: 'F' });

    expect(rows.map((row) => row.uid)).toEqual(['c']);
    expect(rows[0].parent).toEqual({ uid: 'F', name: 'Top Foundation' });
  });

  it('gives no foundation for a project whose chain holds none', async () => {
    mockUpstream({
      projects: [project({ uid: 'c', parent_uid: 'm' })],
      parents: { m: { uid: 'm', name: 'Plain Parent', ...PLAIN_FIELDS } },
    });

    const { rows } = await service.getPipeline(req, allStages);

    expect(rows[0].parent).toBeNull();
  });

  it('counts a checklist of any lifecycle (frozen included): the formation read has no lifecycle filter', async () => {
    mockUpstream({ projects: [project({ uid: 'd', name: 'Disengaged One', stage: 'Formation - Disengaged' })], checklistUids: ['d'] });

    const { rows } = await service.getPipeline(req, allStages);

    const formationRead = proxyRequest.mock.calls.find((call) => call[4]?.type === 'formation')?.[4];
    expect(formationRead.tags).toEqual(['project_uid:d']);
    expect(formationRead).not.toHaveProperty('tags_all');
    expect(rows[0].has_checklist).toBe(true);
  });

  describe('foundation classification (computeIsFoundation, not a stored flag)', () => {
    const under = (fields: Record<string, unknown>) =>
      mockUpstream({ projects: [project({ uid: 'c', parent_uid: 'f' })], parents: { f: { uid: 'f', name: 'Candidate', ...fields } } });

    it('counts a pre-launch Formation - Engaged foundation funded by membership', async () => {
      under({ ...FOUNDATION_FIELDS, stage: 'Formation - Engaged' });

      expect((await service.getPipeline(req, allStages)).rows[0].parent).toEqual({ uid: 'f', name: 'Candidate' });
    });

    it.each([
      ['an Internal Allocation', { legal_entity_type: 'Internal Allocation' }],
      ['an unfunded project', { funding: ProjectFunding.Unfunded }],
      ['a funded project without a Membership model', { funding_model: ['Sponsorship'] }],
      ['an Archived project', { stage: 'Archived' }],
      ['a document with no funding fields at all', { funding: undefined, funding_model: undefined, legal_entity_type: undefined }],
    ])('does not count %s', async (_label, override) => {
      under({ ...FOUNDATION_FIELDS, ...override });

      expect((await service.getPipeline(req, allStages)).rows[0].parent).toBeNull();
    });

    it('ignores a stray is_foundation field on the document: only the derived classification counts', async () => {
      under({ ...PLAIN_FIELDS, is_foundation: true });

      expect((await service.getPipeline(req, allStages)).rows[0].parent).toBeNull();
    });

    it('asks query-service for a whole project document (no field projection), so the classifying fields come back', async () => {
      under(FOUNDATION_FIELDS);

      await service.getPipeline(req, allStages);

      const parentRead = proxyRequest.mock.calls.find((call) => call[4]?.type === 'project' && call[4].filters_or[0].startsWith('uid:'))?.[4];
      expect(parentRead).not.toHaveProperty('fields');
      expect(parentRead).not.toHaveProperty('select');
    });
  });

  // #5619 D6: the IT test projects and everything under them are not real pipeline projects.
  describe('test projects', () => {
    const TEST_GROUP = { uid: 'tg', name: 'Test Project Group IT', ...FOUNDATION_FIELDS };

    it('drops a test project and its descendants from rows and counts, keeping real projects', async () => {
      mockUpstream({
        projects: [
          project({ uid: 'real', name: 'Real Project', parent_uid: 'F' }),
          project({ uid: 'self', name: 'Test Project IT', parent_uid: 'tg' }),
          project({ uid: 'child', name: 'Ordinary Name', parent_uid: 'tg' }),
          project({ uid: 'deep', name: 'Deeper', parent_uid: 'mid' }),
          project({ uid: 'draft', name: 'Test Project Group IT', stage: 'Prospect', parent_uid: '' }),
        ],
        parents: {
          F: { uid: 'F', name: 'Real Foundation', ...FOUNDATION_FIELDS },
          tg: TEST_GROUP,
          mid: { uid: 'mid', name: 'Active Middle', parent_uid: 'tg', ...PLAIN_FIELDS },
        },
      });

      const { rows, counts } = await service.getPipeline(req, allStages);

      expect(rows.map((row) => row.uid)).toEqual(['real']);
      expect(counts).toMatchObject({ engaged: 1, prospect: 0, total: 1 });
    });

    it('keeps them out when a foundation scope is selected', async () => {
      mockUpstream({
        projects: [project({ uid: 'real', name: 'Real Project', parent_uid: 'F' }), project({ uid: 'self', name: 'Test Project IT', parent_uid: 'F' })],
        parents: { F: { uid: 'F', name: 'Real Foundation', ...FOUNDATION_FIELDS } },
      });

      const { rows } = await service.getPipeline(req, { ...allStages, foundationUid: 'F' });

      expect(rows.map((row) => row.uid)).toEqual(['real']);
    });
  });

  // #5619 D7: classified by the row's DIRECT parent, never by `computeIsFoundation` (formation-stage projects almost never pass it).
  describe('foundation kind', () => {
    const LF = { uid: 'lf', slug: 'tlf', name: 'The Linux Foundation', ...FOUNDATION_FIELDS };
    const FUNDED = { legal_entity_type: 'Non-profit', funding: ProjectFunding.Funded, funding_model: ['Membership'] };
    const kindsOf = async () => Object.fromEntries((await service.getPipeline(req, allStages)).rows.map((row) => [row.uid, row.foundation_kind]));

    it('calls a project directly under The Linux Foundation under_lf, including an Engaged funded foundation and a plain project', async () => {
      mockUpstream({
        projects: [
          project({ uid: 'plain', name: 'Plain Under LF', parent_uid: 'lf' }),
          project({ uid: 'fund', name: 'Engaged Fund', stage: 'Formation - Engaged', parent_uid: 'lf', ...FUNDED }),
        ],
        parents: { lf: LF },
      });

      expect(await kindsOf()).toEqual({ plain: 'under_lf', fund: 'under_lf' });
    });

    it('calls a project under any other parent under_foundation, whether that parent is a foundation or a plain project', async () => {
      mockUpstream({
        projects: [project({ uid: 'sub', name: 'Under Foundation', parent_uid: 'F' }), project({ uid: 'deep', name: 'Under Active Child', parent_uid: 'mid' })],
        parents: {
          F: { uid: 'F', slug: 'f', name: 'Existing Foundation', parent_uid: 'lf', ...FOUNDATION_FIELDS },
          mid: { uid: 'mid', slug: 'mid', name: 'Active Mid', parent_uid: 'lf', ...PLAIN_FIELDS },
          lf: LF,
        },
      });

      expect(await kindsOf()).toEqual({ sub: 'under_foundation', deep: 'under_foundation' });
    });

    it("does not read the row's own foundation classification: a funded Engaged project under a foundation is under_foundation, not special", async () => {
      mockUpstream({
        projects: [project({ uid: 'fund', name: 'Funded Under Foundation', stage: 'Formation - Engaged', parent_uid: 'F', ...FUNDED })],
        parents: { F: { uid: 'F', slug: 'f', name: 'Existing Foundation', ...FOUNDATION_FIELDS } },
      });

      expect(await kindsOf()).toEqual({ fund: 'under_foundation' });
    });

    it('calls a project with no parent, an empty parent or the hidden ROOT parent no_parent, including a root-level separate entity', async () => {
      natsRequest.mockResolvedValue({ data: 'root-uid' });
      mockUpstream({
        projects: [
          project({ uid: 'none', name: 'No Parent', parent_uid: '' }),
          project({ uid: 'root', name: 'Under Root', parent_uid: 'root-uid' }),
          project({ uid: 'entity', name: 'Separate Entity', stage: 'Formation - Engaged', parent_uid: 'root-uid', ...FUNDED }),
        ],
      });

      expect(await kindsOf()).toEqual({ none: 'no_parent', root: 'no_parent', entity: 'no_parent' });
    });

    it('reads a parent query-service did not return as another parent, since it cannot be identified as The Linux Foundation', async () => {
      mockUpstream({ projects: [project({ uid: 'orphan', name: 'Orphan', parent_uid: 'gone' })], parents: {} });

      expect(await kindsOf()).toEqual({ orphan: 'under_foundation' });
    });
  });
});

// #5544: LF staff outside the formation team get a read-only view without Draft and Confidential projects.
describe('FormationPipelineService.getPipeline — LF staff view (#5544)', () => {
  let service: InstanceType<typeof FormationPipelineService>;
  /** Answers each team check separately: which of `formation` / `lf-staff` the caller belongs to. */
  const asMemberOf = (...teams: string[]) =>
    checkSingleAccess.mockImplementation(
      async (_req: unknown, resource: { resource: string; id: string }) => resource.resource === 'team' && teams.includes(resource.id)
    );
  const MIXED = [
    project({ uid: 'draft', name: 'Draft One', stage: 'Prospect' }),
    project({ uid: 'secret', name: 'Secret One', stage: 'Formation - Confidential' }),
    project({ uid: 'live', name: 'Live One', stage: 'Formation - Engaged' }),
    project({ uid: 'paused', name: 'Paused One', stage: 'Formation - On Hold' }),
    project({ uid: 'gone', name: 'Gone One', stage: 'Archived' }),
  ];

  beforeEach(() => {
    natsRequest.mockReset();
    natsRequest.mockResolvedValue({ data: '' });
    resetRootProjectUidCacheForTests();
    proxyRequest.mockReset();
    checkSingleAccess.mockReset();
    service = new FormationPipelineService();
  });

  it('serves the formation team the full view, marked formation_team', async () => {
    asMemberOf('formation');
    mockUpstream({ projects: MIXED });

    const result = await service.getPipeline(req, allStages);

    expect(result.viewer).toBe('formation_team');
    expect(result.rows.map((row) => row.uid).sort()).toEqual(['draft', 'gone', 'live', 'paused', 'secret']);
    expect(result.counts).toMatchObject({ prospect: 1, confidential: 1, total: 5 });
  });

  it('keeps the full view for a formation-team member who is also LF staff, and checks the team first', async () => {
    asMemberOf('formation', 'lf-staff');
    mockUpstream({ projects: MIXED });

    const result = await service.getPipeline(req, allStages);

    expect(result.viewer).toBe('formation_team');
    expect(result.rows).toHaveLength(5);
    expect(checkSingleAccess).toHaveBeenCalledTimes(1);
  });

  it('serves LF staff the read-only view: no Draft or Confidential in rows or counts', async () => {
    asMemberOf('lf-staff');
    mockUpstream({ projects: MIXED });

    const result = await service.getPipeline(req, allStages);

    expect(result.viewer).toBe('staff');
    expect(result.rows.map((row) => row.uid).sort()).toEqual(['gone', 'live', 'paused']);
    expect(result.counts).toMatchObject({ prospect: 0, confidential: 0, engaged: 1, on_hold: 1, archived: 1, total: 3 });
    expect(JSON.stringify(result)).not.toMatch(/Draft One|Secret One/);
  });

  it('does not ask upstream for Draft or Confidential on the staff view', async () => {
    asMemberOf('lf-staff');
    mockUpstream({});

    await service.getPipeline(req, allStages);

    const params = proxyRequest.mock.calls.find((call) => call[4]?.type === 'project' && call[4].filters_or[0].startsWith('stage:'))?.[4];
    expect(params.filters_or).not.toContain('stage:Prospect');
    expect(params.filters_or).not.toContain('stage:Formation - Confidential');
    expect(params.filters_or).toContain('stage:Formation - Engaged');
  });

  it('still drops a Draft project upstream returns anyway (a direct grant), and a stage query for it comes back empty', async () => {
    asMemberOf('lf-staff');
    // The mock ignores the stage filter, as query-service would for a caller holding a direct grant on the Draft project.
    mockUpstream({ projects: MIXED });

    const asked = await service.getPipeline(req, { stages: ['prospect', 'confidential'] });

    expect(asked.rows).toEqual([]);
    expect(asked.counts.prospect).toBe(0);
    expect(asked.counts.confidential).toBe(0);
    expect(asked.counts.total).toBe(3);
  });

  it('keeps a visible project whose parent is hidden from staff: no foundation, in All foundations, out of a foundation filter, debug log only', async () => {
    asMemberOf('lf-staff');
    // The parent is a Draft project staff cannot read: query-service returns no document for it.
    const projects = [project({ uid: 'child', name: 'Child One', stage: 'Formation - Engaged', parent_uid: 'hidden-parent' })];
    mockUpstream({ projects });
    vi.mocked(logger.debug).mockClear();
    vi.mocked(logger.warning).mockClear();

    const all = await service.getPipeline(req, allStages);

    expect(all.rows.map((row) => row.uid)).toEqual(['child']);
    expect(all.rows[0].parent).toBeNull();
    expect(all.counts.total).toBe(1);
    expect(JSON.stringify(all)).not.toContain('hidden-parent');
    expect(logger.warning).not.toHaveBeenCalledWith(req, 'get_formation_pipeline', expect.any(String), expect.anything());
    expect(logger.debug).toHaveBeenCalledWith(req, 'get_formation_pipeline', expect.any(String), expect.objectContaining({ count: 1 }));
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('hidden-parent');

    const scoped = await service.getPipeline(req, { ...allStages, foundationUid: 'some-foundation' });
    expect(scoped.rows).toEqual([]);
    expect(logger.warning).not.toHaveBeenCalledWith(req, 'get_formation_pipeline', expect.any(String), expect.anything());
  });

  it.each([
    ['a contractor (a different team)', ['lf-contractor']],
    ['a caller on no team', []],
  ])('rejects %s with FORMATION_TEAM_REQUIRED and reads nothing upstream', async (_label, teams) => {
    asMemberOf(...teams);

    await expect(service.getPipeline(req, allStages)).rejects.toMatchObject({ statusCode: 403, code: 'FORMATION_TEAM_REQUIRED' });

    expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'team', id: 'formation', access: 'member' });
    expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'team', id: 'lf-staff', access: 'member' });
    expect(proxyRequest).not.toHaveBeenCalled();
    expect(natsRequest).not.toHaveBeenCalled();
  });

  it('fails closed: an access-check outage reads as no membership', async () => {
    checkSingleAccess.mockResolvedValue(false);

    await expect(service.getPipeline(req, allStages)).rejects.toMatchObject({ statusCode: 403 });
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});
