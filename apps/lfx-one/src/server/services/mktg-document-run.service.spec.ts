// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MKTG_AGENTS,
  MKTG_AGENT_INTAKES,
  MKTG_DOCUMENT_TYPES,
  MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS,
  MKTG_RUN_POLL,
  MKTG_STARTED_RUN_FAILURE_BYTES,
} from '@lfx-one/shared/constants';

const objects = vi.hoisted(() => new Map<string, { body: string; metadata: Record<string, string>; lastModified: Date }>());
const flows = vi.hoisted(() => ({ result: vi.fn(), project: vi.fn(), ensure: vi.fn(), readiness: vi.fn(), get: vi.fn(), head: vi.fn(), active: 0, max: 0 }));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-os-agents.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-document-store.utils'));
vi.mock('./brand-kit.service', () => ({
  BrandKitService: class {
    public getResult = flows.result;
  },
}));
vi.mock('./boilerplates.service', () => ({
  BoilerplatesService: class {
    public getResult = flows.result;
  },
}));
vi.mock('./foundation-message.service', () => ({
  FoundationMessageService: class {
    public getResult = flows.result;
  },
}));
vi.mock('./faq.service', () => ({
  FaqService: class {
    public getResult = flows.result;
  },
}));
vi.mock('./icp.service', () => ({
  IcpService: class {
    public getResult = flows.result;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = flows.project;
  },
}));
vi.mock('./logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn(), info: vi.fn() } }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public ensureBucket = flows.ensure;
    public readiness = flows.readiness;
    public async headObject(_req: unknown, _purpose: string, key: string) {
      flows.head(key);
      flows.active++;
      flows.max = Math.max(flows.max, flows.active);
      await Promise.resolve();
      flows.active--;
      return objects.get(key)?.metadata ?? null;
    }
    public async getObject(_req: unknown, _purpose: string, key: string) {
      flows.get(key);
      flows.active++;
      flows.max = Math.max(flows.max, flows.active);
      await Promise.resolve();
      flows.active--;
      return objects.get(key) ?? null;
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string) {
      return [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async putContentAddressedObject(
      _req: unknown,
      _purpose: string,
      key: string,
      body: Buffer,
      _type: string,
      _cache: string,
      metadata: Record<string, string>,
      options: { refreshMetadataWhen?: (value: Record<string, string>) => boolean }
    ) {
      const old = objects.get(key);
      if (old && !options.refreshMetadataWhen?.(old.metadata)) {
        return false;
      }
      objects.set(key, { body: body.toString('utf8'), metadata, lastModified: new Date() });
      return true;
    }
  },
}));

