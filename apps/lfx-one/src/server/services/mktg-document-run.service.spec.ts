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

const redraft = vi.hoisted(() => ({ forSession: vi.fn(), assertScope: vi.fn(), settle: vi.fn() }));
vi.mock('./mktg-document-redraft-context.service', () => ({
  MktgDocumentRedraftContextService: class {
    public forSession = redraft.forSession;
    public assertScope = redraft.assertScope;
  },
}));
vi.mock('./mktg-document-comments.service', () => ({
  MktgDocumentCommentsService: class {
    public settle = redraft.settle;
  },
}));
const objects = vi.hoisted(() => new Map<string, { body: string; metadata: Record<string, string>; lastModified: Date }>());
const flows = vi.hoisted(() => ({
  result: vi.fn(),
  project: vi.fn(),
  ensure: vi.fn(),
  readiness: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  beforePut: vi.fn(),
  active: 0,
  max: 0,
}));
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
      // Model the accepted store contract: the predicate HEAD and unconditional PUT can overlap.
      if (old) await flows.beforePut(metadata);
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
    redraft.forSession.mockResolvedValue(null);
    flows.beforePut.mockReset();
    flows.result.mockReset().mockResolvedValue({ status: 'pending' });
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

  it.each([false, true])('ignores A after B, including completed B=%s, without changing its receipt', async (completed) => {
    await service.start(req, project, types[0].agentKey, session, 0, 'turn-A');
    await service.start(req, project, types[0].agentKey, session, 7, 'turn-B');
    if (completed) {
      flows.result.mockResolvedValue(ready());
      await service.recordResult(req, session, ready(), project);
    }
    const before = stored();
    expect(before.metadata).toMatchObject({ 'attempt-id': 'turn-B', 'attempt-history': 'turn-A,turn-B', 'prior-version': '7' });
    expect(before.metadata['state']).toBe(completed ? 'completed' : 'writing');
    if (completed) expect(before.metadata['revision-id']).toBe(location().revision_id);
    expect(await service.start(req, project, types[0].agentKey, session, 0, 'turn-A')).toBe(hash(session));
    expect(stored()).toBe(before);
  });

  it('seeds legacy ACK history from the current attempt without losing it on renewal', async () => {
    await service.start(req, project, types[0].agentKey, session, 0, 'legacy-turn');
    delete stored().metadata['attempt-history'];
    await service.start(req, project, types[0].agentKey, session, 0, 'new-turn');
    const before = stored();
    expect(before.metadata['attempt-history']).toBe('legacy-turn,new-turn');
    await service.start(req, project, types[0].agentKey, session, 0, 'legacy-turn');
    expect(stored()).toBe(before);
  });

  it.each(['failed', 'storing'] as const)('reproduces the accepted non-atomic limitation: stale %s PUT can replace completion', async (state) => {
    await service.start(req, project, types[0].agentKey, session);
    let release: () => void = () => {
      throw new Error('Missing suspended conditional failure');
    };
    let reached: () => void = () => {
      throw new Error('Missing failure barrier');
    };
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    flows.beforePut.mockImplementation(async (metadata: Record<string, string>) => {
      if (metadata['state'] === state) {
        reached();
        await gate;
      }
    });
    const stale: MktgRunResultResponse =
      state === 'failed' ? { status: 'failed', failureText: 'Synthetic stale failure' } : { ...ready(), persistence: undefined };
    flows.result.mockResolvedValueOnce(stale).mockResolvedValueOnce(ready());
    const failure = service.recordResult(req, session, stale, project);
    await paused;
    const before = stored().body;
    await service.recordResult(req, session, ready(), project);
    const completed = stored();
    expect(completed.body).toBe(before);
    expect(completed.metadata).toMatchObject({ state: 'completed', 'revision-id': location().revision_id });
    release();
    await failure;
    // Known limitation, NOT a claimed atomic guarantee: a separate conditional-store WorkItem must fix it.
    expect(stored().metadata['state']).toBe(state);
    expect(stored().metadata['revision-id']).toBeUndefined();
  });

  it('rejects ledger overflow instead of evicting an accepted ACK', async () => {
    const first = 'a'.repeat(128);
    await service.start(req, project, types[0].agentKey, session, 0, first);
    await service.start(req, project, types[0].agentKey, session, 0, 'b'.repeat(128));
    const before = stored();
    await expect(service.start(req, project, types[0].agentKey, session, 0, 'c'.repeat(128))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      validationErrors: [{ field: 'run', message: 'This session has reached its tracked turn limit. Start a new session.', code: 'FIELD_VALIDATION_ERROR' }],
    });
    await service.start(req, project, types[0].agentKey, session, 0, first);
    expect(stored()).toBe(before);
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

  it('returns only an exact known creator binding and does not revive its completed ACK', async () => {
    const actor = { ...req, oidc: { user: { sub: 'opaque-creator' } } } as unknown as Request;
    const agent = types[0].agentKey;
    const runId = hash(session);
    expect(await service.knownRedraftSession(actor, project, agent, 'living', runId, 'send-one', 'opaque-creator')).toBeNull();
    await service.start(actor, project, agent, session, 1, 'send-one');
    expect(await service.knownRedraftSession(actor, project, agent, 'living', runId, 'send-one', 'opaque-creator')).toBe(session);
    await expect(service.knownRedraftSession(actor, project, agent, 'living', runId, 'send-one', 'foreign-creator')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.knownRedraftSession(actor, project, agent, 'living', runId, 'other-send', 'opaque-creator')).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await service.recordResult(actor, session, ready(agent), project);
    const before = structuredClone(stored());
    await service.start(actor, project, agent, session, 1, 'send-one');
    expect(stored()).toEqual(before);
  });
  it('settles only conclusive results, including a later agent failure after a local timeout', async () => {
    const agent = types[0].agentKey;
    await service.start(req, project, agent, session, 1, 'send-one');
    const context = { project, agentKey: agent, requestId: 'send-one' };
    redraft.forSession.mockResolvedValue(context);
    stored().metadata['state'] = 'failed';
    await service.recordResult(req, session, { status: 'pending' }, project);
    expect(redraft.settle).not.toHaveBeenCalled();
    const failure = { status: 'failed' as const, failureText: 'Conclusive synthetic failure' };
    flows.result.mockResolvedValueOnce(failure);
    await service.recordResult(req, session, failure, project);
    expect(redraft.settle).toHaveBeenCalledWith(req, context, failure);
  });
  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])('questions fail only bound redrafts, including an existing pause (bound=%s paused=%s)', async (bound, paused) => {
    const agent = types[0].agentKey;
    await service.start(req, project, agent, session, 1, 'send-one');
    const context = { project, agentKey: agent, requestId: 'send-one' };
    redraft.forSession.mockResolvedValue(bound ? context : null);
    if (paused) stored().metadata['state'] = 'questions';
    const result = { status: 'questions' as const, questionsId: 'unexpected-block' };
    flows.result.mockResolvedValue(paused ? { status: 'pending' } : result);
    redraft.forSession.mockClear();
    await service.recordResult(req, session, result, project);
    expect(redraft.forSession).toHaveBeenCalledTimes(1);
    if (bound) {
      expect(redraft.settle).toHaveBeenCalledWith(req, context, { status: 'failed', failureText: 'The agent asked questions on a comments-only redraft.' });
      expect(stored().metadata['state']).toBe('failed');
      expect(Buffer.from(stored().metadata['failure-text'], 'base64').toString()).toBe('The agent asked questions on a comments-only redraft.');
      await service.recordResult(req, session, result, project);
      expect(stored().metadata['state']).toBe('failed');
    } else {
      expect(stored().metadata['state']).toBe('questions');
      expect(redraft.settle).not.toHaveBeenCalled();
    }
  });
  it('settles failed when a ready redraft exhausts the existing persistence retry budget', async () => {
    const agent = types[0].agentKey;
    await service.start(req, project, agent, session, 1, 'send-one');
    const context = { project, agentKey: agent, requestId: 'send-one' };
    redraft.forSession.mockResolvedValue(context);
    const result = { status: 'ready' as const, version: 2, documentMarkdown: '# Synthetic unstored result' };
    flows.result.mockResolvedValue(result);
    for (let attempt = 0; attempt <= MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS; attempt++) await service.recordResult(req, session, result, project);
    expect(stored().metadata['state']).toBe('failed');
    expect(redraft.settle).toHaveBeenLastCalledWith(req, context, expect.objectContaining({ status: 'failed' }));
  });

  it('settles an older redraft before a second send or Generate supersedes it', async () => {
    const agent = types[0].agentKey;
    await service.start(req, project, agent, session, 1, 'send-a');
    const context = { project, agentKey: agent, requestId: 'send-a' };
    redraft.forSession.mockResolvedValue(context);
    vi.advanceTimersByTime(1);
    await service.start(req, project, agent, 'synthetic-second-session', 0, 'generate-b');
    await vi.waitFor(() => {
      expect(redraft.settle).toHaveBeenCalledWith(
        req,
        context,
        expect.objectContaining({ status: 'failed', failureText: 'A newer run superseded this send.' })
      );
      expect(stored().metadata['state']).toBe('superseded');
    });
  });
  it('releases a bound send when the authoritative Run writing deadline expires without resubmitting', async () => {
    const agent = types[0].agentKey;
    await service.start(req, project, agent, session, 1, 'send-a');
    const context = { project, agentKey: agent, requestId: 'send-a' };
    redraft.forSession.mockResolvedValue(context);
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + 1);
    await service.readProgress(req, project, agent, 'living');
    expect(redraft.settle).toHaveBeenCalledWith(req, context, expect.objectContaining({ status: 'failed' }));
    expect(stored().metadata['state']).toBe('failed');
  });

  it('does not treat the selected base receipt as completion of a fresh redraft', async () => {
    const agent = types[0].agentKey;
    await service.start(req, project, agent, session, 1, 'send-one', location(agent).revision_id);
    await service.recordResult(req, session, ready(agent), project);
    expect(stored().metadata['state']).toBe('writing');
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
      await service.recordResult(req, session, { status: 'questions', questionsId: 'a1234567' }, project);
      expect(stored().metadata['state']).toBe('questions');
      flows.get.mockClear();
      await service.recordResult(req, session, { status: 'questions', questionsId: 'a1234567' }, project);
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

  it('reads stored detail after explicit failure refresh so a late stored asset is not lost', async () => {
    const order: string[] = [];
    vi.spyOn(service, 'refreshFailure').mockImplementationOnce(async () => {
      order.push('refresh');
      return null;
    });
    const readDetail = async (): Promise<MktgDocumentDetailResponse> => {
      order.push('detail');
      return { project, type: types[0], documentId: 'living', revisions: [], approvedCurrent: null };
    };
    const result = await service.detailWithProgress(req, project, types[0], 'living', readDetail, { runs: [] }, false, hash(session));
    expect(order).toEqual(['refresh', 'detail']);
    expect(result).toMatchObject({ project, runs: [] });
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
