// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The `@lfx-one/shared/*` alias isn't wired into vitest without Angular, so collaborators
// that touch shared utilities are mocked. computeIsFoundation is a pure function imported
// by the service — stub it here so the spec stays Angular-free.
const { getPersonas, getProjectsByIds, loggerWarning, loggerDebug } = vi.hoisted(() => ({
  getPersonas: vi.fn(),
  getProjectsByIds: vi.fn(),
  loggerWarning: vi.fn(),
  loggerDebug: vi.fn(),
}));

vi.mock('./persona-detection.service', () => ({
  PersonaDetectionService: class {
    public getPersonas = getPersonas;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectsByIds = getProjectsByIds;
  },
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: loggerWarning,
    debug: loggerDebug,
    info: vi.fn(),
  },
}));
vi.mock('@lfx-one/shared/utils', () => ({
  computeIsFoundation: vi.fn((p) => p.is_foundation === true),
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));

import type { Request } from 'express';

import { PersonaDetectionService } from './persona-detection.service';
import { PersonaEnrichmentService } from './persona-enrichment.service';

const req = {} as unknown as Request;

const makePersonaProject = (overrides: Partial<Record<string, unknown>> = {}) => ({
  projectUid: 'uid-a',
  projectSlug: 'slug-a',
  projectName: null,
  parentProjectUid: null,
  isFoundation: false,
  logoUrl: null,
  description: null,
  detections: [],
  personas: ['contributor'],
  ...overrides,
});

describe('PersonaEnrichmentService.getEnrichedPersonas', () => {
  let service: PersonaEnrichmentService;

  beforeEach(() => {
    getPersonas.mockReset();
    getProjectsByIds.mockReset();
    loggerWarning.mockReset();
    loggerDebug.mockReset();
    service = new PersonaEnrichmentService(new PersonaDetectionService());
  });

  it('returns base response unchanged when projects list is empty', async () => {
    const base = { projects: [], personaProjects: {}, error: null };
    getPersonas.mockResolvedValueOnce(base);

    const result = await service.getEnrichedPersonas(req);

    expect(result).toBe(base);
    expect(getProjectsByIds).not.toHaveBeenCalled();
  });

  it('returns base response unchanged when upstream signals an error', async () => {
    const base = { projects: [makePersonaProject()], personaProjects: {}, error: 'upstream_error' };
    getPersonas.mockResolvedValueOnce(base);

    const result = await service.getEnrichedPersonas(req);

    expect(result).toBe(base);
    expect(getProjectsByIds).not.toHaveBeenCalled();
  });

  it('merges project metadata when the batch returns a matching uid', async () => {
    const project = makePersonaProject({ projectUid: 'uid-a', projectSlug: 'slug-a' });
    getPersonas.mockResolvedValueOnce({ projects: [project], personaProjects: {}, error: null });
    const backendProject = { uid: 'uid-a', name: 'Project A', logo_url: 'https://logo', parent_uid: 'uid-parent', description: 'Desc', is_foundation: false };
    getProjectsByIds.mockResolvedValueOnce(new Map([['uid-a', backendProject]]));

    const result = await service.getEnrichedPersonas(req);

    expect(result.projects[0]).toMatchObject({
      projectName: 'Project A',
      logoUrl: 'https://logo',
      parentProjectUid: 'uid-parent',
      description: 'Desc',
    });
    expect(loggerWarning).not.toHaveBeenCalled();
  });

  it('logs at warning when the batch omits a requested uid and keeps the un-enriched entry', async () => {
    const project = makePersonaProject({ projectUid: 'uid-missing', projectSlug: 'slug-missing', isFoundation: false });
    getPersonas.mockResolvedValueOnce({ projects: [project], personaProjects: {}, error: null });
    // Batch returns empty — uid-missing is omitted
    getProjectsByIds.mockResolvedValueOnce(new Map());

    const result = await service.getEnrichedPersonas(req);

    // The miss path must be visible at WARNING, not silently swallowed at DEBUG
    expect(loggerWarning).toHaveBeenCalledOnce();
    expect(loggerWarning).toHaveBeenCalledWith(
      req,
      'get_enriched_personas',
      expect.stringContaining('un-enriched'),
      expect.objectContaining({ project_uid: 'uid-missing', project_slug: 'slug-missing' })
    );

    // Un-enriched entry returned as-is
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toBe(project);
  });

  it('warns once per omitted uid when multiple uids are missing', async () => {
    const p1 = makePersonaProject({ projectUid: 'uid-1', projectSlug: 'slug-1' });
    const p2 = makePersonaProject({ projectUid: 'uid-2', projectSlug: 'slug-2' });
    const p3 = makePersonaProject({ projectUid: 'uid-3', projectSlug: 'slug-3' });
    getPersonas.mockResolvedValueOnce({ projects: [p1, p2, p3], personaProjects: {}, error: null });
    // Only uid-2 is returned
    const backendProject = { uid: 'uid-2', name: 'Project B', logo_url: null, parent_uid: null, description: null, is_foundation: false };
    getProjectsByIds.mockResolvedValueOnce(new Map([['uid-2', backendProject]]));

    await service.getEnrichedPersonas(req);

    expect(loggerWarning).toHaveBeenCalledTimes(2);
  });

  it('isFoundation stays false for a missed foundation project (known misclassification risk)', async () => {
    // Documents the current degradation: persona detection hardcodes isFoundation: false, and
    // computeIsFoundation never runs on a batch miss, so foundation projects are returned with
    // isFoundation: false — silently misrouting them to /project/ instead of /foundation/.
    const foundationProject = makePersonaProject({ projectUid: 'uid-foundation', projectSlug: 'uepf', isFoundation: false });
    getPersonas.mockResolvedValueOnce({ projects: [foundationProject], personaProjects: {}, error: null });
    getProjectsByIds.mockResolvedValueOnce(new Map()); // batch omits uid-foundation

    const result = await service.getEnrichedPersonas(req);

    expect(result.projects[0].isFoundation).toBe(false); // degraded, not correct
  });
});
