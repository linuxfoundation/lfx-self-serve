// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startGeneration: vi.fn(),
  getResult: vi.fn(),
  sendAnswers: vi.fn(),
  getProjectById: vi.fn(),
  getEffectiveUsername: vi.fn(),
  createSessionOwnerToken: vi.fn(),
  verifySessionOwnerToken: vi.fn(),
}));
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('../../../../../packages/shared/src/utils/aeo-geo.utils'));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  AEO_GEO_INTAKE: { agentId: 'aeo-geo' },
  MKTG_AGENTS: [{ id: 'aeo-geo', status: 'active', guildAgentHandle: 'catalog-audit-handle' }],
}));
vi.mock('../services/aeo-geo.service', () => ({
  AeoGeoService: class {
    public startGeneration = mocks.startGeneration;
    public getResult = mocks.getResult;
    public sendAnswers = mocks.sendAnswers;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = mocks.getProjectById;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(() => 0), success: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: mocks.getEffectiveUsername }));
vi.mock('../utils/mktg-session-token.util', () => ({
  createSessionOwnerToken: mocks.createSessionOwnerToken,
  verifySessionOwnerToken: mocks.verifySessionOwnerToken,
}));
import { AeoGeoController } from './aeo-geo.controller';

const body = () => ({ answers: { domain: 'project.example' }, project: 'project-1' });
async function call(kind: 'generate' | 'result' | 'answers', payload: unknown) {
  const next = vi.fn();
  const json = vi.fn();
  await new AeoGeoController()[kind]({ body: payload } as Request, { json } as Partial<Response> as Response, next);
  return { next, json };
}

describe('AeoGeoController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveUsername.mockReturnValue('synthetic-lfid');
    mocks.createSessionOwnerToken.mockReturnValue('owner-proof');
    mocks.verifySessionOwnerToken.mockReturnValue(true);
    mocks.getProjectById.mockResolvedValue({ uid: 'resolved-project', name: 'Synthetic Canonical Project', writer: true });
    mocks.startGeneration.mockResolvedValue({ sessionId: 'session-a', documentId: 'run-012345678901234567890123' });
    mocks.getResult.mockResolvedValue({ status: 'pending' });
  });
  it('uses the catalog handle, never a submitted routing handle, and returns an owner-bound destination', async () => {
    const result = await call('generate', { ...body(), handle: 'untrusted' });
    expect(result.next).not.toHaveBeenCalled();
    expect(mocks.startGeneration).toHaveBeenCalledWith(
      expect.anything(),
      {
        ...body().answers,
        project_name: 'Synthetic Canonical Project',
        project_uid: 'resolved-project',
      },
      'catalog-audit-handle'
    );
    expect(mocks.createSessionOwnerToken).toHaveBeenCalledWith('synthetic-lfid', 'session-a');
    expect(result.json).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-a', ownerToken: 'owner-proof', documentId: expect.stringMatching(/^run-/) })
    );
  });
  it('takes project scope from the writer-entitled LFX lookup, not submitted names or ids', async () => {
    const result = await call('generate', { ...body(), answers: { ...body().answers, project_name: 'Untrusted Project', project_uid: 'another-project' } });
    expect(result.next).not.toHaveBeenCalled();
    expect(mocks.startGeneration).toHaveBeenCalledWith(
      expect.anything(),
      {
        domain: 'project.example',
        project_name: 'Synthetic Canonical Project',
        project_uid: 'resolved-project',
      },
      'catalog-audit-handle'
    );
  });
  it('rejects malformed answers and revision attempts before calling Guild', async () => {
    for (const payload of [null, { ...body(), answers: { domain: 'invalid' } }, { ...body(), feedback: 'revise' }, { ...body(), priorVersion: 1 }]) {
      expect((await call('generate', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    }
    expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('reports intake errors without misleading revision instructions', async () => {
    const invalid = await call('generate', { ...body(), answers: { domain: 'invalid' } });
    const error = invalid.next.mock.calls[0][0];
    expect(error.validationErrors[0].field).toBe('answers');
    expect(error.validationErrors[0].message).toContain('valid domain');
    expect(error.validationErrors[0].message).not.toContain('revised');
    const revision = await call('generate', { ...body(), feedback: 'change it' });
    expect(revision.next.mock.calls[0][0].validationErrors[0]).toMatchObject({ field: 'feedback', message: expect.stringContaining('cannot be revised') });
  });
  it('requires an authenticated effective user and project write access', async () => {
    mocks.getEffectiveUsername.mockReturnValueOnce(null);
    expect((await call('generate', body())).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    mocks.getProjectById.mockResolvedValue({ uid: 'project-1', writer: false });
    expect((await call('generate', body())).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('shape-gates project before an authenticated upstream lookup', async () => {
    expect((await call('generate', { ...body(), project: '../escape' })).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.getProjectById).not.toHaveBeenCalled();
  });
  it('validates answer ownership and project rights before continuing the same session', async () => {
    const answers = [{ id: 'audience', text: 'Platform engineers.', origin: 'requester' }];
    const payload = { project: 'project-1', sessionId: 'session-a', ownerToken: 'owner-proof', documentId: 'run-012345678901234567890123', answers };
    mocks.verifySessionOwnerToken.mockReturnValueOnce(false);
    expect((await call('answers', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.getProjectById).not.toHaveBeenCalled();
    expect((await call('answers', { ...payload, answers: [answers[0], answers[0]] })).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.sendAnswers).not.toHaveBeenCalled();
    expect((await call('answers', payload)).json).toHaveBeenCalledWith({ success: true });
    expect(mocks.sendAnswers).toHaveBeenCalledWith(expect.anything(), 'session-a', payload.documentId, 'resolved-project', answers, 'catalog-audit-handle');
    expect(mocks.startGeneration).not.toHaveBeenCalled();
    mocks.getProjectById.mockResolvedValue({ uid: 'project-1', writer: false });
    expect((await call('answers', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
  it('checks creator proof before any result read and scopes persistence to the resolved project', async () => {
    const payload = { sessionId: 'session-a', ownerToken: 'owner-proof', project: 'project-1' };
    mocks.verifySessionOwnerToken.mockReturnValueOnce(false);
    expect((await call('result', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.getResult).not.toHaveBeenCalled();
    expect((await call('result', payload)).json).toHaveBeenCalledWith({ status: 'pending' });
    expect(mocks.getResult).toHaveBeenCalledWith(expect.anything(), 'session-a', 'resolved-project');
    expect(mocks.verifySessionOwnerToken).toHaveBeenCalledWith('owner-proof', 'synthetic-lfid', 'session-a');
  });
});
