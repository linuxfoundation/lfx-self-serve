// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { MKTG_REBUILD_DOWNSTREAM_KEYS } from '@lfx-one/shared/constants';

const deps = vi.hoisted(() => ({ project: vi.fn(), start: vi.fn(), advance: vi.fn(), result: vi.fn() }));
vi.mock('../services/mktg-rebuild.service', () => ({
  MktgRebuildService: class {
    public start = deps.start;
    public advance = deps.advance;
    public result = deps.result;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = deps.project;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(), success: vi.fn(), debug: vi.fn() } }));
import { logger } from '../services/logger.service';
import { AuthorizationError, ServiceValidationError } from '../errors';
import { MktgRebuildController } from './mktg-rebuild.controller';

const body = {
  project: 'project-1',
  frameworkRevisionId: `000002-${'a'.repeat(64)}`,
  chainId: '12345678-1234-4123-8123-123456789abc',
  ownerToken: 'c'.repeat(64),
  stepIndex: 0,
};
const request = (value: unknown, impersonationActive = false) => ({ body: value, impersonationActive }) as unknown as Request;
const response = () => ({ json: vi.fn() }) as unknown as Response;

describe('MktgRebuildController', () => {
  let controller: MktgRebuildController;
  let next: NextFunction & Mock;
  beforeEach(() => {
    vi.resetAllMocks();
    controller = new MktgRebuildController();
    next = vi.fn();
    deps.project.mockResolvedValue({ uid: 'resolved-project', writer: true });
    for (const method of [deps.start, deps.advance, deps.result]) method.mockResolvedValue({ status: 'running', steps: [] });
  });
  it.each(['start', 'advance', 'result'] as const)('gates %s by server-resolved writer grant', async (method) => {
    const req = request(body);
    await controller[method](req, response(), next);
    expect(deps.project).toHaveBeenCalledWith(req, body.project, true);
    expect(deps[method]).toHaveBeenCalledWith(req, { uid: 'resolved-project', writer: true }, method === 'start' ? body.frameworkRevisionId : body);
    expect(next).not.toHaveBeenCalled();
    if (method === 'result') {
      expect(logger.success).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledOnce();
    } else expect(logger.success).toHaveBeenCalledOnce();
    deps.project.mockResolvedValueOnce({ uid: 'resolved-project', writer: false });
    await controller[method](req, response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(deps[method]).toHaveBeenCalledTimes(1);
  });
  it('returns the attached chain and caller capability unchanged', async () => {
    const attached = { chainId: body.chainId, ownerToken: body.ownerToken, attached: true, status: 'running', steps: [] };
    deps.start.mockResolvedValueOnce(attached);
    const res = response();
    await controller.start(request(body), res, next);
    expect(res.json).toHaveBeenCalledWith(attached);
    expect(next).not.toHaveBeenCalled();
  });
  it.each(['start', 'advance', 'result'] as const)('blocks %s during impersonation before any lookup', async (method) => {
    await controller[method](request(body, true), response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(deps.project).not.toHaveBeenCalled();
    expect(deps[method]).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...body, project: '../other' }, { ...body, project: ['project'] }])('rejects malformed project input', async (value) => {
    await controller.start(request(value), response(), next);
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(deps.project).not.toHaveBeenCalled();
  });
  it('rejects malformed chain tokens and steps before storage', async () => {
    for (const value of [
      { ...body, chainId: '../x' },
      { ...body, ownerToken: 123 },
      { ...body, stepIndex: -1 },
      { ...body, stepIndex: MKTG_REBUILD_DOWNSTREAM_KEYS.length },
    ]) {
      await controller.advance(request(value), response(), next);
      expect(next).toHaveBeenLastCalledWith(expect.any(ServiceValidationError));
    }
    expect(deps.project).not.toHaveBeenCalled();
  });
});