import { MktgDocumentRunService } from './mktg-document-run.service';
import { AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { logger } from './logger.service';
import type { MktgRunResultResponse, MktgDocumentDetailResponse, MktgDocumentRunSnapshot } from '@lfx-one/shared/interfaces';

const req = {} as Request;
const project = 'synthetic-project';
const session = 'synthetic-session';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const key = (value = session): string => `document-runs/${project}/${hash(value)}.json`;
// Discover the active test matrix from the exact same catalog/intake registration as production.
const types = MKTG_DOCUMENT_TYPES.filter(
  (type) =>
    type.kind === 'living' &&
    type.catalogAgentId &&
    MKTG_AGENT_INTAKES[type.catalogAgentId] &&
    MKTG_AGENTS.some((agent) => agent.id === type.catalogAgentId && agent.status === 'active')
);
const location = (agentKey = types[0].agentKey) => ({ agent_key: agentKey, document_id: 'living', revision_id: `000001-${'a'.repeat(64)}` });
const ready = (agentKey = types[0].agentKey): MktgRunResultResponse => ({
  status: 'ready',
  version: 1,
  persistence: { project, version: 1, s3_key: 'synthetic-key', content_sha256: 'a'.repeat(64), document_location: location(agentKey) },
});
function stored(value = session) {
  const object = objects.get(key(value));
  if (!object) {
    throw new Error('Missing synthetic fixture');
  }
  return object;
}

describe('MktgDocumentRunService core', () => {
  let service: MktgDocumentRunService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-19T12:00:00Z');
    vi.clearAllMocks();
    objects.clear();
    flows.result.mockResolvedValue({ status: 'pending' });
    flows.project.mockResolvedValue({ uid: project, writer: true });
    flows.ensure.mockResolvedValue(undefined);
    flows.readiness.mockResolvedValue(true);
    service = new MktgDocumentRunService();
  });
  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it('captures only the initiating subject and preserves it across ACKs and renewal', async () => {
    const creator = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-creator' } } });
    const visitor = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-visitor' } } });
    await service.start(creator, project, types[0].agentKey, session, 0, 'first-turn');
    const body = stored().body;
    expect(JSON.parse(body).creatorSubject).toBe('synthetic-creator');
    await service.start(visitor, project, types[0].agentKey, session, 0, 'first-turn');
    await service.start(visitor, project, types[0].agentKey, session, 0, 'next-turn');
    expect(stored().body).toBe(body);
    await service.start(req, project, types[0].agentKey, 'unknown-creator');
    expect(JSON.parse(stored('unknown-creator').body).creatorSubject).toBeNull();
  });

  it('accepts concurrent ACKs of the same validated attempt without reopening a completed run', async () => {
    const acknowledgements = await Promise.all([
      service.start(req, project, types[0].agentKey, session),
      service.start(req, project, types[0].agentKey, session),
    ]);
    expect(acknowledgements).toEqual([hash(session), hash(session)]);
    expect(objects.size).toBe(1);
    flows.result.mockResolvedValue(ready());
    await service.recordResult(req, session, ready(), project);
    expect(stored().metadata['state']).toBe('completed');
    await service.start(req, project, types[0].agentKey, session);
    expect(stored().metadata['state']).toBe('completed');
  });

  it('does not adopt a competing ACK recorded for a different agent', async () => {
    const results = await Promise.allSettled([
      service.start(req, project, types[0].agentKey, session),
      service.start(req, project, types[1].agentKey, session),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'DOCUMENT_RUN_STORAGE_UNAVAILABLE' } });
    expect(JSON.parse(stored().body).agentKey).toBe(types[0].agentKey);
  });

  it('requires writer scope and usable tracking storage before generation', async () => {
    expect(await service.resolveProject(req, project)).toBe(project);
    flows.project.mockResolvedValue({ uid: project, writer: false });
    await expect(service.resolveProject(req, project)).rejects.toBeInstanceOf(AuthorizationError);
    flows.project.mockResolvedValue({ uid: project, writer: true });
    flows.readiness.mockResolvedValue(false);
    await expect(service.resolveProject(req, project)).rejects.toBeInstanceOf(MicroserviceError);
    await expect(service.resolveProject(req, '../other')).rejects.toThrow();
    expect(flows.result).not.toHaveBeenCalled();
  });

  it.each(types)('records $agentKey and renews a delivered turn without changing Started; stale receipts exhaust its deadline', async (type) => {
    await service.start(req, project, type.agentKey, session, 8, 'old-turn');
    const body = stored().body;
    expect(body).not.toContain('ownerToken');
    expect(body).not.toContain('startedBy');
    flows.result.mockResolvedValue(ready(type.agentKey));
    await service.recordResult(req, session, ready(type.agentKey), project);
    expect(stored().metadata['state']).toBe('completed');
    vi.advanceTimersByTime(120_000);
    await service.start(req, project, type.agentKey, session, 0, 'renewed-turn');
    expect(stored().body).toBe(body);
    expect(stored().metadata).toMatchObject({ state: 'writing', 'prior-version': '0', 'started-at': '2026-10-19T12:00:00.000Z', 'attempt-id': 'renewed-turn' });
    await service.recordResult(req, session, ready(type.agentKey), project);
    expect(stored().metadata['state']).toBe('writing');
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + 1);
    await service.recordResult(req, session, ready(type.agentKey), project);
    expect(stored().metadata['state']).toBe('failed');
    expect(Buffer.from(stored().metadata['failure-text'], 'base64').toString()).toBe('The run produced no new revision before its writing deadline.');
    const fresh: MktgRunResultResponse = {
      ...ready(type.agentKey),
      persistence: {
        project,
        version: 2,
        s3_key: 'fresh-synthetic-key',
        content_sha256: 'b'.repeat(64),
        document_location: { ...location(type.agentKey), revision_id: `000002-${'b'.repeat(64)}` },
      },
    };
    flows.result.mockResolvedValue(fresh);
    await service.recordResult(req, session, fresh, project);
    await service.start(req, project, type.agentKey, session, 0, 'renewed-turn');
    expect(stored().metadata['state']).toBe('completed');
  });

  it('does not strand a renewed turn in storing when its eventual receipt is only the prior revision', async () => {
    await service.start(req, project, types[0].agentKey, session, 0, 'old-turn');
    flows.result.mockResolvedValue(ready());
    await service.recordResult(req, session, ready(), project);
    vi.advanceTimersByTime(1);
    await service.start(req, project, types[0].agentKey, session, 0, 'renewed-turn');
    flows.result.mockResolvedValue({ status: 'ready', version: 1 });
    await service.recordResult(req, session, { status: 'ready', version: 1 }, project);
    expect(stored().metadata['state']).toBe('storing');
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + 1);
    flows.result.mockResolvedValue(ready());
    await service.recordResult(req, session, ready(), project);
    expect(stored().metadata['state']).toBe('failed');
    expect(Buffer.from(stored().metadata['failure-text'], 'base64').toString()).toBe('The run produced no new revision before its writing deadline.');
  });

  it('ignores pending creator polls and rechecks writer scope and the trusted reader before completion', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await service.recordResult(req, session, { status: 'pending' }, project);
    expect(flows.result).not.toHaveBeenCalled();
    await service.recordResult(req, session, ready(), project);
    expect(stored().metadata['state']).toBe('writing');
    flows.result.mockClear();
    flows.project.mockResolvedValue({ uid: project, writer: false });
    await service.recordResult(req, session, ready(), project);
    expect(flows.result).not.toHaveBeenCalled();
  });

  it.each(types.filter((type) => !!MKTG_AGENT_INTAKES[type.catalogAgentId ?? '']?.endpoints.answers))(
    'keeps $agentKey paused and avoids re-marking unchanged questions',
    async (type) => {
      await service.start(req, project, type.agentKey, session);
      vi.advanceTimersByTime(7_200_000);
      flows.result.mockResolvedValue({ status: 'questions', questionsId: 'a1234567' });
      await service.recordResult(req, session, { status: 'failed' }, project);
      expect(stored().metadata['state']).toBe('questions');
      flows.get.mockClear();
      await service.recordResult(req, session, { status: 'failed' }, project);
      expect(flows.get).toHaveBeenCalledTimes(1); // Caller read only: no mark/re-read for the same pause.
      await service.resumeAfterQuestions(req, project, session, 'a1234567');
      expect(stored().metadata['state']).toBe('writing');
      expect(stored().metadata['started-at']).toBe('2026-10-19T12:00:00.000Z');
      expect(stored().metadata['retry-at']).toBe('2026-10-19T14:00:00.000Z');
      flows.get.mockClear();
      await service.resumeAfterQuestions(req, project, session, 'invalid');
      expect(flows.get).not.toHaveBeenCalled();
    }
  );

  it('spends the writing deadline only after a successful lookup, never after transport failure', async () => {
    await service.start(req, project, types[0].agentKey, session);
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + 1);
    flows.result.mockRejectedValue(new Error('Synthetic Guild outage'));
    await expect(service.recordResult(req, session, { status: 'failed' }, project)).rejects.toThrow('Synthetic Guild outage');
    expect(stored().metadata['state']).toBe('writing');
    flows.result.mockResolvedValue({ status: 'pending' });
    await service.recordResult(req, session, { status: 'failed' }, project);
    expect(stored().metadata['state']).toBe('failed');
    expect(Buffer.from(stored().metadata['failure-text'], 'base64').toString()).toBe('The run did not finish before its writing deadline.');
  });

  it.each(['failed', 'refused'])('bounds %s snapshots, refreshes a full scoped reply and retries only the exact recorded run', async (status) => {
    await service.start(req, project, types[0].agentKey, session);
    const reply = 'Synthetic plain reply. '.repeat(300);
    flows.result.mockResolvedValue({ status, failureText: reply, reply });
    await service.recordResult(req, session, { status: 'failed' }, project);
    expect(stored().metadata['state']).toBe('failed');
    expect(Buffer.byteLength(Buffer.from(stored().metadata['failure-text'], 'base64'))).toBeLessThanOrEqual(MKTG_STARTED_RUN_FAILURE_BYTES);
    expect((await service.refreshFailure(req, project, types[0].agentKey, 'living', hash(session)))?.failureText).toBe(reply);
    await expect(service.retry(req, project, types[1].agentKey, 'living', hash(session))).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(service.retry(req, project, types[0].agentKey, 'living', hash('other'))).rejects.toBeInstanceOf(ResourceNotFoundError);
    vi.advanceTimersByTime(1);
    await service.retry(req, project, types[0].agentKey, 'living', hash(session));
    expect(stored().metadata['state']).toBe('writing');
  });

  it('logs invalid stored JSON with a sanitized error, never its private session bytes', async () => {
    await service.start(req, project, types[0].agentKey, session);
    stored().body = '{"sessionId":"synthetic-private-marker",';
    expect(await service['read'](req, project, key())).toBeNull();
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_read', 'Ignoring invalid started run', {
      project,
      key: key(),
      err: expect.any(ServiceValidationError),
    });
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain('synthetic-private-marker');
  });

  it('owns catalog-to-document tracking and unsupported catalog admission without controller lookups', async () => {
    const agentId = types[0].catalogAgentId ?? '';
    expect(await service.resolveCatalogProject(req, agentId, project)).toBe(project);
    expect(await service.startForCatalogAgent(req, agentId, project, session)).toBe(hash(session));
    flows.project.mockClear();
    expect(await service.resolveCatalogProject(req, 'synthetic-untracked-agent', project)).toBeUndefined();
    expect(flows.project).not.toHaveBeenCalled();
    await expect(service.startForCatalogAgent(req, 'synthetic-untracked-agent', project, session)).rejects.toThrow();
  });

  it('degrades a tracking failure in the service without hiding the returned agent result', async () => {
    const failure = new Error('Synthetic tracking outage');
    vi.spyOn(service, 'recordResult').mockRejectedValueOnce(failure);
    await expect(service.recordResultBestEffort(req, session, ready(), project)).resolves.toBeUndefined();
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_record_result', expect.any(String), { err: failure });
  });

  it.each(['missing', 'store'])('retains an existing document and known rows when selected refresh is %s', async (kind) => {
    const id = hash(session);
    const detail: MktgDocumentDetailResponse = {
      project,
      type: types[0],
      documentId: 'living',
      revisions: [],
      approvedCurrent: null,
      current: { revisionId: location().revision_id, changedAt: '2026-10-19T12:00:00Z', changedBy: null },
    };
    const progress: MktgDocumentRunSnapshot = {
      runs: [{ runId: id, project, agentKey: types[0].agentKey, documentId: 'living', startedAt: '2026-10-19T12:00:00Z', state: 'failed' }],
    };
    const failure =
      kind === 'missing'
        ? new ResourceNotFoundError('Run', id)
        : new MicroserviceError('Synthetic store outage', 503, 'STORE_UNAVAILABLE', { service: 'object_store' });
    vi.spyOn(service, 'refreshFailure').mockRejectedValueOnce(failure);
    const result = await service.detailWithProgress(req, project, types[0], 'living', detail, progress, false, id);
    expect(result).toEqual({ ...detail, ...progress, progressUnavailable: true });
    expect(result?.current).toEqual(detail.current);
    expect(progress).not.toHaveProperty('progressUnavailable');
  });

  it('has one empty-detail policy and rejects malformed/timer refresh before querying a session', async () => {
    const progress: MktgDocumentRunSnapshot = { runs: [] };
    expect(await service.detailWithProgress(req, project, types[0], 'living', null, progress)).toBeNull();
    expect(await service.detailWithProgress(req, project, types[0], 'living', null, progress, true)).toMatchObject({
      revisions: [],
      approvedCurrent: null,
      runs: [],
    });
    await expect(service.detailWithProgress(req, project, types[0], 'living', null, progress, true, hash(session))).rejects.toBeInstanceOf(
      ServiceValidationError
    );
    await expect(service.detailWithProgress(req, project, types[0], 'living', null, progress, false, '../bad')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(flows.result).not.toHaveBeenCalled();
  });

  it('uses a separate persistence budget after a ready result and accepts a matching late receipt', async () => {
    await service.start(req, project, types[0].agentKey, session);
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + 1);
    flows.result.mockResolvedValue({ status: 'ready', version: 1 });
    await service.recordResult(req, session, { status: 'ready', version: 1 }, project);
    expect(stored().metadata['state']).toBe('storing');
    for (let n = 0; n < MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS; n++) {
      await service.recordResult(req, session, { status: 'ready', version: 1 }, project);
    }
    expect(stored().metadata['state']).toBe('failed');
    flows.result.mockResolvedValue(ready());
    expect(await service.refreshFailure(req, project, types[0].agentKey, 'living', hash(session))).toBeNull();
    expect(stored().metadata['state']).toBe('completed');
  });
});
