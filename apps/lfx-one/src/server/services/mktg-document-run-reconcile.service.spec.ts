// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MKTG_AGENTS,
  MKTG_AGENT_INTAKES,
  MKTG_DOCUMENT_TYPES,
  MKTG_STARTED_RUN_READ_CONCURRENCY,
  MKTG_STARTED_RUN_DISCOVERY_LIMIT,
  MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT,
  MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS,
} from '@lfx-one/shared/constants';

const objects = vi.hoisted(() => new Map<string, { body: string; metadata: Record<string, string>; lastModified: Date }>());
const flows = vi.hoisted(() => ({
  result: vi.fn(),
  settle: vi.fn(),
  attribution: vi.fn(),
  project: vi.fn(),
  ensure: vi.fn(),
  readiness: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  active: 0,
  max: 0,
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-redraft.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-os-agents.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/member-360.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-document-store.utils'));
vi.mock('./mktg-document-comments.service', () => ({
  MktgDocumentCommentsService: class {
    public settle = flows.settle;
  },
}));
vi.mock('./brand-kit.service', () => ({
  BrandKitService: class {
    public getResult = flows.result;
    public constructor(attribution?: MktgGenerationAttribution) {
      flows.attribution(attribution);
    }
  },
}));
vi.mock('./boilerplates.service', () => ({
  BoilerplatesService: class {
    public getResult = flows.result;
    public constructor(attribution?: MktgGenerationAttribution) {
      flows.attribution(attribution);
    }
  },
}));
vi.mock('./foundation-message.service', () => ({
  FoundationMessageService: class {
    public getResult = flows.result;
    public constructor(attribution?: MktgGenerationAttribution) {
      flows.attribution(attribution);
    }
  },
}));
vi.mock('./faq.service', () => ({
  FaqService: class {
    public getResult = flows.result;
    public constructor(attribution?: MktgGenerationAttribution) {
      flows.attribution(attribution);
    }
  },
}));
vi.mock('./icp.service', () => ({
  IcpService: class {
    public getResult = flows.result;
    public constructor(attribution?: MktgGenerationAttribution) {
      flows.attribution(attribution);
    }
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
      const object = objects.get(key);
      return object ? { ...object, metadata: { ...object.metadata }, etag: hash(object.body) } : null;
    }
    public async putConditionalObject(_req: unknown, _purpose: string, key: string, input: ObjectStorePutInput) {
      const object = objects.get(key);
      if (!object || input.ifMatch !== hash(object.body)) return false;
      objects.set(key, { body: Buffer.from(input.body).toString('utf8'), metadata: input.metadata ?? {}, lastModified: new Date() });
      return true;
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
import { logger } from './logger.service';
import { AuthorizationError, MicroserviceError, ResourceNotFoundError } from '../errors';
import type { MktgDocumentRunCoverage, MktgGenerationAttribution, ObjectStoreListEntry, ObjectStorePutInput } from '@lfx-one/shared/interfaces';

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
const ready = (agentKey = types[0].agentKey) => ({
  status: 'ready',
  version: 1,
  asset: { kind: 'messaging-framework', content: {} },
  persistence: { project, document_location: location(agentKey) },
});
function stored(value = session) {
  const object = objects.get(key(value));
  if (!object) {
    throw new Error('Missing synthetic fixture');
  }
  return object;
}

describe('MktgDocumentRunService', () => {
  let service: MktgDocumentRunService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-19T12:00:00Z');
    vi.clearAllMocks();
    objects.clear();
    MktgDocumentRunService['terminalCache'].clear();
    flows.active = 0;
    flows.max = 0;
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

  it('requires writer scope and tracking storage before generation', async () => {
    expect(await service.resolveProject(req, project)).toBe(project);
    flows.project.mockResolvedValue({ uid: project, writer: false });
    await expect(service.resolveProject(req, project)).rejects.toBeInstanceOf(AuthorizationError);
    flows.project.mockResolvedValue({ uid: project, writer: true });
    flows.readiness.mockResolvedValue(false);
    await expect(service.resolveProject(req, project)).rejects.toBeInstanceOf(MicroserviceError);
    await expect(service.resolveProject(req, '../other')).rejects.toThrow();
    expect(flows.result).not.toHaveBeenCalled();
  });

  it.each(types)('records and reconciles the registered $agentKey output without leaking private session data', async (type) => {
    await service.start(req, project, type.agentKey, session);
    expect(await service.reconcile(req, project)).toEqual([
      { project, agentKey: type.agentKey, documentId: 'living', runId: hash(session), startedAt: '2026-10-19T12:00:00.000Z', state: 'writing' },
    ]);
    expect(stored().body).not.toContain('ownerToken');
    expect(stored().body).not.toContain('startedBy');
    flows.result.mockResolvedValue(ready(type.agentKey));
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(stored().metadata['state']).toBe('completed');
  });

  it('renews a completed Messaging turn by attempt identity even when its version resets, preserving the original Started date', async () => {
    const type = types.find((candidate) => MKTG_AGENT_INTAKES[candidate.catalogAgentId ?? '']?.assetView === 'messaging-framework');
    expect(type).toBeDefined();
    if (!type) {
      return;
    }
    await service.start(req, project, type.agentKey, session, 8, 'turn-old');
    flows.result.mockResolvedValue(ready(type.agentKey));
    await service.reconcile(req, project);
    const body = stored().body;
    vi.advanceTimersByTime(120_000);
    await service.start(req, project, type.agentKey, session, 0, 'turn-new');
    expect(stored().metadata).toMatchObject({
      state: 'writing',
      'attempt-id': 'turn-new',
      'prior-version': '0',
      'started-at': '2026-10-19T12:00:00.000Z',
      'retry-at': '2026-10-19T12:02:00.000Z',
    });
    expect(stored().body).toBe(body);
    flows.result.mockResolvedValue(ready(type.agentKey));
    expect((await service.reconcile(req, project))[0].state).toBe('writing'); // Prior receipt cannot finish the renewed turn.
    flows.result.mockResolvedValue({
      ...ready(type.agentKey),
      persistence: { project, document_location: { ...location(type.agentKey), revision_id: `000002-${'b'.repeat(64)}` } },
    });
    await service.reconcile(req, project);
    // Duplicate ACK of the same delivered turn cannot reopen it.
    await service.start(req, project, type.agentKey, session, 0, 'turn-new');
    expect(stored().metadata['state']).toBe('completed');
  });

  it('applies the deadline only after a successful Guild lookup, not a timeout or transport failure', async () => {
    await service.start(req, project, types[0].agentKey, session);
    vi.advanceTimersByTime(1_200_000);
    flows.result.mockRejectedValue(new Error('Synthetic Guild outage'));
    expect((await service.reconcile(req, project))[0].state).toBe('writing');
    expect(stored().metadata['state']).toBe('writing');
    flows.result.mockResolvedValue({ status: 'pending' });
    expect((await service.reconcile(req, project))[0].state).toBe('failed');
  });

  it.each(types.filter((type) => !!MKTG_AGENT_INTAKES[type.catalogAgentId ?? '']?.endpoints.answers))(
    'keeps $agentKey questions deadline-exempt and renews after accepted answers',
    async (type) => {
      await service.start(req, project, type.agentKey, session);
      vi.advanceTimersByTime(7_200_000);
      flows.result.mockResolvedValue({ status: 'questions', questionsId: 'a1234567' });
      expect((await service.reconcile(req, project))[0].state).toBe('questions');
      await service.resumeAfterQuestions(req, project, session, 'a1234567');
      expect(stored().metadata['started-at']).toBe('2026-10-19T12:00:00.000Z');
      expect(stored().metadata['retry-at']).toBe('2026-10-19T14:00:00.000Z');
      vi.advanceTimersByTime(660_000);
      expect((await service.reconcile(req, project))[0].state).toBe('failed');
    }
  );

  it.each(['failed', 'refused'])('records a %s reply immediately without storing its text in size-limited metadata', async (status) => {
    await service.start(req, project, types[0].agentKey, session);
    const reply = 'Synthetic refusal <b>plain text</b> '.repeat(300);
    flows.result.mockResolvedValue({ status, failureText: reply, reply });
    const runs = await service.reconcile(req, project);
    expect(runs[0]).toMatchObject({ state: 'failed', failureText: reply });
    expect(JSON.stringify(stored().metadata)).not.toContain(reply);
    await service.retry(req, project, types[0].agentKey, 'living', hash(session));
    expect(stored().metadata['state']).toBe('writing');
    await expect(service.retry(req, project, types[0].agentKey, 'living', hash('other'))).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('ignores nonterminal creator polls and confirms ready receipts under writer scope before recording completion', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await service.recordResult(req, session, { status: 'pending' }, project);
    expect(flows.result).not.toHaveBeenCalled();
    expect(flows.project).not.toHaveBeenCalled();
    const candidate = {
      status: 'ready' as const,
      version: 1,
      persistence: { project, version: 1, s3_key: 'synthetic-key', content_sha256: 'a'.repeat(64), document_location: location() },
    };
    await service.recordResult(req, session, candidate, project);
    expect(stored().metadata['state']).toBe('writing'); // The tracked reader still says pending, not the late creator receipt.
    flows.result.mockClear();
    flows.project.mockResolvedValue({ uid: project, writer: false });
    await service.recordResult(req, session, candidate, project);
    expect(flows.result).not.toHaveBeenCalled();
    flows.project.mockResolvedValue({ uid: project, writer: true });
    flows.result.mockResolvedValue(candidate);
    await service.recordResult(req, session, candidate, project);
    expect(stored().metadata['state']).toBe('completed');
  });

  it('gives ready assets a separate persist budget and permits a matching late receipt to recover failed', async () => {
    await service.start(req, project, types[0].agentKey, session);
    vi.advanceTimersByTime(1_200_000);
    flows.result.mockResolvedValue({ status: 'ready', version: 1 });
    expect((await service.reconcile(req, project))[0].state).toBe('storing');
    for (let n = 0; n < MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS; n++) {
      await service.reconcile(req, project);
    }
    expect(stored().metadata['state']).toBe('failed');
    flows.result.mockResolvedValue(ready());
    const progress = await service.refreshFailure(req, project, types[0].agentKey, 'living', hash(session));
    expect(progress).toBeNull();
    expect(stored().metadata['state']).toBe('completed');
  });

  it('never re-queries failed runs on list reads, bounds reply metadata, and refreshes the full reply only on detail', async () => {
    await service.start(req, project, types[0].agentKey, session);
    const reply = 'Synthetic plain reply. '.repeat(300);
    flows.result.mockResolvedValue({ status: 'failed', failureText: reply });
    expect((await service.reconcile(req, project))[0].failureText).toBe(reply);
    expect(Buffer.byteLength(JSON.stringify(stored().metadata))).toBeLessThan(2048);
    vi.advanceTimersByTime(3000);
    flows.result.mockClear();
    await service.reconcile(req, project);
    flows.head.mockClear();
    flows.get.mockClear();
    await service.reconcile(req, project);
    expect(flows.result).not.toHaveBeenCalled();
    expect(flows.head).not.toHaveBeenCalled();
    expect(flows.get).not.toHaveBeenCalled();
    expect((await service.refreshFailure(req, project, types[0].agentKey, 'living', hash(session)))?.failureText).toBe(reply);
  });

  it.each(types)('passes $agentKey creator attribution separately from the visiting writer', async (type) => {
    const creator = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-creator' } } });
    const visitor = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-visitor' } } });
    await service.start(creator, project, type.agentKey, session);
    await vi.runAllTimersAsync();
    flows.attribution.mockClear();
    await service.reconcile(visitor, project, type.agentKey);
    expect(flows.attribution).toHaveBeenCalledWith({ creatorSubject: 'synthetic-creator' });
    expect(flows.result).toHaveBeenCalledWith(visitor, session, project);
    expect(visitor.oidc.user.sub).toBe('synthetic-visitor');
  });

  it('uses explicit unknown attribution for a legacy record, never the visiting writer', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await vi.runAllTimersAsync();
    const legacy: Record<string, unknown> = JSON.parse(stored().body);
    delete legacy['creatorSubject'];
    stored().body = JSON.stringify(legacy);
    const visitor = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-visitor' } } });
    await service.reconcile(visitor, project);
    expect(flows.attribution).toHaveBeenLastCalledWith({ creatorSubject: null });
    expect(visitor.oidc.user.sub).toBe('synthetic-visitor');
  });

  it('does not call Guild when a run becomes superseded between HEAD and GET', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await vi.runAllTimersAsync();
    vi.spyOn(service['store'], 'getObject').mockImplementationOnce(async () => {
      stored().metadata['state'] = 'superseded';
      return stored();
    });
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(flows.result).not.toHaveBeenCalled();
  });

  it('propagates an actual selected failure lookup outage to the detail availability boundary', async () => {
    await service.start(req, project, types[0].agentKey, session);
    flows.result.mockResolvedValue({ status: 'failed', failureText: 'Synthetic refusal' });
    await service.reconcile(req, project);
    const failure = new MicroserviceError('Synthetic result outage', 503, 'RESULT_UNAVAILABLE');
    flows.result.mockRejectedValueOnce(failure);
    await expect(service.refreshFailure(req, project, types[0].agentKey, 'living', hash(session))).rejects.toBe(failure);
    expect(stored().metadata['state']).toBe('failed');
  });

  it('marks actual selected-result lookup failure unavailable while retaining the stored detail and failed row', async () => {
    await service.start(req, project, types[0].agentKey, session);
    flows.result.mockResolvedValue({ status: 'failed', failureText: 'Synthetic refusal' });
    const rows = await service.reconcile(req, project);
    expect(rows[0].state).toBe('failed');
    const detail = { project, type: types[0], documentId: 'living', revisions: [], approvedCurrent: null };
    flows.result.mockRejectedValueOnce(new MicroserviceError('Synthetic selected result outage', 503, 'RESULT_UNAVAILABLE'));
    await expect(service.detailWithProgress(req, project, types[0], 'living', detail, { runs: rows }, false, hash(session))).resolves.toEqual({
      ...detail,
      runs: rows,
      progressUnavailable: true,
    });
    expect(stored().metadata['state']).toBe('failed');
  });

  it('supersedes the older failed run when a new session for the same document is recorded', async () => {
    await service.start(req, project, types[0].agentKey, session);
    flows.result.mockResolvedValue({ status: 'failed', failureText: 'Synthetic refusal' });
    await service.reconcile(req, project);
    vi.advanceTimersByTime(10);
    await service.start(req, project, types[0].agentKey, 'new-session');
    await vi.runAllTimersAsync();
    expect(stored().metadata['state']).toBe('superseded');
    flows.result.mockResolvedValue({ status: 'pending' });
    expect((await service.reconcile(req, project)).map((run) => run.runId)).toEqual([hash('new-session')]);
  });

  it('bounds discovery and terminal memory independently of history size', async () => {
    await service.start(req, project, types[0].agentKey, session);
    const template = stored();
    objects.clear();
    for (let n = 0; n < MKTG_STARTED_RUN_DISCOVERY_LIMIT + 20; n++) {
      objects.set(key(`history-${n}`), { ...template, metadata: { state: 'completed' }, lastModified: new Date(Date.now() - 10_000 - n) });
    }
    flows.head.mockClear();
    await service.reconcile(req, project);
    expect(flows.head).toHaveBeenCalledTimes(MKTG_STARTED_RUN_DISCOVERY_LIMIT);
    expect(flows.result).not.toHaveBeenCalled();
    for (let n = 0; n < MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT + 20; n++) {
      service['remember']({ key: key(`cache-${n}`), lastModified: new Date(Date.now() - 10_000) }, null);
    }
    expect(MktgDocumentRunService['terminalCache'].size).toBeLessThanOrEqual(MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT);
  });

  it('isolates one storage failure and treats invalid questions ids as debug-only before storage', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await service.start(req, project, types[1].agentKey, 'other-session');
    flows.get.mockImplementation((value: string) => {
      if (value === key()) {
        throw new Error('Synthetic one-record outage');
      }
    });
    const coverage: MktgDocumentRunCoverage = { uncheckedCount: 0, retainedRunIds: [] };
    expect(await service.reconcile(req, project, undefined, undefined, false, coverage)).toHaveLength(1);
    expect(coverage.retainedRunIds).toContain(hash(session));
    expect(coverage.uncheckedCount).toBe(1);
    flows.get.mockReset();
    await service.resumeAfterQuestions(req, project, session, 'invalid');
    expect(flows.get).not.toHaveBeenCalled();
  });

  it('rejects a stale completion when a new delivered turn renewed the record during the lookup', async () => {
    await service.start(req, project, types[0].agentKey, session, 0, 'first');
    flows.result.mockImplementationOnce(async () => {
      await service.start(req, project, types[0].agentKey, session, 0, 'second');
      return ready();
    });
    expect((await service.reconcile(req, project))[0].state).toBe('writing');
    expect(stored().metadata['attempt-id']).toBe('second');
  });

  it('discovers day-old work on navigation; timer polls HEAD first and retain unfinished coverage without GET/Guild', async () => {
    await service.start(req, project, types[0].agentKey, session);
    vi.advanceTimersByTime(86_400_000);
    flows.head.mockClear();
    flows.get.mockClear();
    flows.result.mockClear();
    const coverage: MktgDocumentRunCoverage = { uncheckedCount: 0, retainedRunIds: [] };
    expect(await service.reconcile(req, project, undefined, undefined, true, coverage)).toEqual([]);
    expect(coverage).toEqual({ uncheckedCount: 1, retainedRunIds: [hash(session)] });
    expect(flows.head).toHaveBeenCalledTimes(1);
    expect(flows.get).not.toHaveBeenCalled();
    expect(flows.result).not.toHaveBeenCalled();
    flows.result.mockResolvedValue(ready());
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(stored().metadata['state']).toBe('completed');
  });

  it('bounds metadata/body concurrency and filters scope before calling Guild', async () => {
    for (let n = 0; n < 9; n++) {
      await service.start(req, project, types[0].agentKey, `session-${n}`);
    }
    // Start ACKs no longer await retirement: finish fixture setup before measuring this read's workers.
    await vi.runAllTimersAsync();
    flows.max = 0;
    await service.reconcile(req, project, types[1].agentKey);
    expect(flows.result).not.toHaveBeenCalled();
    expect(flows.max).toBeGreaterThan(1);
    expect(flows.max).toBeLessThanOrEqual(MKTG_STARTED_RUN_READ_CONCURRENCY);
  });

  it('returns the durable ACK before retirement discovery finishes', async () => {
    let finish: (entries: ObjectStoreListEntry[]) => void = () => undefined;
    vi.spyOn(service['store'], 'listObjects').mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await expect(service.start(req, project, types[0].agentKey, session)).resolves.toBe(hash(session));
    expect(stored().metadata['state']).toBe('writing');
    expect(flows.head).not.toHaveBeenCalled();
    finish([]);
    await vi.runAllTimersAsync();
  });

  it.each([
    ['first', 'second'],
    ['second', 'first'],
  ])('never supersedes both equal-time sessions (%s then %s)', async (first, second) => {
    const finish: ((entries: ObjectStoreListEntry[]) => void)[] = [];
    vi.spyOn(service['store'], 'listObjects').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        })
    );
    await Promise.all([service.start(req, project, types[0].agentKey, first), service.start(req, project, types[0].agentKey, second)]);
    expect(finish).toHaveLength(2);
    const entries = [...objects].map(([key, object]) => ({ key, lastModified: object.lastModified }));
    finish.forEach((release) => release(entries));
    await vi.runAllTimersAsync();
    const states = [stored(first).metadata['state'], stored(second).metadata['state']];
    expect(states.filter((state) => state === 'writing')).toHaveLength(1);
    expect(states.filter((state) => state === 'superseded')).toHaveLength(1);
  });

  it('evicts the least recently read terminal entry, not the first inserted one', () => {
    const stamp = new Date(Date.now() - 10_000);
    for (let n = 0; n < MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT; n++) service['remember']({ key: key(`lru-${n}`), lastModified: stamp }, null);
    expect(service['cached'](key('lru-0'))).toBeDefined();
    service['remember']({ key: key('lru-new'), lastModified: stamp }, null);
    expect(MktgDocumentRunService['terminalCache'].has(key('lru-0'))).toBe(true);
    expect(MktgDocumentRunService['terminalCache'].has(key('lru-1'))).toBe(false);
    expect(MktgDocumentRunService['terminalCache'].size).toBe(MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT);
  });

  it('acknowledges a written start even when best-effort retirement LIST fails', async () => {
    const failure = new Error('Synthetic retirement discovery outage');
    vi.spyOn(service['store'], 'listObjects').mockRejectedValueOnce(failure);
    await expect(service.start(req, project, types[0].agentKey, session)).resolves.toBe(hash(session));
    expect(stored().metadata['state']).toBe('writing');
    expect(flows.result).not.toHaveBeenCalled();
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_supersede', expect.any(String), expect.objectContaining({ project, err: failure }));
  });

  it('marks window-skipped unfinished rows unavailable without Guild or leaking private coverage/session fields', async () => {
    await service.start(req, project, types[0].agentKey, session);
    vi.advanceTimersByTime(86_400_000);
    const snapshot = await service.readProgress(req, project, types[0].agentKey, 'living', true);
    expect(snapshot).toEqual({ runs: [expect.objectContaining({ runId: hash(session), state: 'writing' })], progressUnavailable: true });
    expect(await service.readProgress(req, project, types[0].agentKey, 'living', true)).toEqual(snapshot);
    expect(flows.result).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain(session);
    expect(snapshot).not.toHaveProperty('retainedRunIds');
    expect(snapshot).not.toHaveProperty('uncheckedCount');
  });

  it('keeps stored documents independently readable when tracking LIST fails, but does not hide invalid input', async () => {
    vi.spyOn(service['store'], 'listObjects').mockRejectedValueOnce(new Error('Synthetic LIST outage'));
    expect(await service.readProgress(req, project)).toEqual({ runs: [], progressUnavailable: true });
    await expect(service.readProgress(req, '../invalid')).rejects.toThrow();
    expect(flows.result).not.toHaveBeenCalled();
  });

  it('signals an actual progress lookup failure without inventing a run or exposing coverage IDs', async () => {
    await service.start(req, project, types[0].agentKey, session);
    flows.head.mockImplementationOnce(() => {
      throw new Error('Synthetic read outage');
    });
    expect(await service.readProgress(req, project)).toEqual({ runs: [], progressUnavailable: true });
    expect(flows.result).not.toHaveBeenCalled();
  });

  it('does not turn intentionally bounded closed history into an unavailable/active work signal', async () => {
    await service.start(req, project, types[0].agentKey, session);
    const template = stored();
    objects.clear();
    for (let n = 0; n < MKTG_STARTED_RUN_DISCOVERY_LIMIT + 20; n++) {
      objects.set(key(`closed-${n}`), { ...template, metadata: { state: 'completed' }, lastModified: new Date(Date.now() - 10_000 - n) });
    }
    expect(await service.readProgress(req, project)).toEqual({ runs: [] });
  });

  it('starts with batched HEADs, never GETs completed history, and reuses its closed terminal cache', async () => {
    const history = Array.from({ length: 9 }, (_, index) => `completed-${index}`);
    flows.result.mockResolvedValue(ready());
    for (const id of history) {
      await service.start(req, project, types[0].agentKey, id);
      await service.recordResult(req, id, { status: 'ready', version: 1 }, project);
    }
    vi.advanceTimersByTime(3000);
    flows.get.mockClear();
    flows.head.mockClear();
    flows.max = 0;
    await service.start(req, project, types[0].agentKey, 'new-session');
    await vi.runAllTimersAsync();
    for (const id of history) {
      expect(flows.head).toHaveBeenCalledWith(key(id));
      expect(flows.get).not.toHaveBeenCalledWith(key(id));
    }
    expect(flows.max).toBeGreaterThan(1);
    expect(flows.max).toBeLessThanOrEqual(MKTG_STARTED_RUN_READ_CONCURRENCY);
    flows.head.mockClear();
    await service.start(req, project, types[1].agentKey, 'another-agent-session');
    await vi.runAllTimersAsync();
    for (const id of history) {
      expect(flows.head).not.toHaveBeenCalledWith(key(id));
    }
  });

  it('counts outside-window unknowns without an unbounded ID list, excluding known closed cache entries', async () => {
    await service.start(req, project, types[0].agentKey, session);
    const template = stored();
    objects.clear();
    for (let n = 0; n < MKTG_STARTED_RUN_DISCOVERY_LIMIT + 5000; n++) {
      objects.set(key(`large-history-${n}`), { ...template, metadata: { state: 'completed' }, lastModified: new Date(Date.now() - 10_000 - n) });
    }
    const closed = key(`large-history-${MKTG_STARTED_RUN_DISCOVERY_LIMIT}`);
    service['remember']({ key: closed, lastModified: objects.get(closed)?.lastModified }, null);
    const failedId = `large-history-${MKTG_STARTED_RUN_DISCOVERY_LIMIT + 1}`;
    service['remember'](
      { key: key(failedId), lastModified: objects.get(key(failedId))?.lastModified },
      {
        runId: hash(failedId),
        project,
        agentKey: types[0].agentKey,
        documentId: 'living',
        startedAt: '2026-10-19T12:00:00.000Z',
        state: 'failed',
      }
    );
    const coverage: MktgDocumentRunCoverage = { uncheckedCount: 0, retainedRunIds: [] };
    expect(await service.reconcile(req, project, undefined, undefined, false, coverage)).toEqual([]);
    expect(coverage).toEqual({ uncheckedCount: 4999, retainedRunIds: [hash(failedId)] });
    expect(flows.head).toHaveBeenCalledTimes(MKTG_STARTED_RUN_DISCOVERY_LIMIT);
    expect(flows.result).not.toHaveBeenCalled();
    for (let n = 0; n < 500; n++) {
      service['skip']({ key: key(`retained-${n}`) }, coverage, true);
    }
    expect(coverage.retainedRunIds).toHaveLength(MKTG_STARTED_RUN_DISCOVERY_LIMIT + MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT);
  });

  it('does not retain a known closed day-old timer row as unfinished coverage', async () => {
    await service.start(req, project, types[0].agentKey, session);
    stored().metadata['state'] = 'completed';
    vi.advanceTimersByTime(86_400_000);
    flows.get.mockClear();
    const coverage: MktgDocumentRunCoverage = { uncheckedCount: 0, retainedRunIds: [] };
    expect(await service.reconcile(req, project, undefined, undefined, true, coverage)).toEqual([]);
    expect(coverage).toEqual({ uncheckedCount: 0, retainedRunIds: [] });
    expect(flows.get).not.toHaveBeenCalled();
  });

  it('ignores malformed records and rejects cross-document retry targets', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await expect(service.retry(req, project, types[1].agentKey, 'living', hash(session))).rejects.toBeInstanceOf(ResourceNotFoundError);
    objects.set(key(), { ...stored(), body: '{}' });
    expect(await service.reconcile(req, project)).toEqual([]);
  });
});
