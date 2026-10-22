// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { MktgLastIntakeStart, MktgStoredLastIntake } from '@lfx-one/shared/interfaces';
import { MKTG_AGENTS, MKTG_AGENT_INTAKES, MKTG_DOCUMENT_TYPES, MKTG_LAST_INTAKE_MAX_BYTES, MKTG_LAST_INTAKE_SCHEMA } from '@lfx-one/shared/constants';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), resolve: vi.fn(), author: vi.fn(), warning: vi.fn() }));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-os-agents.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-last-intake.constants')),
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = mocks.get;
    public putContentAddressedObject = mocks.put;
  },
}));
vi.mock('./mktg-document-run.service', () => ({
  MktgDocumentRunService: class {
    public resolveProject = mocks.resolve;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: mocks.author }));
vi.mock('./logger.service', () => ({ logger: { warning: mocks.warning, debug: vi.fn() } }));

import { MktgLastIntakeService } from './mktg-last-intake.service';
import { AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';

const req = {} as Request;
const project = 'synthetic-project';
const types = MKTG_DOCUMENT_TYPES.filter(
  (type) =>
    type.kind === 'living' &&
    MKTG_AGENT_INTAKES[type.catalogAgentId ?? ''] &&
    MKTG_AGENTS.some((agent) => agent.id === type.catalogAgentId && agent.status === 'active')
);
const input = (agentId = 'foundation-setup'): MktgLastIntakeStart => ({
  project,
  agentId,
  runId: 'a'.repeat(64),
  answers: { project_name: 'Synthetic project', website_url: 'https://project.example', notes: '' },
  documentCount: 2,
  logoCount: 1,
});

function written(): MktgStoredLastIntake {
  const body = mocks.put.mock.calls.at(-1)?.[3] as Buffer;
  return JSON.parse(body.toString()) as MktgStoredLastIntake;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(project);
  mocks.get.mockResolvedValue(null);
  mocks.put.mockResolvedValue(true);
  mocks.author.mockReturnValue('auth0|synthetic-writer');
});

describe('MktgLastIntakeService', () => {
  it.each(types)('$agentKey stores only registered scalar fields and supported attachment counts', async (type) => {
    const service = new MktgLastIntakeService();
    const intake = MKTG_AGENT_INTAKES[type.catalogAgentId ?? ''];
    const answers = Object.fromEntries(intake.fields.map((field) => [field.key, field.optional ? '' : 'Synthetic value']));
    for (const attachment of intake.attachments ?? []) answers[attachment.answerKey] = 'private dependency content';
    Object.assign(answers, { sessionId: 'private session', ownerToken: 'private proof', extractedText: 'private extraction' });
    await service.recordStartBestEffort(req, { ...input(intake.agentId), answers });
    const record = written();
    expect(record).toMatchObject({
      schema: MKTG_LAST_INTAKE_SCHEMA,
      project,
      agentKey: type.agentKey,
      authorId: 'auth0|synthetic-writer',
      runId: 'a'.repeat(64),
      documentCount: intake.documents ? 2 : 0,
      logoCount: intake.logoFiles ? 1 : 0,
    });
    expect(Number.isFinite(Date.parse(record.startedAt))).toBe(true);
    expect(Object.keys(record.answers)).toEqual(
      intake.fields.filter((field) => !intake.attachments?.some((attachment) => attachment.answerKey === field.key)).map((field) => field.key)
    );
    expect(JSON.stringify(record)).not.toMatch(/private dependency|private session|private proof|private extraction/);
    const call = mocks.put.mock.calls[0];
    expect(call.slice(0, 3)).toEqual([req, 'marketing-os-artifacts', `document-last-intake/${project}/${type.agentKey}.json`]);
    expect(call[5]).toBe('private, no-store');
    expect(call[7].refreshMetadataWhen({})).toBe(true);
    mocks.get.mockResolvedValue({ body: JSON.stringify({ ...record, ownerToken: 'private proof' }) });
    expect(await service.read(req, project, type.agentKey)).toEqual({
      answers: record.answers,
      documentCount: record.documentCount,
      logoCount: record.logoCount,
    });
  });

  it('uses the canonical writer-resolved project and returns null only on confirmed absence', async () => {
    expect(await new MktgLastIntakeService().read(req, 'project-alias', types[0].agentKey)).toBeNull();
    expect(mocks.resolve).toHaveBeenCalledWith(req, 'project-alias');
    expect(mocks.get).toHaveBeenCalledWith(req, 'marketing-os-artifacts', `document-last-intake/${project}/${types[0].agentKey}.json`);
  });

  it('denies a nonwriter before reading any private object', async () => {
    mocks.resolve.mockRejectedValue(new AuthorizationError('No write access'));
    await expect(new MktgLastIntakeService().read(req, project, types[0].agentKey)).rejects.toBeInstanceOf(AuthorizationError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it.each(['../brand-kit', 'linkedin-post', 'unknown', ['brand-kit']].map((agentKey) => ({ agentKey })))(
    'rejects unsupported selectors before project/store lookup: $agentKey',
    async ({ agentKey }) => {
      await expect(new MktgLastIntakeService().read(req, project, agentKey)).rejects.toBeInstanceOf(ServiceValidationError);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.get).not.toHaveBeenCalled();
    }
  );

  it('allows replacement at one key without listing or compare-and-swap', async () => {
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, input());
    await service.recordStartBestEffort(req, { ...input(), answers: { project_name: 'Changed synthetic value' }, runId: 'b'.repeat(64) });
    expect(mocks.put.mock.calls[0][2]).toBe(mocks.put.mock.calls[1][2]);
    expect(written().answers['project_name']).toBe('Changed synthetic value');
    expect(written().runId).toBe('b'.repeat(64));
  });

  it('does not invent last-run values for fields absent from the accepted input or older stored history', async () => {
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, { ...input('brand-kit'), answers: { project_name: 'Synthetic project' } });
    expect(written().answers).toEqual({ project_name: 'Synthetic project' });
    mocks.get.mockResolvedValue({ body: JSON.stringify(written()) });
    expect(await service.read(req, project, 'brand-kit')).toMatchObject({ answers: { project_name: 'Synthetic project' } });
  });

  it('preserves explicitly submitted blank fields while normalizing the accepted scalar whitespace', async () => {
    await new MktgLastIntakeService().recordStartBestEffort(req, { ...input('brand-kit'), answers: { project_name: ' Synthetic project ', notes: '  ' } });
    expect(written().answers).toEqual({ project_name: 'Synthetic project', notes: '' });
  });

  it.each(['store', 'parse', 'scope', 'schema', 'shape', 'size', 'count'])(
    'reports unavailable, not absent, for a %s failure without leaking private bytes',
    async (failure) => {
      const service = new MktgLastIntakeService();
      await service.recordStartBestEffort(req, input());
      const record = written();
      let body = JSON.stringify(record);
      if (failure === 'store') mocks.get.mockRejectedValue(new MicroserviceError('private source', 503, 'TEST'));
      if (failure === 'parse') body = '{private source';
      if (failure === 'scope') body = JSON.stringify({ ...record, project: 'other-project' });
      if (failure === 'schema') body = JSON.stringify({ ...record, schema: 'unknown' });
      if (failure === 'shape') body = JSON.stringify({ ...record, answers: { project_name: ['private source'] } });
      if (failure === 'size') body = 'x'.repeat(MKTG_LAST_INTAKE_MAX_BYTES + 1);
      if (failure === 'count') body = JSON.stringify({ ...record, documentCount: -1 });
      if (failure !== 'store') mocks.get.mockResolvedValue({ body });
      await expect(service.read(req, project, 'foundation-message')).rejects.toMatchObject({ statusCode: 503, code: 'MKTG_LAST_INTAKE_UNAVAILABLE' });
      await expect(service.read(req, project, 'foundation-message')).rejects.not.toThrow('private source');
    }
  );

  it.each(['write', 'author', 'size', 'scope', 'agent', 'metadata'])('keeps accepted Generate successful when snapshot fails: %s', async (failure) => {
    const payload = input();
    if (failure === 'write') mocks.put.mockRejectedValue(new MicroserviceError('private source', 503, 'TEST'));
    if (failure === 'author') mocks.author.mockReturnValue(null);
    if (failure === 'size') payload.answers['project_name'] = 'x'.repeat(MKTG_LAST_INTAKE_MAX_BYTES);
    if (failure === 'scope') payload.project = '../other';
    if (failure === 'agent') payload.agentId = 'unknown';
    if (failure === 'metadata') payload.runId = 'private-session-not-a-run-id';
    await expect(new MktgLastIntakeService().recordStartBestEffort(req, payload)).resolves.toBeUndefined();
    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.warning.mock.calls)).not.toContain('private source');
    if (failure !== 'write') expect(mocks.put).not.toHaveBeenCalled();
  });
});
