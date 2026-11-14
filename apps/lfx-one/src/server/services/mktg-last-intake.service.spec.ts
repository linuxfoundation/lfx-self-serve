// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { MktgLastIntakeStart, MktgStoredLastIntake } from '@lfx-one/shared/interfaces';
import {
  MKTG_AGENTS,
  MKTG_AGENT_INTAKES,
  MKTG_DOCUMENT_TYPES,
  MKTG_LAST_INTAKE_MAX_BYTES,
  MKTG_LAST_INTAKE_RETENTION_DAYS,
  MKTG_LAST_INTAKE_SCHEMA,
} from '@lfx-one/shared/constants';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn(), resolve: vi.fn(), author: vi.fn(), warning: vi.fn() }));
vi.mock('@lfx-one/shared/constants', async (original) => ({
  ...(await original<typeof import('@lfx-one/shared/constants')>()),
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = mocks.get;
    public putContentAddressedObject = mocks.put;
    public deletePrivateObject = mocks.delete;
    public listObjects = mocks.list;
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
import { AuthenticationError, AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';

const req = {} as Request;
const project = 'synthetic-project';
const subject = 'auth0|synthetic-writer';
const writerKey = (agentKey: string, writer = subject) =>
  agentKey === 'linkedin-post'
    ? `document-last-intake/${project}/${agentKey}/${createHash('sha256').update(writer).digest('hex')}.json`
    : `document-last-intake/${project}/${agentKey}.json`;
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
  mocks.delete.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([]);
  mocks.author.mockReturnValue('auth0|synthetic-writer');
});

afterEach(() => vi.useRealTimers());

describe('MktgLastIntakeService', () => {
  it.each(['read', 'write'])('sweeps expired project siblings on LinkedIn %s without reading their bodies', async (operation) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    const service = new MktgLastIntakeService();
    const payload = { ...input('linkedin-post'), answers: { content_source: 'text', content_text: 'Synthetic source' } };
    await service.recordStartBestEffort(req, payload);
    const record = written();
    const expired = writerKey('linkedin-post', 'synthetic-expired-writer');
    const fresh = writerKey('linkedin-post', 'synthetic-fresh-writer');
    mocks.list.mockResolvedValue([
      { key: expired, lastModified: new Date('2026-09-01T12:00:00Z') },
      { key: fresh, lastModified: new Date() },
      { key: expired.replace(project, 'other-project'), lastModified: new Date('2026-09-01T12:00:00Z') },
    ]);
    mocks.get.mockResolvedValue({ body: JSON.stringify(record) });
    if (operation === 'read') await service.read(req, project, 'linkedin-post');
    else await service.recordStartBestEffort(req, payload);
    expect(mocks.list).toHaveBeenLastCalledWith(req, 'marketing-os-artifacts', `document-last-intake/${project}/linkedin-post/`);
    expect(mocks.delete).toHaveBeenCalledExactlyOnceWith(req, 'marketing-os-artifacts', expired);
    expect(mocks.get.mock.calls).toEqual(operation === 'read' ? [[req, 'marketing-os-artifacts', writerKey('linkedin-post')]] : []);
  });
  it.each(['list', 'delete'])('keeps cleanup best-effort on %s failure with one count-only warning', async (failure) => {
    const keys = [writerKey('linkedin-post'), writerKey('linkedin-post', 'other-writer')];
    mocks.list.mockResolvedValue(keys.map((key) => ({ key, lastModified: new Date('2000-01-01T00:00:00Z') })));
    if (failure === 'list') mocks.list.mockRejectedValue(new Error('PRIVATE_CLEANUP'));
    else mocks.delete.mockRejectedValue(new Error('PRIVATE_CLEANUP'));
    await expect(new MktgLastIntakeService().sweepExpired(req, project)).resolves.toBeUndefined();
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(req, 'mktg_last_intake_cleanup', expect.any(String), { failed: failure === 'list' ? 1 : 2 });
    expect(JSON.stringify(mocks.warning.mock.calls)).not.toMatch(/PRIVATE_CLEANUP|document-last-intake|other-writer/);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([...types.map((type) => ({ agentKey: type.agentKey, agentId: type.catalogAgentId ?? '' })), { agentKey: 'linkedin-post', agentId: 'linkedin-post' }])(
    '$agentKey reads fresh history through 30 days, then deletes expired history and treats it as absent',
    async ({ agentKey, agentId }) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
      const service = new MktgLastIntakeService();
      const answers = agentKey === 'linkedin-post' ? { content_source: 'text', content_text: 'Synthetic retained source' } : input().answers;
      await service.recordStartBestEffort(req, { ...input(agentId), answers });
      const record = written();
      const limit = MKTG_LAST_INTAKE_RETENTION_DAYS * 86400e3;
      for (const age of [limit - 1, limit]) {
        mocks.get.mockResolvedValue({ body: JSON.stringify({ ...record, startedAt: new Date(Date.now() - age).toISOString() }) });
        expect(await service.read(req, project, agentKey)).toMatchObject({ answers: record.answers });
        expect(mocks.delete).not.toHaveBeenCalled();
      }
      mocks.get.mockResolvedValue({ body: JSON.stringify({ ...record, startedAt: new Date(Date.now() - limit - 1).toISOString() }) });
      expect(await service.read(req, project, agentKey)).toBeNull();
      expect(mocks.delete).toHaveBeenCalledExactlyOnceWith(req, 'marketing-os-artifacts', writerKey(agentKey));
    }
  );
  it('keeps expired inputs absent even when best-effort deletion fails, without logging private content', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, { ...input('linkedin-post'), answers: { content_source: 'text', content_text: 'private retention marker' } });
    mocks.get.mockResolvedValue({ body: JSON.stringify({ ...written(), startedAt: '2026-09-01T12:00:00Z' }) });
    mocks.delete.mockRejectedValue(new MicroserviceError('private deletion error', 503, 'TEST'));
    await expect(service.read(req, project, 'linkedin-post')).resolves.toBeNull();
    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.warning.mock.calls)).not.toMatch(/private retention marker|private deletion error/);
  });
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
      runId: 'a'.repeat(64),
      documentCount: intake.documents ? 2 : 0,
      logoCount: intake.logoFiles ? 1 : 0,
    });
    expect(record).not.toHaveProperty('authorId');
    expect(JSON.stringify(record)).not.toContain('auth0|synthetic-writer');
    expect(Number.isFinite(Date.parse(record.startedAt))).toBe(true);
    expect(Object.keys(record.answers)).toEqual(
      intake.fields.filter((field) => !intake.attachments?.some((attachment) => attachment.answerKey === field.key)).map((field) => field.key)
    );
    expect(JSON.stringify(record)).not.toMatch(/private dependency|private session|private proof|private extraction/);
    const call = mocks.put.mock.calls[0];
    expect(call.slice(0, 3)).toEqual([req, 'marketing-os-artifacts', writerKey(type.agentKey)]);
    expect(call[5]).toBe('private, no-store');
    expect(call[7].refreshMetadataWhen({})).toBe(true);
    mocks.get.mockResolvedValue({ body: JSON.stringify({ ...record, ownerToken: 'private proof' }) });
    expect(await service.read(req, project, type.agentKey)).toEqual({
      answers: record.answers,
      documentCount: record.documentCount,
      logoCount: record.logoCount,
    });
  });

  it('projects only public scalar fields from the caller-owned snapshot regardless of extra private fields', async () => {
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, input());
    const record = written();
    mocks.get.mockResolvedValue({ body: JSON.stringify({ ...record, authorId: 'legacy-synthetic-subject' }) });
    expect(await service.read(req, project, 'foundation-message')).toEqual({
      answers: record.answers,
      documentCount: record.documentCount,
      logoCount: record.logoCount,
    });
  });

  it('uses the canonical writer-resolved project and returns null only on confirmed absence', async () => {
    expect(await new MktgLastIntakeService().read(req, 'project-alias', types[0].agentKey)).toBeNull();
    expect(mocks.resolve).toHaveBeenCalledWith(req, 'project-alias');
    expect(mocks.get).toHaveBeenCalledWith(req, 'marketing-os-artifacts', writerKey(types[0].agentKey));
  });

  it('isolates same-project writers by hashed subject and never reads the old project-wide key', async () => {
    const objects = new Map<string, { body: string }>();
    mocks.put.mockImplementation(async (_req, _bucket, key: string, body: Buffer) => {
      objects.set(key, { body: body.toString() });
      return true;
    });
    mocks.get.mockImplementation(async (_req, _bucket, key: string) => objects.get(key) ?? null);
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, { ...input('linkedin-post'), answers: { content_source: 'text', content_text: 'Writer A synthetic input' } });
    const oldKey = `document-last-intake/${project}/linkedin-post.json`;
    objects.set(oldKey, { body: JSON.stringify({ ...written(), answers: { content_source: 'text', content_text: 'Legacy private input' } }) });
    expect(mocks.put.mock.calls[0][2]).toBe(writerKey('linkedin-post'));
    expect(mocks.put.mock.calls[0][2]).not.toContain(subject);
    expect(await service.read(req, project, 'linkedin-post')).toMatchObject({ answers: { content_text: 'Writer A synthetic input' } });
    mocks.author.mockReturnValue('auth0|synthetic-writer-b');
    expect(await service.read(req, project, 'linkedin-post')).toBeNull();
    expect(mocks.get).toHaveBeenLastCalledWith(req, 'marketing-os-artifacts', writerKey('linkedin-post', 'auth0|synthetic-writer-b'));
    expect(mocks.get.mock.calls.some((call) => call[2] === oldKey)).toBe(false);
  });

  it('lets another project writer restore living-agent inputs from the unchanged shared project key', async () => {
    const objects = new Map<string, { body: string }>();
    mocks.put.mockImplementation(async (_req, _bucket, key: string, body: Buffer) => {
      objects.set(key, { body: body.toString() });
      return true;
    });
    mocks.get.mockImplementation(async (_req, _bucket, key: string) => objects.get(key) ?? null);
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, input());
    const key = `document-last-intake/${project}/foundation-message.json`;
    expect(mocks.put.mock.calls[0][2]).toBe(key);
    mocks.author.mockClear();
    mocks.author.mockReturnValue('auth0|synthetic-writer-b');
    expect(await service.read(req, project, 'foundation-message')).toMatchObject({ answers: { project_name: 'Synthetic project' } });
    expect(mocks.get).toHaveBeenLastCalledWith(req, 'marketing-os-artifacts', key);
    expect(mocks.author).not.toHaveBeenCalled();
    mocks.author.mockReturnValue(null);
    expect(await service.read(req, project, 'foundation-message')).not.toBeNull();
    expect(mocks.author).not.toHaveBeenCalled();
  });

  it('rejects a missing LinkedIn writer subject before reading any snapshot', async () => {
    mocks.author.mockReturnValue(null);
    await expect(new MktgLastIntakeService().read(req, project, 'linkedin-post')).rejects.toBeInstanceOf(AuthenticationError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('owns LinkedIn source-aware projection without persisting inactive fields or uploads', async () => {
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, {
      ...input('linkedin-post'),
      answers: { content_source: 'text', content_text: 'Synthetic source', share_link: '', author: 'private-profile', content_file_base64: 'private-upload' },
    });
    expect(written().answers).toEqual({ content_source: 'text', content_text: 'Synthetic source', share_link: '' });
    expect(written()).toMatchObject({ agentKey: 'linkedin-post', documentCount: 0, logoCount: 0 });
    mocks.get.mockResolvedValue({ body: JSON.stringify(written()) });
    expect((await service.read(req, project, 'linkedin-post'))?.answers['content_text']).toBe('Synthetic source');
    await service.recordStartBestEffort(req, {
      ...input('linkedin-post'),
      answers: { content_source: 'file', content_text: 'unused-private', content_url: 'https://unused.example/', content_file_base64: 'private-upload' },
    });
    expect(written().answers).toEqual({ content_source: 'file', share_link: '' });
  });
  it('replaces an older snapshot with current metadata when pasted text exceeds the cap', async () => {
    const service = new MktgLastIntakeService();
    await service.recordStartBestEffort(req, { ...input('linkedin-post'), answers: { content_source: 'text', content_text: 'older text' } });
    mocks.get.mockResolvedValue({ body: JSON.stringify(written()) });
    expect((await service.read(req, project, 'linkedin-post'))?.answers['content_text']).toBe('older text');
    await service.recordStartBestEffort(req, {
      ...input('linkedin-post'),
      runId: 'b'.repeat(64),
      answers: { content_source: 'text', content_text: 'x'.repeat(MKTG_LAST_INTAKE_MAX_BYTES), share_link: 'https://current.example/' },
    });
    const current = written();
    expect(current.runId).toBe('b'.repeat(64));
    expect(current.answers).toEqual({ content_source: 'text', share_link: 'https://current.example/' });
    expect(Buffer.byteLength(JSON.stringify(current))).toBeLessThanOrEqual(MKTG_LAST_INTAKE_MAX_BYTES);
    expect(mocks.put.mock.calls.at(-1)?.[2]).toBe(mocks.put.mock.calls[0][2]);
    mocks.get.mockResolvedValue({ body: JSON.stringify(current) });
    expect((await service.read(req, project, 'linkedin-post'))?.answers).toEqual(current.answers);
  });
  it('denies a nonwriter before reading any private object', async () => {
    mocks.resolve.mockRejectedValue(new AuthorizationError('No write access'));
    await expect(new MktgLastIntakeService().read(req, project, types[0].agentKey)).rejects.toBeInstanceOf(AuthorizationError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it.each(['../brand-kit', 'member-360', 'unknown', ['brand-kit']].map((agentKey) => ({ agentKey })))(
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
