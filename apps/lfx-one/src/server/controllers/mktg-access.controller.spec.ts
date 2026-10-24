// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const fake = vi.hoisted(() => ({ project: vi.fn(), access: vi.fn(), start: vi.fn(() => 0), success: vi.fn() }));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = fake.project;
  },
}));
vi.mock('../services/mktg-access.service', () => ({
  MktgAccessService: class {
    public read = fake.access;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: fake.start, success: fake.success } }));
import { MktgAccessController } from './mktg-access.controller';
import { MicroserviceError } from '../errors';

describe('MktgAccessController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fake.project.mockResolvedValue({ uid: 'server-project', writer: true });
    fake.access.mockResolvedValue({ writers: [], executiveDirector: null, warnings: [] });
  });
  const req = (project: unknown): Request => ({ query: { project }, path: '/access' }) as unknown as Request;
  const res = (): Response => ({ json: vi.fn() }) as unknown as Response;

  it('gates with access annotation and reads the SERVER-resolved project only', async () => {
    const request = req('client-project');
    const response = res();
    const next = vi.fn();
    await new MktgAccessController().read(request, response, next);
    expect(fake.project).toHaveBeenCalledWith(request, 'client-project', true);
    expect(fake.access).toHaveBeenCalledWith(request, 'server-project');
    expect(response.json).toHaveBeenCalledWith({ writers: [], executiveDirector: null, warnings: [] });
    expect(next).not.toHaveBeenCalled();
    expect(fake.success).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, '', '../unsafe', ['project'], {}])('refuses invalid project %# before lookup', async (project) => {
    const next = vi.fn();
    await new MktgAccessController().read(req(project), res(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(fake.project).not.toHaveBeenCalled();
  });
  it.each([
    { uid: 'server-project', writer: false },
    { uid: '../unsafe', writer: true },
  ])('refuses unsafe or unauthorized server projects %#', async (project) => {
    fake.project.mockResolvedValue(project);
    const next = vi.fn();
    const response = res();
    await new MktgAccessController().read(req('client-project'), response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(fake.access).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });
  it.each(['lookup', 'settings'])('passes %s failures to middleware without reporting empty settings', async (where) => {
    const failure = new MicroserviceError('Synthetic outage', 503, 'SYNTHETIC_OUTAGE');
    if (where === 'lookup') fake.project.mockRejectedValue(failure);
    else fake.access.mockRejectedValue(failure);
    const next = vi.fn();
    const response = res();
    await new MktgAccessController().read(req('client-project'), response, next);
    expect(next).toHaveBeenCalledWith(failure);
    expect(response.json).not.toHaveBeenCalled();
    expect(fake.success).not.toHaveBeenCalled();
  });
});
