// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startGeneration: vi.fn(),
  prepareAnswers: vi.fn(),
  deliverAnswers: vi.fn(),
  resolveProject: vi.fn(),
  assertSingleActiveOneOffRun: vi.fn(),
  startForOneOff: vi.fn(),
  ownedOneOffResult: vi.fn(),
  assertRunOpen: vi.fn(),
  claimSessionAnswers: vi.fn(),
  getProjectById: vi.fn(),
  getEffectiveUsername: vi.fn(),
  getEffectiveSub: vi.fn(),
  createSessionOwnerToken: vi.fn(),
  verifySessionOwnerToken: vi.fn(),
}));
vi.mock('@lfx-one/shared/utils', async () => await vi.importActual('../../../../../packages/shared/src/utils/aeo-geo.utils'));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/aeo-geo.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  AEO_GEO_INTAKE: { agentId: 'aeo-geo' },
  MKTG_AGENTS: [{ id: 'aeo-geo', status: 'active', guildAgentHandle: 'catalog-audit-handle' }],
}));
vi.mock('../services/aeo-geo.service', () => ({
  AeoGeoService: class {
    public startGeneration = mocks.startGeneration;
    public prepareAnswers = mocks.prepareAnswers;
    public deliverAnswers = mocks.deliverAnswers;
  },
}));
vi.mock('../services/mktg-document-run.service', () => ({
  MktgDocumentRunService: class {
    public resolveProject = mocks.resolveProject;
    public assertSingleActiveOneOffRun = mocks.assertSingleActiveOneOffRun;
    public startForOneOff = mocks.startForOneOff;
    public ownedOneOffResult = mocks.ownedOneOffResult;
    public assertRunOpen = mocks.assertRunOpen;
    public claimSessionAnswers = mocks.claimSessionAnswers;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = mocks.getProjectById;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(() => 0), success: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: mocks.getEffectiveUsername, getEffectiveSub: mocks.getEffectiveSub }));
vi.mock('../utils/mktg-session-token.util', () => ({
  createSessionOwnerToken: mocks.createSessionOwnerToken,
  verifySessionOwnerToken: mocks.verifySessionOwnerToken,
}));
import { AeoGeoController } from './aeo-geo.controller';
import { MKTG_ANSWERS_INCOMPLETE_MESSAGE } from '@lfx-one/shared/constants/mktg-run.constants';

const body = () => ({ answers: { domain: 'project.example' }, project: 'project-1' });
const questionsId = 'c'.repeat(64);
const runId = 'd'.repeat(64);
/** The tracker's 409s as the error handler receives them. */
const conflict = (code: string) => Object.assign(new Error(code), { statusCode: 409, code });
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
    mocks.getEffectiveSub.mockReturnValue('synthetic-subject');
    mocks.createSessionOwnerToken.mockReturnValue('owner-proof');
    mocks.verifySessionOwnerToken.mockReturnValue(true);
    mocks.getProjectById.mockResolvedValue({ uid: 'resolved-project', name: 'Synthetic Canonical Project', writer: true });
    mocks.startGeneration.mockResolvedValue({ sessionId: 'session-a', documentId: 'run-012345678901234567890123' });
    mocks.resolveProject.mockResolvedValue('resolved-project');
    mocks.assertSingleActiveOneOffRun.mockResolvedValue(undefined);
    mocks.startForOneOff.mockResolvedValue(runId);
    mocks.ownedOneOffResult.mockResolvedValue({ status: 'pending' });
    mocks.assertRunOpen.mockResolvedValue(undefined);
    mocks.prepareAnswers.mockResolvedValue('rendered answers turn');
    mocks.claimSessionAnswers.mockResolvedValue(undefined);
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
    expect(mocks.createSessionOwnerToken).toHaveBeenCalledWith('synthetic-lfid', 'aeo-geo:resolved-project:session-a');
    expect(result.json).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-a', runId, ownerToken: 'owner-proof', documentId: expect.stringMatching(/^run-/) })
    );
    expect(mocks.startForOneOff).toHaveBeenCalledWith(expect.anything(), 'aeo-geo', 'resolved-project', 'session-a');
  });
  it('checks tracking storage and the creator’s active audit before any Guild session, and records the accepted one', async () => {
    const order: string[] = [];
    mocks.resolveProject.mockImplementation(async () => (order.push('storage'), 'resolved-project'));
    mocks.assertSingleActiveOneOffRun.mockImplementation(async () => void order.push('slot'));
    mocks.startGeneration.mockImplementation(async () => (order.push('session'), { sessionId: 'session-a', documentId: 'run-012345678901234567890123' }));
    mocks.startForOneOff.mockImplementation(async () => (order.push('record'), runId));
    expect((await call('generate', { ...body(), discard: runId })).next).not.toHaveBeenCalled();
    expect(order).toEqual(['storage', 'slot', 'session', 'record']);
    expect(mocks.assertSingleActiveOneOffRun).toHaveBeenCalledWith(expect.anything(), 'resolved-project', 'aeo-geo', runId);
    // A second start is the tracker's 409 MKTG_RUN_ACTIVE: no session, no record, no owner token.
    mocks.startGeneration.mockClear();
    mocks.startForOneOff.mockClear();
    const active = conflict('MKTG_RUN_ACTIVE');
    mocks.assertSingleActiveOneOffRun.mockRejectedValueOnce(active);
    const refused = await call('generate', body());
    expect(refused.next).toHaveBeenCalledWith(active);
    expect(mocks.assertSingleActiveOneOffRun).toHaveBeenLastCalledWith(expect.anything(), 'resolved-project', 'aeo-geo', undefined);
    expect(mocks.startGeneration).not.toHaveBeenCalled();
    expect(mocks.startForOneOff).not.toHaveBeenCalled();
    expect(refused.json).not.toHaveBeenCalled();
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
  it('passes request notes through to the run and refuses notes over the agent’s cap', async () => {
    const notes = 'Audience: maintainers.\nCompare against other.example.';
    const result = await call('generate', { ...body(), answers: { ...body().answers, notes } });
    expect(result.next).not.toHaveBeenCalled();
    expect(mocks.startGeneration).toHaveBeenCalledWith(
      expect.anything(),
      { domain: 'project.example', notes, project_name: 'Synthetic Canonical Project', project_uid: 'resolved-project' },
      'catalog-audit-handle'
    );
    mocks.startGeneration.mockClear();
    for (const invalid of ['x'.repeat(10_001), 7]) {
      const refused = await call('generate', { ...body(), answers: { ...body().answers, notes: invalid } });
      expect(refused.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    }
    expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('rejects malformed answers and revision attempts before calling Guild', async () => {
    for (const payload of [null, { ...body(), answers: { domain: 'invalid' } }, { ...body(), feedback: 'revise' }, { ...body(), priorVersion: 1 }]) {
      expect((await call('generate', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    }
    expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('refuses empty answers with the plain 400 before sending', async () => {
    for (const text of ['', '   ']) {
      const result = await call('answers', {
        project: 'project-1',
        sessionId: 'session-a',
        ownerToken: 'owner-proof',
        documentId: 'run-012345678901234567890123',
        questionsId,
        answers: [{ id: 'exclude', text, origin: 'requester' }],
      });
      expect(result.next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          validationErrors: [{ code: 'FIELD_VALIDATION_ERROR', field: 'answers', message: MKTG_ANSWERS_INCOMPLETE_MESSAGE }],
        })
      );
      expect(result.json).not.toHaveBeenCalled();
    }
    expect(mocks.prepareAnswers).not.toHaveBeenCalled();
    expect(mocks.claimSessionAnswers).not.toHaveBeenCalled();
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
    mocks.getEffectiveSub.mockReturnValueOnce(null);
    expect((await call('generate', body())).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    mocks.getProjectById.mockResolvedValue({ uid: 'project-1', writer: false });
    expect((await call('generate', body())).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('shape-gates project before an authenticated upstream lookup', async () => {
    expect((await call('generate', { ...body(), project: '../escape' })).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.getProjectById).not.toHaveBeenCalled();
  });
  it('validates answer ownership, the questions turn and project rights before continuing the same session', async () => {
    const answers = [{ id: 'audience', text: 'Platform engineers.', origin: 'requester' }];
    const payload = {
      project: 'project-1',
      sessionId: 'session-a',
      ownerToken: 'owner-proof',
      documentId: 'run-012345678901234567890123',
      questionsId,
      answers,
    };
    mocks.verifySessionOwnerToken.mockReturnValueOnce(false);
    expect((await call('answers', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    for (const invalid of [
      { ...payload, answers: [answers[0], answers[0]] },
      { ...payload, questionsId: undefined },
      { ...payload, questionsId: 'not-a-turn' },
    ]) {
      expect((await call('answers', invalid)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    }
    expect(mocks.assertRunOpen).not.toHaveBeenCalled();
    expect(mocks.prepareAnswers).not.toHaveBeenCalled();
    expect((await call('answers', payload)).json).toHaveBeenCalledWith({ success: true, status: 'pending' });
    expect(mocks.assertRunOpen).toHaveBeenCalledWith(expect.anything(), 'resolved-project', 'aeo-geo', 'session-a');
    expect(mocks.prepareAnswers).toHaveBeenCalledWith(expect.anything(), 'session-a', payload.documentId, 'resolved-project', questionsId, answers);
    expect(mocks.startGeneration).not.toHaveBeenCalled();
    mocks.getProjectById.mockResolvedValue({ uid: 'project-1', writer: false });
    expect((await call('answers', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
  it('lets only the first answer to a questions turn through: the claim precedes delivery and a lost claim sends nothing', async () => {
    const answers = [{ id: 'audience', text: 'Platform engineers.', origin: 'requester' }];
    const payload = {
      project: 'project-1',
      sessionId: 'session-a',
      ownerToken: 'owner-proof',
      documentId: 'run-012345678901234567890123',
      questionsId,
      answers,
    };
    const order: string[] = [];
    mocks.claimSessionAnswers.mockImplementation(async () => void order.push('claim'));
    mocks.deliverAnswers.mockImplementation(async () => void order.push('deliver'));
    expect((await call('answers', payload)).json).toHaveBeenCalledWith({ success: true, status: 'pending' });
    expect(order).toEqual(['claim', 'deliver']);
    expect(mocks.claimSessionAnswers).toHaveBeenCalledWith(expect.anything(), 'resolved-project', 'session-a', questionsId, 'aeo-geo', [
      { key: 'aeo-audience', text: 'Platform engineers.', origin: 'requester' },
    ]);
    expect(mocks.deliverAnswers).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'session-a', 'rendered answers turn', 1);
    // The second answer, from a stale tab or a retry: 409 MKTG_RUN_ANSWERED whether or not Guild still shows the turn.
    const answered = conflict('MKTG_RUN_ANSWERED');
    for (const prepared of ['rendered answers turn', null]) {
      mocks.prepareAnswers.mockResolvedValueOnce(prepared);
      mocks.claimSessionAnswers.mockRejectedValueOnce(answered);
      const second = await call('answers', payload);
      expect(second.next).toHaveBeenCalledWith(answered);
      expect(second.json).not.toHaveBeenCalled();
    }
    expect(mocks.deliverAnswers).toHaveBeenCalledTimes(1);
    // Invalid answers never reach the claim, so they cannot consume the turn; a closed run is refused before any Guild read.
    mocks.claimSessionAnswers.mockClear();
    mocks.prepareAnswers.mockRejectedValueOnce(Object.assign(new Error('invalid'), { statusCode: 400 }));
    expect((await call('answers', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    mocks.prepareAnswers.mockClear();
    mocks.assertRunOpen.mockRejectedValueOnce(conflict('MKTG_RUN_CLOSED'));
    expect((await call('answers', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ code: 'MKTG_RUN_CLOSED' }));
    expect(mocks.prepareAnswers).not.toHaveBeenCalled();
    expect(mocks.claimSessionAnswers).not.toHaveBeenCalled();
  });
  it('checks creator proof before any result read and reads the owned run through the tracker in the resolved project', async () => {
    const payload = { sessionId: 'session-a', ownerToken: 'owner-proof', project: 'project-1' };
    mocks.verifySessionOwnerToken.mockReturnValueOnce(false);
    expect((await call('result', payload)).next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.ownedOneOffResult).not.toHaveBeenCalled();
    const failed = { status: 'failed', failure: { reason: 'The agent stopped before it could finish this run.' } };
    mocks.ownedOneOffResult.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce(failed);
    expect((await call('result', payload)).json).toHaveBeenCalledWith({ status: 'pending' });
    expect(mocks.ownedOneOffResult).toHaveBeenCalledWith(expect.anything(), 'resolved-project', 'aeo-geo', 'session-a', {});
    expect(mocks.verifySessionOwnerToken).toHaveBeenCalledWith('owner-proof', 'synthetic-lfid', 'aeo-geo:resolved-project:session-a');
    expect((await call('result', payload)).json).toHaveBeenCalledWith(failed);
  });
  it.each(['result', 'answers'] as const)('rejects %s replay into another canonical project before reading or answering Guild', async (kind) => {
    mocks.getProjectById.mockResolvedValue({ uid: 'other-project', writer: true });
    mocks.verifySessionOwnerToken.mockImplementation((_token, _user, scope) => scope === 'aeo-geo:resolved-project:session-a');
    const result = await call(kind, {
      project: 'other-project',
      sessionId: 'session-a',
      ownerToken: 'owner-proof',
      documentId: 'run-012345678901234567890123',
      questionsId,
      answers: [],
    });
    expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.ownedOneOffResult).not.toHaveBeenCalled();
    expect(mocks.assertRunOpen).not.toHaveBeenCalled();
    expect(mocks.claimSessionAnswers).not.toHaveBeenCalled();
  });
});
