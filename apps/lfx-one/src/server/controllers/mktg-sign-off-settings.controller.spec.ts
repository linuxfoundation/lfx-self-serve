// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({ project: vi.fn(), readSettings: vi.fn(), updateMode: vi.fn() }));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = mocks.project;
  },
}));
vi.mock('../services/mktg-sign-off-settings.service', () => ({
  MktgSignOffSettingsService: class {
    public readSettings = mocks.readSettings;
    public updateMode = mocks.updateMode;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(() => 0), success: vi.fn() } }));
import { ConflictError, MicroserviceError, PreconditionFailedError } from '../errors';
import { MktgSignOffSettingsController } from './mktg-sign-off-settings.controller';

const projection = {
  mode: 'single-writer',
  roles: { ed: { name: 'Executive director' }, tocChair: { name: 'TOC chair' } },
  canEnable: false,
  reason: 'Approver access policy is awaiting confirmation.',
};
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
    mocks.readSettings.mockResolvedValue(projection);
    mocks.updateMode.mockResolvedValue(projection);
  });

  it('delegates the canonical writer-authorized read and returns the service projection unchanged', async () => {
    const req = request();
    const res = response();
    const next = vi.fn();
    await controller.getSettings(req, res, next);
    expect(mocks.project).toHaveBeenCalledWith(req, 'input-project', true);
    expect(mocks.readSettings).toHaveBeenCalledExactlyOnceWith(req, 'canonical-project');
    expect(res.json).toHaveBeenCalledWith(projection);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(mocks.updateMode).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('delegates the mode change without reading storage, resolving roles or making enable-policy decisions', async () => {
    const req = request({ project: 'input-project', mode: 'single-writer' });
    const res = response();
    const next = vi.fn();
    await controller.updateSettings(req, res, next);
    expect(mocks.project).toHaveBeenCalledWith(req, 'input-project', true);
    expect(mocks.updateMode).toHaveBeenCalledExactlyOnceWith(req, 'canonical-project', 'single-writer');
    expect(mocks.readSettings).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(projection);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['getSettings', 'updateSettings'] as const)('requires the same writer grant for %s before invoking policy', async (method) => {
    mocks.project.mockResolvedValue({ uid: 'canonical-project', writer: false });
    const next = vi.fn();
    await controller[method](request({ project: 'input-project', mode: 'single-writer' }), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.readSettings).not.toHaveBeenCalled();
    expect(mocks.updateMode).not.toHaveBeenCalled();
  });

  it('blocks an impersonating write before project or policy lookup', async () => {
    const req = { ...request({ project: 'input-project', mode: 'single-writer' }), impersonationActive: true } as Request;
    const next = vi.fn();
    await controller.updateSettings(req, response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.updateMode).not.toHaveBeenCalled();
  });

  it.each([
    { body: null },
    { body: [] },
    { body: { project: 'input-project', mode: 'unknown' } },
    { body: { project: '../unsafe', mode: 'single-writer' } },
    { body: { project: 'input-project', mode: 'single-writer', roles: projection.roles } },
  ])('rejects malformed or extra body fields before lookup %j', async ({ body }) => {
    const next = vi.fn();
    await controller.updateSettings(request(body), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.readSettings).not.toHaveBeenCalled();
    expect(mocks.updateMode).not.toHaveBeenCalled();
  });

  it.each([
    new MicroserviceError('Policy unreadable', 502, 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE'),
    new PreconditionFailedError(),
    new ConflictError('Awaiting policy', 'MKTG_SIGN_OFF_CANNOT_ENABLE'),
  ])('forwards service policy/storage failures without a successful response', async (error) => {
    mocks.updateMode.mockRejectedValue(error);
    const next = vi.fn();
    const res = response();
    await controller.updateSettings(request({ project: 'input-project', mode: 'two-role' }), res, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
