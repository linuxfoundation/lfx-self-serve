// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({ project: vi.fn(), read: vi.fn(), write: vi.fn(), roles: vi.fn() }));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = mocks.project;
  },
}));
vi.mock('../services/mktg-sign-off-settings.service', () => ({
  MktgSignOffSettingsService: class {
    public readSnapshot = mocks.read;
    public write = mocks.write;
  },
}));
vi.mock('../services/mktg-project-roles.service', () => ({
  MktgProjectRolesService: class {
    public rolesOf = mocks.roles;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(() => 0), success: vi.fn() } }));
import { MicroserviceError, PreconditionFailedError } from '../errors';
import { MktgSignOffSettingsController } from './mktg-sign-off-settings.controller';

const roles = { ed: { name: 'Executive director', subject: 'auth0|ed' }, tocChair: { name: 'TOC chair', subject: 'auth0|chair' } };
const record = { schema: 'mktg-project-sign-off/v1', mode: 'two-role', changedAt: '2026-10-23T12:00:00Z', changedBy: 'auth0|writer' };
const snapshot = { record, etag: 'private-etag' };
function request(body?: unknown, query: Record<string, unknown> = { project: 'input-project' }): Request {
  return { path: '/api/mktg-agents/sign-off/settings', body, query } as unknown as Request;
}
function response(): Response {
  return { json: vi.fn(), setHeader: vi.fn() } as unknown as Response;
}

describe('MktgSignOffSettingsController', () => {
  const controller = new MktgSignOffSettingsController();
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.project.mockResolvedValue({ uid: 'canonical-project', writer: true });
    mocks.read.mockResolvedValue({ record: null });
    mocks.roles.mockResolvedValue(roles);
    mocks.write.mockResolvedValue({ ...record, mode: 'single-writer' });
  });

  it('reads only the writer-authorized canonical project with name-only DTOs', async () => {
    const req = request();
    const res = response();
    const next = vi.fn();
    await controller.getSettings(req, res, next);
    expect(mocks.project).toHaveBeenCalledWith(req, 'input-project', true);
    expect(mocks.read).toHaveBeenCalledWith(req, 'canonical-project');
    expect(mocks.roles).toHaveBeenCalledWith(req, 'canonical-project');
    expect(res.json).toHaveBeenCalledWith({
      mode: 'single-writer',
      roles: { ed: { name: 'Executive director' }, tocChair: { name: 'TOC chair' } },
      canEnable: false,
      reason: 'Approver access policy is awaiting confirmation.',
    });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('leaves persisted two-role mode readable while enable policy remains unresolved', async () => {
    mocks.read.mockResolvedValue(snapshot);
    const res = response();
    await controller.getSettings(request(), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mode: 'two-role', canEnable: false }));
    const body = vi.mocked(res.json).mock.calls[0]?.[0];
    expect(JSON.stringify(body)).not.toContain('auth0|');
    expect(JSON.stringify(body)).not.toContain('private-etag');
  });

  it.each([
    { source: { ed: null, tocChair: roles.tocChair }, label: 'executive director' },
    { source: { ed: roles.ed, tocChair: { name: 'TOC chair', subject: null } }, label: 'TOC chair' },
  ])('reports unresolved role $label without an address or identity', async ({ source, label }) => {
    mocks.roles.mockResolvedValue(source);
    const res = response();
    await controller.getSettings(request(), res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ canEnable: false, reason: expect.stringContaining(label) }));
  });

  it.each([roles, { ed: null, tocChair: null }])('never enables two-role mode before the open B6 policy is ruled', async (source) => {
    mocks.roles.mockResolvedValue(source);
    const next = vi.fn();
    const res = response();
    await controller.updateSettings(request({ project: 'input-project', mode: 'two-role' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, code: 'MKTG_SIGN_OFF_CANNOT_ENABLE' }));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('allows an authorized writer to switch off even with missing roles, using the observed snapshot', async () => {
    mocks.read.mockResolvedValue(snapshot);
    mocks.roles.mockResolvedValue({ ed: null, tocChair: null });
    const req = request({ project: 'input-project', mode: 'single-writer' });
    const res = response();
    const next = vi.fn();
    await controller.updateSettings(req, res, next);
    expect(mocks.write).toHaveBeenCalledWith(req, 'canonical-project', 'single-writer', snapshot);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mode: 'single-writer' }));
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['getSettings', 'updateSettings'] as const)('requires the same writer grant for %s, before any policy/roster read', async (method) => {
    mocks.project.mockResolvedValue({ uid: 'canonical-project', writer: false });
    const next = vi.fn();
    await controller[method](request({ project: 'input-project', mode: 'single-writer' }), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.roles).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('blocks an impersonating write before project or storage lookup', async () => {
    const req = { ...request({ project: 'input-project', mode: 'single-writer' }), impersonationActive: true } as Request;
    const next = vi.fn();
    await controller.updateSettings(req, response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    { body: null },
    { body: [] },
    { body: { project: 'input-project', mode: 'unknown' } },
    { body: { project: '../unsafe', mode: 'single-writer' } },
    { body: { project: 'input-project', mode: 'single-writer', roles } },
  ])('rejects malformed or extra body fields before lookup %j', async ({ body }) => {
    const next = vi.fn();
    await controller.updateSettings(request(body), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([new MicroserviceError('Policy unreadable', 502, 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE'), new PreconditionFailedError()])(
    'forwards policy/storage failures rather than falsely reporting a successful change',
    async (error) => {
      if (error instanceof PreconditionFailedError) mocks.write.mockRejectedValue(error);
      else mocks.read.mockRejectedValue(error);
      const next = vi.fn();
      const res = response();
      await controller.updateSettings(request({ project: 'input-project', mode: 'single-writer' }), res, next);
      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    }
  );
});
