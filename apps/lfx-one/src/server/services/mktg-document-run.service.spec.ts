// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MKTG_STARTED_RUN_READ_CONCURRENCY } from '@lfx-one/shared/constants';

const objects = vi.hoisted(() => new Map<string, { body: string; metadata: Record<string, string>; lastModified: Date }>());
const flows = vi.hoisted(() => ({ getResult: vi.fn(), getProjectById: vi.fn(), getDocument: vi.fn(), ensureBucket: vi.fn(), readiness: vi.fn() }));
const logs = vi.hoisted(() => ({ warning: vi.fn(), debug: vi.fn(), info: vi.fn() }));
const io = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn(), put: vi.fn(), writes: 0, dropAfterWrite: false, activeReads: 0, maxReads: 0 }));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-document-store.utils'));
vi.mock('./brand-kit.service', () => ({
  BrandKitService: class {
    public getResult = flows.getResult;
  },
}));
vi.mock('./foundation-message.service', () => ({
  FoundationMessageService: class {
    public getResult = flows.getResult;
  },
}));
vi.mock('./icp.service', () => ({
  IcpService: class {
    public getResult = flows.getResult;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = flows.getProjectById;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public getDocument = flows.getDocument;
  },
}));
vi.mock('./logger.service', () => ({ logger: logs }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public ensureBucket = flows.ensureBucket;
    public readiness = flows.readiness;
    public async headObject(_req: unknown, _purpose: string, key: string) {
      io.head(key);
      io.activeReads++;
      io.maxReads = Math.max(io.maxReads, io.activeReads);
      await Promise.resolve();
      io.activeReads--;
      return objects.get(key)?.metadata ?? null;
    }
    public async getObject(_req: unknown, _purpose: string, key: string) {
      io.get(key);
      io.activeReads++;
      io.maxReads = Math.max(io.maxReads, io.activeReads);
      await Promise.resolve();
      io.activeReads--;
      return objects.get(key) ?? null;
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string) {
      return [...objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async putContentAddressedObject(
      _req: unknown,
      _purpose: string,
      key: string,
      body: Buffer,
      _type: string,
      _cache: string,
      metadata: Record<string, string>,
      options: { refreshMetadataWhen?: (metadata: Record<string, string>) => boolean }
    ) {
      io.put(key, metadata);
      const previous = objects.get(key);
      if (previous && !options.refreshMetadataWhen?.(previous.metadata)) {
        return false;
      }
      io.writes++;
      objects.set(key, { body: body.toString('utf8'), metadata, lastModified: new Date() });
      if (io.dropAfterWrite) {
        objects.delete(key);
      }
      return true;
    }
  },
}));

