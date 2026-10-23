// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProjectIdBySlug, checkSingleAccessStrict } = vi.hoisted(() => ({
  getProjectIdBySlug: vi.fn(),
  checkSingleAccessStrict: vi.fn(),
}));

vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = getProjectIdBySlug;
  },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE } from '@lfx-one/shared/constants';

import { requireProjectParticipatingOrgsAccess } from './require-project-participating-orgs-access.middleware';

const UID = '00000000-0000-4000-8000-000000000001';

async function run(slug: string): Promise<{ next: Mock }> {
  const next = vi.fn();
  await requireProjectParticipatingOrgsAccess({ params: { slug } } as unknown as Request, {} as Response, next as unknown as NextFunction);
  return { next };
}

function errorOf(next: Mock): { statusCode?: number; message?: string; clientMessage?: string } | undefined {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0];
}

describe('requireProjectParticipatingOrgsAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectIdBySlug.mockResolvedValue({ uid: UID, slug: 'synthetic-project', exists: true });
    checkSingleAccessStrict.mockResolvedValue(true);
  });

  it('400s on a malformed slug', async () => {
    const { next } = await run('Bad Slug!');
    expect(errorOf(next)?.statusCode).toBe(400);
    expect(getProjectIdBySlug).not.toHaveBeenCalled();
  });

  it('404s on an unknown project', async () => {
    getProjectIdBySlug.mockResolvedValue({ uid: '', slug: 'synthetic-project', exists: false });
    const { next } = await run('synthetic-project');
    expect(errorOf(next)?.statusCode).toBe(404);
    expect(checkSingleAccessStrict).not.toHaveBeenCalled();
  });

  it('503s when the slug resolver throws', async () => {
    getProjectIdBySlug.mockRejectedValue(new Error('nats down'));
    const { next } = await run('synthetic-project');
    const error = errorOf(next);
    expect(error?.statusCode).toBe(503);
    expect(error?.message).toBe(PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE);
  });

  it('403s when the caller is not a project viewer', async () => {
    checkSingleAccessStrict.mockResolvedValue(false);
    const { next } = await run('synthetic-project');
    expect(errorOf(next)?.statusCode).toBe(403);
    expect(checkSingleAccessStrict).toHaveBeenCalledWith(expect.anything(), { resource: 'project', id: UID, access: 'viewer' });
  });

  it('503s when the access check throws', async () => {
    checkSingleAccessStrict.mockRejectedValue(new Error('authorizer down'));
    const { next } = await run('synthetic-project');
    expect(errorOf(next)?.statusCode).toBe(503);
  });

  it('lets a project viewer through', async () => {
    const { next } = await run('synthetic-project');
    expect(errorOf(next)).toBeUndefined();
  });
});
