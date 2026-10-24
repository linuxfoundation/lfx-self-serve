// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({ project: vi.fn(), checks: vi.fn(), start: vi.fn(() => 0), success: vi.fn() }));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = mocks.project;
  },
}));
vi.mock('../services/mktg-sign-off-checks.service', () => ({
  MktgSignOffChecksService: class {
    public checksFor = mocks.checks;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: mocks.start, success: mocks.success } }));
import { MicroserviceError } from '../errors';
import { MktgSignOffChecksController } from './mktg-sign-off-checks.controller';

const revisionId = `000001-${'a'.repeat(64)}`;
function request(
  query: Record<string, unknown> = { project: 'input-project' },
  params: Partial<Record<'agentKey' | 'documentId' | 'revisionId', string>> = {}
): Request {
  return {
    path: '/api/mktg-agents/documents',
    query,
    params: { agentKey: 'foundation-message', documentId: 'living', revisionId, ...params },
  } as unknown as Request;
}
function response() {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

describe('MktgSignOffChecksController', () => {
  const controller = new MktgSignOffChecksController();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockResolvedValue({ uid: 'canonical-project', writer: true });
    mocks.checks.mockResolvedValue({ checks: [] });
  });

  it('checks writer access and uses only the server-resolved project and selected revision', async () => {
    const req = request();
    const res = response();
    const next = vi.fn();
    await controller.getChecks(req, res, next);
    expect(mocks.project).toHaveBeenCalledWith(req, 'input-project', true);
    expect(mocks.checks).toHaveBeenCalledWith(req, 'canonical-project', expect.objectContaining({ agentKey: 'foundation-message' }), 'living', revisionId);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.json).toHaveBeenCalledWith({ checks: [] });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([{ project: undefined }, { project: ['input-project'] }, { project: '../escape' }])(
    'validates unsafe project input before lookup %j',
    async (query) => {
      const next = vi.fn();
      await controller.getChecks(request(query), response(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(mocks.project).not.toHaveBeenCalled();
      expect(mocks.checks).not.toHaveBeenCalled();
    }
  );

  it.each([{ agentKey: 'unknown' }, { documentId: '../escape' }, { revisionId: 'not-a-revision' }])(
    'validates document selectors before lookup %j',
    async (params) => {
      const next = vi.fn();
      await controller.getChecks(request(undefined, params), response(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(mocks.project).not.toHaveBeenCalled();
    }
  );

  it.each([
    { uid: 'canonical-project', writer: false },
    { uid: '../unsafe', writer: true },
  ])('fails closed without the canonical project writer boundary', async (project) => {
    mocks.project.mockResolvedValue(project);
    const next = vi.fn();
    await controller.getChecks(request(), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.checks).not.toHaveBeenCalled();
  });

  it('forwards lookup failures to the shared error handler, not a false empty success', async () => {
    const failure = new MicroserviceError('Store unavailable', 503, 'UNAVAILABLE');
    mocks.checks.mockRejectedValue(failure);
    const next = vi.fn();
    const res = response();
    await controller.getChecks(request(), res, next);
    expect(next).toHaveBeenCalledWith(failure);
    expect(res.json).not.toHaveBeenCalled();
  });
});