import { MktgDocumentRunService } from './mktg-document-run.service';
import { AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import type { MktgStartedRunRecord } from '@lfx-one/shared/interfaces';
const req = {} as Request;
const project = 'synthetic-project';
const runId = createHash('sha256').update('synthetic-session').digest('hex');
const key = `document-runs/${project}/${runId}.json`;
const location = { agentKey: 'brand-kit', documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` };
const ready = { status: 'ready', version: 1, documentMarkdown: '# Synthetic', persistence: { document: location } };

function stored() {
  const value = objects.get(key);
  if (!value) {
    throw new Error('Missing synthetic run fixture.');
  }
  return value;
}

describe('MktgDocumentRunService', () => {
  let service: MktgDocumentRunService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-15T12:00:00.000Z');
    vi.clearAllMocks();
    objects.clear();
    io.writes = 0;
    io.dropAfterWrite = false;
    io.activeReads = 0;
    io.maxReads = 0;
    flows.getResult.mockResolvedValue({ status: 'pending' });
    flows.getProjectById.mockResolvedValue({ uid: project, writer: true });
    flows.getDocument.mockResolvedValue(null);
    flows.ensureBucket.mockResolvedValue(undefined);
    flows.readiness.mockResolvedValue(true);
    service = new MktgDocumentRunService();
  });
  afterEach(() => vi.useRealTimers());

  it('records runtime-ended failure immediately and returns its full plain reply across browsers and retry', async () => {
    const reply = `The intake was rejected. <b>Supply sources.</b> ${'Synthetic explanation. '.repeat(300)}`;
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.advanceTimersByTime(14_000);
    flows.getResult.mockResolvedValue({ status: 'failed', failureText: reply });
    expect(await service.reconcile(req, project)).toMatchObject([{ state: 'failed', failureText: reply }]);
    expect(stored().metadata['failure-reason']).toBe('no-document');
    expect(JSON.stringify(stored())).not.toContain(reply);
    expect(await new MktgDocumentRunService().reconcile(req, project)).toMatchObject([{ state: 'failed', failureText: reply }]);
    await service.retry(req, project, 'brand-kit', 'living', runId);
    expect(await service.reconcile(req, project)).toMatchObject([{ state: 'failed', failureText: reply }]);
    expect(flows.getResult).toHaveBeenCalledWith(req, 'synthetic-session', project, undefined, 0);
  });

  it.each(['foundation-message', 'brand-kit', 'icp'] as const)('uses the correct freshness gate in both completion paths for %s', async (agentKey) => {
    for (const creator of [false, true]) {
      objects.clear();
      await service.start(req, project, agentKey, 'synthetic-session', 2);
      const result = {
        ...ready,
        status: 'ready' as const,
        persistence: { project, s3_key: 'synthetic-key', content_sha256: 'a'.repeat(64), version: 1, document: { ...location, agentKey } },
      };
      flows.getResult.mockResolvedValue(result);
      vi.advanceTimersByTime(11 * 60_000);
      if (creator) {
        await service.recordResult(req, 'synthetic-session', result);
      } else {
        await service.reconcile(req, project);
      }
      expect(stored().metadata['state'] === 'completed').toBe(agentKey === 'foundation-message');
    }
  });

  it('does not expire a questions pause as a failed writing run', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.advanceTimersByTime(20 * 60_000);
    flows.getResult.mockResolvedValue({ status: 'questions', questionsId: 'synthetic-block' });
    expect(await service.reconcile(req, project)).toMatchObject([{ state: 'writing' }]);
  });

  it('renews the budget and polling mtime after a long questions pause without changing the Started label', async () => {
    await service.start(req, project, 'foundation-message', 'synthetic-session');
    const startedAt = stored().metadata['started-at'];
    vi.advanceTimersByTime(2 * 60 * 60_000);
    flows.getResult.mockResolvedValue({ status: 'questions', questionsId: 'abc12345' });
    expect(await service.reconcile(req, project)).toMatchObject([{ state: 'writing' }]);
    await service.resumeAfterQuestions(req, project, 'synthetic-session', 'abc12345');
    expect(stored().metadata['started-at']).toBe(startedAt);
    expect(stored().metadata['retry-at']).toBe(new Date().toISOString());
    expect(await service.reconcile(req, project, undefined, undefined, true)).toMatchObject([{ state: 'writing' }]);
    vi.advanceTimersByTime(11 * 60_000);
    flows.getResult.mockResolvedValue({ status: 'questions', questionsId: 'def67890' });
    expect(await service.reconcile(req, project)).toMatchObject([{ state: 'writing' }]);
    // A genuinely new block is a pause; the already-answered block is not.
    flows.getResult.mockResolvedValue({ status: 'questions', questionsId: 'abc12345' });
    expect(await service.reconcile(req, project)).toMatchObject([{ state: 'failed' }]);
  });

  it('records the creator result poll failure only after resolving writer access', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    const request = { ...req, body: { project } } as Request;
    flows.getResult.mockResolvedValue({ status: 'failed', failureText: 'Rejected.' });
    await service.recordResult(request, 'synthetic-session', { status: 'failed', failureText: 'Rejected.' }, project);
    expect(stored().metadata['state']).toBe('failed');
    expect(flows.getProjectById).toHaveBeenCalledWith(request, project, true);
    expect(flows.ensureBucket).not.toHaveBeenCalled();
    expect(flows.readiness).not.toHaveBeenCalled();
  });

  it('does not obtain failure scope from the HTTP body', async () => {
    const request = { ...req, body: { project } } as Request;
    await expect(service.recordResult(request, 'synthetic-session', { status: 'failed', failureText: 'Rejected.' })).resolves.toBeUndefined();
    expect(flows.getProjectById).not.toHaveBeenCalled();
    expect(io.get).not.toHaveBeenCalled();
    expect(logs.debug).toHaveBeenCalledWith(request, 'mktg_run_record_result', 'No valid project scope; returning the failure reply without recording it');
    expect(logs.warning).not.toHaveBeenCalled();
  });

  it.each(['', 'a/../b', 'x?y', 'nested/path', 'uid#fragment', 'x%2Fy', ' padded-uid', 'u'.repeat(65)])(
    'rejects malformed failure scope before any authenticated project lookup: %s',
    async (projectUid) => {
      const result = { status: 'failed' as const, failureText: 'The agent rejected this run.' };
      await expect(service.recordResult(req, 'synthetic-session', result, projectUid)).resolves.toBeUndefined();
      expect(result).toEqual({ status: 'failed', failureText: 'The agent rejected this run.' });
      expect(flows.getProjectById).not.toHaveBeenCalled();
      expect(flows.getResult).not.toHaveBeenCalled();
      expect(io.get).not.toHaveBeenCalled();
      expect(io.put).not.toHaveBeenCalled();
      expect(logs.warning).not.toHaveBeenCalled();
      expect(logs.debug).toHaveBeenCalledWith(req, 'mktg_run_record_result', 'No valid project scope; returning the failure reply without recording it');
    }
  );

  it.each(['revoked', 'lookup', 'storage-read', 'storage-write'])(
    'keeps the terminal reply available when failure tracking is unavailable: %s',
    async (reason) => {
      await service.start(req, project, 'brand-kit', 'synthetic-session');
      flows.getResult.mockResolvedValue({ status: 'failed', failureText: 'Rejected.' });
      if (reason === 'revoked') {
        flows.getProjectById.mockResolvedValueOnce({ uid: project, writer: false });
      } else if (reason === 'lookup') {
        flows.getProjectById.mockRejectedValueOnce(new AuthorizationError('Synthetic access lookup refusal'));
      } else if (reason === 'storage-read') {
        io.get.mockImplementationOnce(() => {
          throw new MicroserviceError('Synthetic read unavailable', 503, 'OBJECT_STORE_UNAVAILABLE');
        });
      } else {
        io.put.mockImplementationOnce(() => {
          throw new MicroserviceError('Synthetic write unavailable', 503, 'OBJECT_STORE_UNAVAILABLE');
        });
      }
      await expect(service.recordResult(req, 'synthetic-session', { status: 'failed', failureText: 'Rejected.' }, project)).resolves.toBeUndefined();
      expect(stored().metadata['state']).toBe('writing');
      expect(logs.warning).toHaveBeenCalled();
      expect(flows.ensureBucket).not.toHaveBeenCalled();
      expect(flows.readiness).not.toHaveBeenCalled();
    }
  );

  it.each(['missing', 'mismatched', 'storage-write'])('does not reject already-delivered answers when tracking is %s', async (reason) => {
    if (reason !== 'missing') {
      await service.start(req, project, reason === 'mismatched' ? 'brand-kit' : 'foundation-message', 'synthetic-session');
    }
    if (reason === 'storage-write') {
      vi.advanceTimersByTime(1000);
      io.put.mockImplementationOnce(() => {
        throw new MicroserviceError('Synthetic write unavailable', 503, 'OBJECT_STORE_UNAVAILABLE');
      });
    }
    await expect(service.resumeAfterQuestions(req, project, 'synthetic-session', 'abc12345')).resolves.toBeUndefined();
    expect(logs.warning).toHaveBeenCalled();
    expect(flows.getResult).not.toHaveBeenCalled();
  });

  it('does not fail a tracked attempt merely because a creator poll used a different version gate', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    const request = { ...req, body: { project, priorVersion: 999 } } as Request;
    flows.getResult.mockResolvedValue(ready);
    await service.recordResult(request, 'synthetic-session', { status: 'failed', failureText: 'Not the tracked attempt.' }, project);
    expect(stored().metadata['state']).toBe('writing');
    expect(flows.getResult).toHaveBeenCalledWith(request, 'synthetic-session', project, undefined, 0);
  });

  it('shape-gates and requires writer access before storage preflight or a usable partition', async () => {
    await expect(service.resolveProject(req, '../other')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(flows.getProjectById).not.toHaveBeenCalled();
    flows.getProjectById.mockResolvedValueOnce({ uid: project, writer: false });
    await expect(service.resolveProject(req, project)).rejects.toThrow('write access');
    expect(flows.ensureBucket).not.toHaveBeenCalled();
    await expect(service.resolveProject(req, ' supplied-project ')).resolves.toBe(project);
    expect(flows.ensureBucket).toHaveBeenCalledWith('marketing-os-artifacts', { degradable: true });
    expect(flows.readiness).toHaveBeenCalledWith('marketing-os-artifacts');
  });

  it.each(['missing configuration', 'unreachable store'])('returns typed 503 on %s before Guild work', async (failure) => {
    if (failure === 'missing configuration') {
      flows.ensureBucket.mockRejectedValueOnce(new Error('Synthetic missing bucket'));
    } else {
      flows.readiness.mockResolvedValueOnce(false);
    }
    const resolution = service.resolveProject(req, project);
    await expect(resolution).rejects.toBeInstanceOf(MicroserviceError);
    await expect(resolution).rejects.toMatchObject({ statusCode: 503, code: 'DOCUMENT_RUN_STORAGE_UNAVAILABLE' });
    if (failure === 'unreachable store') {
      await expect(resolution).rejects.toHaveProperty('originalError', undefined);
    }
    expect(flows.getResult).not.toHaveBeenCalled();
    expect(objects.size).toBe(0);
  });

  it('records no starter identity, session capability or linkable subject hash', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    const body = JSON.parse(stored().body);
    expect(body).not.toHaveProperty('startedBy');
    expect(body).not.toHaveProperty('ownerToken');
    const publicRuns = await new MktgDocumentRunService().reconcile(req, project);
    expect(publicRuns).toEqual([{ project, runId, agentKey: 'brand-kit', documentId: 'living', startedAt: '2026-10-15T12:00:00.000Z', state: 'writing' }]);
    expect(JSON.stringify(publicRuns)).not.toContain('synthetic-session');
  });

  it('drops a retired legacy identity field before reusing a record body', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    const value = stored();
    value.body = JSON.stringify({ ...JSON.parse(value.body), startedBy: 'retired-synthetic-pseudonym' });
    value.metadata['state'] = 'failed';
    vi.advanceTimersByTime(1);
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    expect(JSON.parse(stored().body)).not.toHaveProperty('startedBy');
  });

  it('records once, skips sequential completion checks, and logs terminal completion with request context', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    const original = stored().body;
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    expect(objects.size).toBe(1);
    expect(stored().body).toBe(original);
    flows.getResult.mockResolvedValue(ready);
    expect(await new MktgDocumentRunService().reconcile(req, project)).toEqual([]);
    expect(await new MktgDocumentRunService().reconcile(req, project)).toEqual([]);
    expect(flows.getResult).toHaveBeenCalledTimes(1);
    expect(stored().metadata).toMatchObject({ state: 'completed', 'revision-id': location.revisionId });
    expect(logs.info).toHaveBeenCalledWith(req, 'mktg_run_state', expect.any(String), expect.objectContaining({ state: 'completed' }));
  });

  it('does not rewrite storing on every read and eventually exhausts ready-without-receipt persistence', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    flows.getResult.mockResolvedValue({ status: 'ready', version: 1 });
    expect((await service.reconcile(req, project))[0].state).toBe('storing');
    const calls = io.put.mock.calls.length;
    expect((await service.reconcile(req, project))[0].state).toBe('storing');
    expect(io.put).toHaveBeenCalledTimes(calls);
    vi.setSystemTime('2026-10-15T12:11:00.000Z');
    expect((await service.reconcile(req, project))[0].state).toBe('failed');
    flows.getResult.mockClear();
    await service.reconcile(req, project);
    expect(flows.getResult).not.toHaveBeenCalled();
    expect(logs.info).toHaveBeenCalledWith(req, 'mktg_run_state', expect.any(String), expect.objectContaining({ state: 'failed' }));
  });

  it('skips old writing records on timer polls but discovers a day-old finished session on navigation', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.setSystemTime('2026-10-16T12:00:00.000Z');
    flows.getResult.mockResolvedValue(ready);
    io.get.mockClear();
    io.head.mockClear();
    const skipped: string[] = [];
    expect(await service.reconcile(req, project, undefined, undefined, true, skipped)).toEqual([]);
    expect(skipped).toEqual([runId]);
    expect(io.get).not.toHaveBeenCalled();
    expect(io.head).not.toHaveBeenCalled();
    expect(flows.getResult).not.toHaveBeenCalled();
    expect(await new MktgDocumentRunService().reconcile(req, project)).toEqual([]);
    expect(flows.getResult).toHaveBeenCalledOnce();
    expect(io.get).toHaveBeenCalledTimes(2); // The unfinished body, then acknowledgement of its completed metadata.
    expect(stored().metadata['state']).toBe('completed');
  });

  it.each([false, true])('skips completed record bodies after metadata HEAD with poll=%s', async (poll) => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    flows.getResult.mockResolvedValue(ready);
    await service.reconcile(req, project);
    io.get.mockClear();
    io.head.mockClear();
    io.put.mockClear();
    flows.getResult.mockClear();
    expect(await service.reconcile(req, project, undefined, undefined, poll)).toEqual([]);
    expect(io.head).toHaveBeenCalledExactlyOnceWith(key);
    expect(io.get).not.toHaveBeenCalled();
    expect(io.put).not.toHaveBeenCalled();
    expect(flows.getResult).not.toHaveBeenCalled();
  });

  it('accepts a finished old session before applying the unresolved timeout', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.setSystemTime('2026-10-16T12:00:00.000Z');
    flows.getResult.mockResolvedValue(ready);
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(flows.getResult).toHaveBeenCalledOnce();
  });

  it('does not let a stale failed write erase a newer explicit retry-at', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.setSystemTime('2026-10-15T12:11:00.000Z');
    flows.getResult.mockImplementationOnce(async () => {
      stored().metadata['retry-at'] = '2026-10-15T12:11:00.000Z';
      return { status: 'pending' };
    });
    const writes = io.writes;
    expect((await service.reconcile(req, project))[0].state).toBe('writing');
    expect(stored().metadata['retry-at']).toBe('2026-10-15T12:11:00.000Z');
    expect(io.writes).toBe(writes);
  });

  it('renews an explicit retry budget without changing the original Started label', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.setSystemTime('2026-10-15T12:11:00.000Z');
    await service.reconcile(req, project);
    await expect(service.retry(req, project, 'icp', 'living', runId)).rejects.toBeInstanceOf(ResourceNotFoundError);
    await service.retry(req, project, 'brand-kit', 'living', runId);
    expect((await service.reconcile(req, project))[0]).toMatchObject({ state: 'writing', startedAt: '2026-10-15T12:00:00.000Z' });
  });

  it('renews a failed or older in-flight intake on the same session without needing a newer prior version', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    const body = stored().body;
    vi.setSystemTime('2026-10-15T12:11:00.000Z');
    await service.reconcile(req, project);
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    expect((await service.reconcile(req, project))[0]).toMatchObject({ state: 'writing', startedAt: '2026-10-15T12:11:00.000Z' });
    vi.setSystemTime('2026-10-15T12:15:00.000Z');
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    expect(stored().metadata['started-at']).toBe('2026-10-15T12:15:00.000Z');
    expect(stored().body).toBe(body);
    expect(objects.size).toBe(1);
  });

  it('retires a failed record once a later successful run has a stored document revision', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.setSystemTime('2026-10-15T12:11:00.000Z');
    await service.reconcile(req, project);
    await service.start(req, project, 'brand-kit', 'later-session');
    vi.setSystemTime('2026-10-15T12:12:00.000Z');
    flows.getResult.mockResolvedValue(ready);
    flows.getDocument.mockResolvedValue({ revisions: [{ createdAt: '2026-10-15T12:12:00.000Z' }] });
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(stored().metadata['state']).toBe('superseded');
    expect(flows.getResult).toHaveBeenCalledTimes(2);
    expect(flows.getDocument).toHaveBeenCalledOnce();
    expect(Math.max(...flows.getResult.mock.invocationCallOrder)).toBeLessThan(Math.max(...flows.getDocument.mock.invocationCallOrder));
  });

  it('renews a superseded session at the same prior version so a left re-intake stays discoverable', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.setSystemTime('2026-10-15T12:11:00.000Z');
    await service.reconcile(req, project);
    await service.start(req, project, 'brand-kit', 'later-session');
    vi.setSystemTime('2026-10-15T12:12:00.000Z');
    flows.getResult.mockImplementation(async (_req: unknown, session: string) => (session === 'later-session' ? ready : { status: 'pending' }));
    flows.getDocument.mockResolvedValue({ revisions: [{ createdAt: '2026-10-15T12:12:00.000Z' }] });
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(stored().metadata['state']).toBe('superseded');
    const body = stored().body;
    vi.setSystemTime('2026-10-15T12:13:00.000Z');
    await service.start(req, project, 'brand-kit', 'synthetic-session', 0);
    expect(stored().body).toBe(body);
    const progress = await new MktgDocumentRunService().reconcile(req, project);
    expect(progress).toMatchObject([{ runId, state: 'writing', startedAt: '2026-10-15T12:13:00.000Z' }]);
  });

  it('overlaps metadata/body reads but never exceeds the bounded per-entry batch size', async () => {
    const count = MKTG_STARTED_RUN_READ_CONCURRENCY * 2 + 1;
    for (let index = 0; index < count; index++) {
      await service.start(req, project, 'brand-kit', `parallel-session-${index}`);
    }
    io.head.mockClear();
    io.get.mockClear();
    io.maxReads = 0;
    expect(await service.reconcile(req, project)).toHaveLength(count);
    expect(io.head).toHaveBeenCalledTimes(count);
    expect(io.get).toHaveBeenCalledTimes(count);
    expect(io.maxReads).toBeGreaterThan(1);
    expect(io.maxReads).toBeLessThanOrEqual(MKTG_STARTED_RUN_READ_CONCURRENCY);
    expect(io.activeReads).toBe(0);
  });

  it('filters other agents after the session-keyed read and before any Guild call', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    expect(await service.reconcile(req, project, 'icp', 'living')).toEqual([]);
    expect(flows.getResult).not.toHaveBeenCalled();
  });

  it('finishes a storing run when a later read obtains the real revision receipt', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    flows.getResult.mockResolvedValueOnce({ status: 'ready', version: 1 });
    expect((await service.reconcile(req, project))[0].state).toBe('storing');
    flows.getResult.mockResolvedValue(ready);
    expect(await new MktgDocumentRunService().reconcile(req, project)).toEqual([]);
  });

  it('allows a verified creator result receipt to complete a previously failed run', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    vi.setSystemTime('2026-10-15T12:11:00.000Z');
    await service.reconcile(req, project);
    await service.recordResult(req, 'synthetic-session', {
      status: 'ready',
      version: 1,
      persistence: { project, document: { ...location, agentKey: 'brand-kit' }, s3_key: 'synthetic-key', content_sha256: 'a'.repeat(64), version: 1 },
    });
    expect(await service.reconcile(req, project)).toEqual([]);
  });

  it('classifies missing state updates, invalid partitions and unsupported result flows', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    await expect(service.reconcile(req, '../bad')).rejects.toBeInstanceOf(ServiceValidationError);
    const unsupported = { ...JSON.parse(stored().body), agentKey: 'aeo-geo' } as MktgStartedRunRecord;
    await expect(service['result'](req, unsupported)).rejects.toBeInstanceOf(ServiceValidationError);
    io.dropAfterWrite = true;
    await expect(
      service.recordResult(req, 'synthetic-session', {
        status: 'ready',
        version: 1,
        persistence: { project, document: { ...location, agentKey: 'brand-kit' }, s3_key: 'synthetic-key', content_sha256: 'a'.repeat(64), version: 1 },
      })
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('logs corrupt record warnings using the request context without the raw body', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    stored().body = '{not-json';
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(logs.warning).toHaveBeenCalledWith(req, 'mktg_run_read', expect.any(String), { key });
  });

  it('retains existing completion and newer-draft behavior for reused sessions', async () => {
    await service.start(req, project, 'brand-kit', 'synthetic-session');
    flows.getResult.mockResolvedValue(ready);
    await service.reconcile(req, project);
    const body = stored().body;
    await service.start(req, project, 'brand-kit', 'synthetic-session', 1);
    expect(stored().body).toBe(body);
    expect((await service.reconcile(req, project))[0].state).toBe('writing');
    expect(flows.getResult).toHaveBeenLastCalledWith(req, 'synthetic-session', project, undefined, 1);
  });
});
