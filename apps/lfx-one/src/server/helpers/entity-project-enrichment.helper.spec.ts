// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Project } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { computeIsFoundation, warning } = vi.hoisted(() => ({
  computeIsFoundation: vi.fn<(project: unknown) => boolean>(),
  warning: vi.fn(),
}));

// This app's vitest config resolves plain Node modules only — the `@lfx-one/shared/*` tsconfig
// path alias isn't wired here, so runtime shared subpaths must be mocked (mirrors
// meeting.helper.spec.ts). computeIsFoundation's real behavior is covered in the shared
// package; here a stub is enough to assert the mapping passes it through.
vi.mock('@lfx-one/shared/utils', () => ({ computeIsFoundation }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning, debug: vi.fn(), info: vi.fn() },
}));

import { fetchEntityProject, toEntityProjectFields } from './entity-project-enrichment.helper';

const req = {} as unknown as Request;
const LOG_CONTEXT = { operation: 'get_meeting_by_id', meeting_id: 'meeting-1' };

const projectServiceWith = (projects: Map<string, Project>) => ({ getProjectsByIds: vi.fn().mockResolvedValue(projects) });

describe('fetchEntityProject', () => {
  beforeEach(() => {
    warning.mockClear();
  });

  it('returns null without calling the project service when the entity carries no project_uid', async () => {
    const projectService = projectServiceWith(new Map());

    const result = await fetchEntityProject(req, projectService as never, undefined, LOG_CONTEXT);

    expect(result).toBeNull();
    expect(projectService.getProjectsByIds).not.toHaveBeenCalled();
  });

  it('returns the project resolved by the ungated query-service lookup', async () => {
    const project = { uid: 'p-1', slug: 'proj-one', name: 'Project One' } as Project;
    const projectService = projectServiceWith(new Map([['p-1', project]]));

    const result = await fetchEntityProject(req, projectService as never, 'p-1', LOG_CONTEXT);

    expect(result).toBe(project);
    expect(projectService.getProjectsByIds).toHaveBeenCalledWith(req, ['p-1']);
  });

  it('warns and continues with null when the lookup throws', async () => {
    const error = new Error('query-service unavailable');
    const projectService = { getProjectsByIds: vi.fn().mockRejectedValue(error) };

    const result = await fetchEntityProject(req, projectService as never, 'p-1', LOG_CONTEXT);

    expect(result).toBeNull();
    expect(warning).toHaveBeenCalledWith(req, 'get_meeting_by_id', expect.stringContaining('continuing without project fields'), {
      meeting_id: 'meeting-1',
      project_uid: 'p-1',
      err: error,
    });
  });
});

describe('toEntityProjectFields', () => {
  it('maps slug, name, and the computed foundation flag', () => {
    computeIsFoundation.mockReturnValue(true);
    const project = { uid: 'p-1', slug: 'proj-one', name: 'Project One', parent_uid: 'parent-1' } as unknown as Project;

    const fields = toEntityProjectFields(project);

    expect(computeIsFoundation).toHaveBeenCalledWith(project);
    expect(fields).toEqual({ project_slug: 'proj-one', project_name: 'Project One', is_foundation: true });
  });

  it('never exposes parent_project_uid, even when the project carries one', () => {
    computeIsFoundation.mockReturnValue(false);
    const project = { uid: 'p-1', slug: 'proj-one', name: 'Project One', parent_uid: 'parent-1' } as unknown as Project;

    const fields = toEntityProjectFields(project);

    expect(fields).not.toHaveProperty('parent_project_uid');
  });
});
