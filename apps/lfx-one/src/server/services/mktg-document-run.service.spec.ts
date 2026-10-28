// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
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
  MKTG_RUN_FAILURE_REASON,
  MKTG_ONE_OFF_STOPPED_MESSAGE,
  MKTG_STARTED_RUN_READ_CONCURRENCY,
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
  events: vi.fn(),
  author: vi.fn(),
  interrupt: vi.fn(),
  linkedin: vi.fn(),
  member: vi.fn(),
  attribution: vi.fn(),
  project: vi.fn(),
  ensure: vi.fn(),
  readiness: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  beforePut: vi.fn(),
  beforeClaim: vi.fn(),
  beforeMark: vi.fn(),
  claim: vi.fn(),
  active: 0,
  max: 0,
}));
vi.mock('./mktg-document-author.service', () => ({
  MktgDocumentAuthorService: class {
    public resolveAuthor = flows.author;
  },
}));
vi.mock('./guild.service', async (original) => {
  const actual = await original<typeof import('./guild.service')>();
  return {
    GuildService: class extends actual.GuildService {
      public override getRawEventPayloads = flows.events;
      public override interruptSession = flows.interrupt;
    },
  };
});
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
vi.mock('./linkedin-post.service', () => ({
  LinkedinPostService: class {
    public result = flows.linkedin;
    public constructor(...args: unknown[]) {
      flows.attribution(...args);
    }
  },
}));
vi.mock('./member-360.service', async (original) => {
  const actual = await original<typeof import('./member-360.service')>();
  return {
    Member360Service: class {
      public static toRunResult = actual.Member360Service.toRunResult;
      public result = flows.member;
      public constructor(...args: unknown[]) {
        flows.attribution(...args);
      }
    },
  };
});
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
      const previous = objects.get(key);
      if (
        previous?.metadata['state'] === 'questions' &&
        input.metadata?.['state'] === 'writing' &&
        JSON.parse(Buffer.from(input.body).toString('utf8')).answeredBy
      ) {
        flows.claim(input);
        await flows.beforeClaim(input);
      } else {
        await flows.beforeMark(input);
        await flows.beforePut(input.metadata);
      }
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
      // Model the accepted store contract: the predicate HEAD and unconditional PUT can overlap.
      if (old) await flows.beforePut(metadata);
      objects.set(key, { body: body.toString('utf8'), metadata, lastModified: new Date() });
      return true;
    }
  },
}));

import { MktgDocumentRunService } from './mktg-document-run.service';
import { AuthorizationError, ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { logger } from './logger.service';
import type { MktgRunResultResponse, MktgDocumentDetailResponse, MktgDocumentRunSnapshot, ObjectStorePutInput } from '@lfx-one/shared/interfaces';

const req = {} as Request;
const writerRequest = (sub: string): Request => Object.assign({}, req, { oidc: { ...req.oidc, user: { sub } } });
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
    flows.beforeClaim.mockReset();
    flows.beforeMark.mockReset();
    flows.result.mockReset().mockResolvedValue({ status: 'pending' });
    flows.events.mockReset().mockResolvedValue([]);
    flows.interrupt.mockReset().mockResolvedValue(undefined);
    flows.author.mockReset().mockResolvedValue(null);
    flows.linkedin.mockReset().mockResolvedValue({ status: 'pending' });
    flows.member.mockReset().mockResolvedValue({ status: 'pending' });
    flows.project.mockResolvedValue({ uid: project, writer: true });
    flows.ensure.mockResolvedValue(undefined);
    flows.readiness.mockResolvedValue(true);
    service = new MktgDocumentRunService();
  });
  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  describe('durable kit questions and scoped writer answers', () => {
    const questionsId = 'c'.repeat(64);
    const questions = [
      {
        key: 'goal',
        label: 'Goal',
        question: 'Which synthetic goal?',
        why: 'No selected goal.',
        suggestedAnswer: 'Synthetic adoption',
        basis: ['Synthetic framework'],
      },
    ];
    async function waiting(): Promise<void> {
      await service.start(req, project, types[0].agentKey, session);
      const object = stored();
      object.body = JSON.stringify({ ...JSON.parse(object.body), creatorSubject: 'synthetic-original-writer' });
      flows.result.mockResolvedValue({ status: 'questions', questionsId, questions });
      await service.readProgress(req, project);
    }
    it('stores the entire turn once, survives a new service instance, and preserves askedAt on repeated polls', async () => {
      await waiting();
      const turn = { questionsId, questions, askedAt: new Date().toISOString() };
      expect(JSON.parse(stored().body).pendingQuestions).toEqual(turn);
      const originalBody = stored().body;
      vi.advanceTimersByTime(1000);
      expect((await new MktgDocumentRunService().readProgress(req, project)).runs[0]?.pendingQuestions).toEqual(turn);
      expect(stored().body).toBe(originalBody);
      expect((await service.questionsForAnswers(req, project, hash(session), questionsId)).creatorSubject).toBe('synthetic-original-writer');
    });
    it('backfills an absent legacy questions payload without changing the existing schema', async () => {
      await service.start(req, project, types[0].agentKey, session);
      const schema = JSON.parse(stored().body).schema;
      stored().metadata['state'] = 'questions';
      expect(JSON.parse(stored().body)).not.toHaveProperty('pendingQuestions');
      flows.result.mockResolvedValue({ status: 'questions', questionsId, questions });
      const progress = await service.readProgress(req, project);
      expect(progress.runs[0]?.pendingQuestions).toMatchObject({ questionsId, questions });
      expect(JSON.parse(stored().body).schema).toBe(schema);
    });
    it.each(['answered', 'failed', 'completed', 'discarded'] as const)('clears the stored turn when %s', async (exit) => {
      await waiting();
      if (exit === 'answered') await service.resumeAfterQuestions(req, project, session, questionsId);
      else if (exit === 'discarded') await service.assertSingleActiveRun(req, project, types[0].agentKey, { discard: hash(session) });
      else {
        flows.result.mockResolvedValue(exit === 'failed' ? { status: 'failed', failureText: 'Synthetic stopped run.' } : ready());
        await service.readProgress(req, project);
      }
      expect(JSON.parse(stored().body)).not.toHaveProperty('pendingQuestions');
      if (exit === 'answered') {
        expect(stored().metadata).toMatchObject({ state: 'writing', 'answered-questions-id': questionsId });
        expect((await service.readProgress(req, project)).runs[0]?.pendingQuestions).toBeUndefined();
      }
    });
    it('projects only to a currently verified canonical writer, not a viewer or a mismatched project', async () => {
      await waiting();
      flows.project.mockResolvedValue({ uid: project, writer: false });
      expect((await service.readProgress(req, project)).runs[0]).not.toHaveProperty('pendingQuestions');
      flows.project.mockResolvedValue({ uid: 'synthetic-other-project', writer: true });
      expect((await service.readProgress(req, project)).runs[0]).not.toHaveProperty('pendingQuestions');
      flows.project.mockResolvedValue({ uid: project, writer: true });
      expect((await service.readProgress(req, project)).runs[0]?.pendingQuestions).toMatchObject({ questionsId, questions });
    });
    it('denies a viewer before fetching the private record', async () => {
      await waiting();
      flows.get.mockClear();
      flows.project.mockResolvedValue({ uid: project, writer: false });
      await expect(service.questionsForAnswers(req, project, hash(session), questionsId)).rejects.toMatchObject({ statusCode: 403 });
      expect(flows.get).not.toHaveBeenCalled();
    });
    it('denies a different canonical project before fetching the private record', async () => {
      await waiting();
      flows.get.mockClear();
      flows.project.mockResolvedValue({ uid: 'synthetic-other-project', writer: true });
      await expect(service.questionsForAnswers(req, project, hash(session), questionsId)).rejects.toMatchObject({ statusCode: 403 });
      expect(flows.get).not.toHaveBeenCalled();
    });
    it('rejects both stale turns and non-waiting records with the answered conflict', async () => {
      await waiting();
      await expect(service.questionsForAnswers(req, project, hash(session), 'd'.repeat(64))).rejects.toMatchObject({ statusCode: 409 });
      stored().metadata['state'] = 'writing';
      await expect(service.questionsForAnswers(req, project, hash(session), questionsId)).rejects.toMatchObject({ statusCode: 409, code: 'MKTG_RUN_ANSWERED' });
    });
    it('conditionally claims the exact turn, persists attribution, and exposes writing without private fields', async () => {
      await waiting();
      const writer = writerRequest('synthetic-answer-writer');
      const etag = hash(stored().body);
      const result = await service.claimAnswers(writer, project, hash(session), questionsId);
      expect(flows.claim).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: etag, metadata: expect.objectContaining({ state: 'writing' }) }));
      expect(result).toMatchObject({
        state: 'writing',
        answeredQuestionsId: questionsId,
        answeredBy: 'synthetic-answer-writer',
        answeredAt: new Date().toISOString(),
      });
      expect(JSON.parse(stored().body)).toEqual(JSON.parse(JSON.stringify(result)));
      expect(JSON.parse(stored().body)).not.toHaveProperty('pendingQuestions');
      const progress = (await service.readProgress(writer, project)).runs[0];
      expect(progress).toMatchObject({ state: 'writing' });
      expect(progress).not.toHaveProperty('pendingQuestions');
      expect(progress).not.toHaveProperty('answeredBy');
      expect(progress).not.toHaveProperty('answeredAt');
    });
    it('fences a held questions poll so it cannot overwrite and reopen an accepted answer claim', async () => {
      await waiting();
      let release = (): void => undefined;
      let entered = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      flows.beforeMark.mockImplementationOnce(async () => {
        entered();
        await held;
      });
      flows.result.mockResolvedValue({ status: 'questions', questionsId: 'd'.repeat(64), questions });
      const polling = service.readProgress(req, project);
      await reached;
      const writer = writerRequest('synthetic-claim-writer');
      await service.claimAnswers(writer, project, hash(session), questionsId);
      release();
      const result = await polling;
      expect(result.runs[0]?.state).toBe('writing');
      expect(JSON.parse(stored().body)).toMatchObject({ state: 'writing', answeredQuestionsId: questionsId, answeredBy: 'synthetic-claim-writer' });
      expect(JSON.parse(stored().body)).not.toHaveProperty('pendingQuestions');
    });
    it('allows exactly one of two concurrent writers to claim an observed ETag', async () => {
      await waiting();
      let release = (): void => undefined;
      let arrived = 0;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      flows.beforeClaim.mockImplementation(async () => {
        if (++arrived === 2) release();
        await barrier;
      });
      flows.author.mockResolvedValue({ name: 'Synthetic Writer' });
      const writers = ['synthetic-writer-a', 'synthetic-writer-b'].map(writerRequest);
      const results = await Promise.allSettled(writers.map((writer) => new MktgDocumentRunService().claimAnswers(writer, project, hash(session), questionsId)));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((result) => result.status === 'rejected');
      expect(loser?.status === 'rejected' ? loser.reason : null).toMatchObject({
        statusCode: 409,
        code: 'MKTG_RUN_ANSWERED',
        message: 'Already answered by Synthetic Writer',
        details: { runId: hash(session), questionsId, answeredBy: 'Synthetic Writer', answeredAt: new Date().toISOString() },
      });
      expect(flows.claim).toHaveBeenCalledTimes(2);
      expect(JSON.parse(stored().body).answeredBy).toMatch(/^synthetic-writer-[ab]$/);
    });
    it.each([null, 'synthetic-writer@example.test', 'synthetic-private-subject'])(
      'uses null fallback for unavailable or non-display claimant name %s',
      async (name) => {
        await waiting();
        const writer = writerRequest('synthetic-private-subject');
        await service.claimAnswers(writer, project, hash(session), questionsId);
        flows.author.mockResolvedValue({ name });
        await expect(service.claimAnswers(writer, project, hash(session), questionsId)).rejects.toMatchObject({
          statusCode: 409,
          code: 'MKTG_RUN_ANSWERED',
          message: 'Already answered',
          details: { runId: hash(session), questionsId, answeredBy: null, answeredAt: new Date().toISOString() },
        });
        expect(flows.claim).toHaveBeenCalledTimes(1);
        expect(flows.author).toHaveBeenCalledWith(writer, 'synthetic-private-subject');
      }
    );
    it('allows only the recorded one-off creator through the owner transport, never the public writer route', async () => {
      const owner = writerRequest('synthetic-linkedin-creator');
      const other = writerRequest('synthetic-other-writer');
      await service.startForOneOff(owner, 'linkedin-post', project, session);
      flows.linkedin.mockResolvedValue({ status: 'questions', questionsId, questions });
      await service.readProgress(owner, project);
      await expect(service.claimSessionAnswers(other, project, session, questionsId, 'linkedin-post')).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.claimAnswers(owner, project, hash(session), questionsId)).rejects.toMatchObject({ statusCode: 403 });
      expect(flows.claim).not.toHaveBeenCalled();
      await service.claimSessionAnswers(owner, project, session, questionsId, 'linkedin-post');
      expect(flows.claim).toHaveBeenCalledTimes(1);
      expect(JSON.parse(stored().body)).toMatchObject({ state: 'writing', answeredBy: 'synthetic-linkedin-creator' });
    });
    it('binds creator transports to their catalog agent before using the same conditional claim', async () => {
      await waiting();
      const writer = writerRequest('synthetic-original-writer');
      await expect(service.claimSessionAnswers(writer, project, session, questionsId, 'synthetic-wrong-agent')).rejects.toMatchObject({ statusCode: 403 });
      expect(flows.claim).not.toHaveBeenCalled();
      await service.claimSessionAnswers(writer, project, session, questionsId, types[0].catalogAgentId ?? '');
      expect(flows.claim).toHaveBeenCalledTimes(1);
      expect(JSON.parse(stored().body)).toMatchObject({ state: 'writing', answeredQuestionsId: questionsId });
    });
    it('cannot select a record in another project using a known run id', async () => {
      await waiting();
      flows.project.mockResolvedValue({ uid: 'synthetic-other-project', writer: true });
      await expect(service.questionsForAnswers(req, 'synthetic-other-project', hash(session), questionsId)).rejects.toMatchObject({ statusCode: 404 });
    });
    it('stores a one-off turn privately but refuses it with the plain creator-only reason even for a project writer', async () => {
      await service.startForOneOff(req, 'linkedin-post', project, session);
      flows.linkedin.mockResolvedValue({ status: 'questions', questionsId, questions });
      const progress = await service.readProgress(req, project);
      expect(progress.runs[0]).not.toHaveProperty('pendingQuestions');
      expect(JSON.parse(stored().body).pendingQuestions).toMatchObject({ questionsId, questions });
      await expect(service.questionsForAnswers(req, project, hash(session), questionsId)).rejects.toMatchObject({
        statusCode: 403,
        message: 'Only the writer who started this run can answer it.',
      });
    });
  });

  it.each(['writing', 'questions', 'storing'] as const)('refuses another start while %s with safe conflict facts', async (state) => {
    await service.start(req, project, types[0].agentKey, session);
    stored().metadata['state'] = state;
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey)).rejects.toMatchObject({
      statusCode: 409,
      code: 'MKTG_RUN_ACTIVE',
      details: {
        activeRunId: hash(session),
        state,
        agentKey: types[0].agentKey,
        documentId: 'living',
        startedByViewer: true,
        startedAt: JSON.parse(stored().body).startedAt,
      },
    });
    expect(flows.interrupt).not.toHaveBeenCalled();
    expect(stored().metadata['state']).toBe(state);
  });

  it('allows a start with no active run, including failed and discarded records', async () => {
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey)).resolves.toBeUndefined();
    await service.start(req, project, types[0].agentKey, session);
    for (const state of ['failed', 'discarded', 'superseded']) {
      stored().metadata['state'] = state;
      await expect(service.assertSingleActiveRun(req, project, types[0].agentKey)).resolves.toBeUndefined();
    }
    expect(flows.interrupt).not.toHaveBeenCalled();
    expect(flows.author).not.toHaveBeenCalled();
  });

  it('discards exactly the confirmed run, interrupts it, hides it from progress, then records a new start', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await service.assertSingleActiveRun(req, project, types[0].agentKey, { discard: hash(session) });
    expect(stored().metadata['state']).toBe('discarded');
    expect(flows.interrupt).toHaveBeenCalledWith(req, session);
    expect(flows.events).not.toHaveBeenCalled();
    flows.get.mockClear();
    expect(await service.reconcile(req, project)).toEqual([]);
    expect(await service.readProgress(req, project)).toEqual({ runs: [] });
    expect(flows.get).not.toHaveBeenCalled();
    expect(flows.result).not.toHaveBeenCalled();
    await service.start(req, project, types[0].agentKey, 'replacement-session');
    expect(stored('replacement-session').metadata['state']).toBe('writing');
    expect(stored().metadata['state']).toBe('discarded');
  });

  it.each(['discarded', 'superseded'] as const)('returns %s closure only for a matching selected detail and keeps it out of listings', async (state) => {
    await service.start(req, project, types[0].agentKey, session);
    if (state === 'discarded') await service.assertSingleActiveRun(req, project, types[0].agentKey, { discard: hash(session) });
    else Object.assign(stored().metadata, { state, 'closed-at': new Date().toISOString() });
    expect(stored().metadata['state']).toBe(state);
    expect(stored().metadata['closed-at']).toBe(new Date().toISOString());
    flows.result.mockClear();
    flows.author.mockClear();
    const result = await service.detailWithProgress(req, project, types[0], 'living', null, { runs: [] }, false, undefined, hash(session));
    expect(result).toMatchObject({ revisions: [], runs: [{ runId: hash(session), state, closedAt: new Date().toISOString() }] });
    expect(await service.readProgress(req, project)).toEqual({ runs: [] });
    expect(flows.result).not.toHaveBeenCalled();
    expect(flows.author).not.toHaveBeenCalled();
    await expect(service.readClosedProgress(req, project, 'faq', 'other-document', hash(session))).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(service.readClosedProgress(req, project, types[0].agentKey, 'living', '../bad')).rejects.toBeInstanceOf(ServiceValidationError);
    delete stored().metadata['closed-at'];
    expect(await service.readClosedProgress(req, project, types[0].agentKey, 'living', hash(session))).not.toHaveProperty('closedAt');
  });

  it('settles an active comment redraft before closing its discarded run', async () => {
    await service.start(req, project, types[0].agentKey, session, 1, 'send-one');
    const context = { project, agentKey: types[0].agentKey, requestId: 'send-one' };
    redraft.forSession.mockResolvedValueOnce(context);
    await service.assertSingleActiveRun(req, project, types[0].agentKey, { discard: hash(session) });
    expect(redraft.settle).toHaveBeenCalledWith(req, context, { status: 'failed', failureText: 'This send was discarded.' });
    expect(redraft.settle.mock.invocationCallOrder[0]).toBeLessThan(flows.beforePut.mock.invocationCallOrder[0]);
    expect(stored().metadata['state']).toBe('discarded');
  });

  it('does not await an interrupt that never resolves', async () => {
    await service.start(req, project, types[0].agentKey, session);
    flows.interrupt.mockImplementationOnce(() => new Promise<void>(() => undefined));
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey, { discard: hash(session) })).resolves.toBeUndefined();
    expect(flows.interrupt).toHaveBeenCalledWith(req, session);
  });

  it.each([ServiceValidationError.forField('run', 'Synthetic invalid record'), new MicroserviceError('Synthetic transient read', 503, 'TEST')])(
    'isolates a failed record read and fails open (%s)',
    async (err) => {
      objects.set(key('unreadable'), { body: '{}', metadata: { state: 'writing' }, lastModified: new Date() });
      flows.get.mockImplementationOnce(() => {
        throw err;
      });
      await expect(service.assertSingleActiveRun(req, project, types[0].agentKey)).resolves.toBeUndefined();
      expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_run_start', 'Active-run check could not read a record; skipping it', {
        project,
        key: key('unreadable'),
        err,
      });
    }
  );

  it('bounds preflight reads and skips matching closed terminal-cache entries', async () => {
    for (let i = 0; i < 6; i++)
      objects.set(key(`cached-closed-${i}`), { body: '{}', metadata: { state: 'discarded' }, lastModified: new Date(Date.now() - 10_000) });
    flows.active = flows.max = 0;
    await service.assertSingleActiveRun(req, project, types[0].agentKey);
    expect(flows.max).toBeGreaterThan(1);
    expect(flows.max).toBeLessThanOrEqual(MKTG_STARTED_RUN_READ_CONCURRENCY);
    flows.head.mockClear();
    await service.assertSingleActiveRun(req, project, types[0].agentKey);
    expect(flows.head).not.toHaveBeenCalled();
    expect(flows.get).not.toHaveBeenCalled();
  });

  it('returns the concurrent open state when discard cannot close the selected record', async () => {
    await service.start(req, project, types[0].agentKey, session);
    redraft.forSession.mockImplementationOnce(async () => {
      Object.assign(stored().metadata, { state: 'questions', 'retry-at': '2026-10-19T12:00:00.001Z' });
      stored().body = JSON.stringify({ ...JSON.parse(stored().body), state: 'questions', retryAt: '2026-10-19T12:00:00.001Z' });
      return null;
    });
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey, { discard: hash(session) })).rejects.toMatchObject({
      statusCode: 409,
      details: { activeRunId: hash(session), state: 'questions', startedByViewer: true, startedAt: JSON.parse(stored().body).startedAt },
    });
    expect(flows.interrupt).not.toHaveBeenCalled();
  });

  it('refuses a stale discard without mutating or interrupting the current run', async () => {
    await service.start(req, project, types[0].agentKey, session);
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey, { discard: hash('stale-session') })).rejects.toMatchObject({
      statusCode: 409,
      details: { activeRunId: hash(session) },
    });
    expect(stored().metadata['state']).toBe('writing');
    expect(flows.interrupt).not.toHaveBeenCalled();
  });

  it.each(['../bad', '', 42, null, 'a'.repeat(63)])('rejects malformed discard %s before touching tracking', async (discard) => {
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey, { discard })).rejects.toMatchObject({ statusCode: 400 });
    expect(flows.head).not.toHaveBeenCalled();
  });

  it('matches one-off runs across document ids, but keeps agent/project boundaries', async () => {
    const oneOff = MKTG_DOCUMENT_TYPES.find((type) => type.kind === 'run' && type.agentKey === 'member-360');
    expect(oneOff).toBeDefined();
    if (!oneOff) return;
    await service.start(req, project, oneOff.agentKey, session);
    await expect(service.assertSingleActiveRun(req, project, oneOff.agentKey, { documentId: 'run-000000000000000000000000' })).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey)).resolves.toBeUndefined();
    await expect(service.assertSingleActiveRun(req, 'other-project', oneOff.agentKey)).resolves.toBeUndefined();
  });

  it('requires a separate confirmation for each legacy duplicate one-off run', async () => {
    await service.startForOneOff(req, 'member-360', project, session);
    await service.startForOneOff(req, 'member-360', project, 'legacy-other-session');
    await expect(service.assertSingleActiveOneOffRun(req, project, 'member-360', hash(session))).rejects.toMatchObject({
      statusCode: 409,
      details: { activeRunId: hash('legacy-other-session') },
    });
    expect(stored().metadata['state']).toBe('discarded');
    expect(stored('legacy-other-session').metadata['state']).toBe('writing');
    expect(flows.interrupt).toHaveBeenCalledTimes(1);
    await expect(service.assertSingleActiveOneOffRun(req, project, 'member-360', hash('legacy-other-session'))).resolves.toBeUndefined();
    expect(stored('legacy-other-session').metadata['state']).toBe('discarded');
  });

  it('keeps one-off slots private to their creator across project writers', async () => {
    const owner = Object.assign({} as Request, { oidc: { user: { sub: 'synthetic-owner' } } });
    const other = Object.assign({} as Request, { oidc: { user: { sub: 'synthetic-other' } } });
    await service.startForOneOff(owner, 'member-360', project, session);
    await expect(service.assertSingleActiveOneOffRun(other, project, 'member-360', hash(session))).resolves.toBeUndefined();
    expect(flows.author).not.toHaveBeenCalled();
    expect(flows.interrupt).not.toHaveBeenCalled();
    expect(stored().metadata['state']).toBe('writing');
    await expect(service.assertSingleActiveOneOffRun(owner, project, 'member-360')).rejects.toMatchObject({ statusCode: 409 });
    expect(flows.author).not.toHaveBeenCalled();
  });

  it.each(['Synthetic writer', null])('names the living-run creator only in the client response (%s)', async (name) => {
    flows.author.mockResolvedValue(name ? { name } : null);
    const owner = Object.assign({} as Request, { oidc: { user: { sub: 'synthetic-owner' } } });
    await service.start(owner, project, types[0].agentKey, session);
    const conflict = await service.assertSingleActiveRun(req, project, types[0].agentKey).catch((err: unknown) => err);
    expect(conflict).toBeInstanceOf(ConflictError);
    if (!(conflict instanceof ConflictError)) return;
    const startedBy = name ?? 'Another writer';
    expect(conflict.toResponse()).toMatchObject({ startedBy, startedByViewer: false, message: `${startedBy}'s ${types[0].itemLabel} run is in progress.` });
    expect(flows.author).toHaveBeenCalledWith(req, 'synthetic-owner', 'mktg_run_start');
    expect(conflict.message).not.toContain(startedBy);
  });

  it('uses Your for the viewer own living run without resolving the author', async () => {
    const viewer = Object.assign({} as Request, { oidc: { user: { sub: 'synthetic-viewer' } } });
    await service.start(viewer, project, types[0].agentKey, session);
    const conflict = await service.assertSingleActiveRun(viewer, project, types[0].agentKey).catch((err: unknown) => err);
    expect(conflict).toBeInstanceOf(ConflictError);
    if (!(conflict instanceof ConflictError)) return;
    expect(conflict.toResponse()).toMatchObject({ startedByViewer: true, message: `Your ${types[0].itemLabel} run is in progress.` });
    expect(flows.author).not.toHaveBeenCalled();
  });

  it('uses the caller-facing message for the caller own one-off conflict', async () => {
    await service.startForOneOff(req, 'member-360', project, session);
    const conflict = await service.assertSingleActiveOneOffRun(req, project, 'member-360').catch((err: unknown) => err);
    expect(conflict).toBeInstanceOf(ConflictError);
    if (!(conflict instanceof ConflictError)) return;
    expect(conflict.toResponse()).toMatchObject({ startedBy: 'Another writer', startedByViewer: true, message: 'Your Member 360 run is in progress.' });
  });

  it('refuses retry while the creator has another active one-off and retries when the slot clears', async () => {
    const actor = Object.assign({} as Request, { oidc: { user: { sub: 'synthetic-creator' } } });
    await service.startForOneOff(actor, 'member-360', project, session);
    stored().metadata['state'] = 'failed';
    const documentId = `run-${hash(session).slice(0, 24)}`;
    await service.startForOneOff(actor, 'member-360', project, 'active-session');
    await expect(service.retry(actor, project, 'member-360', documentId, hash(session))).rejects.toMatchObject({
      statusCode: 409,
      details: { activeRunId: hash('active-session') },
    });
    expect(stored().metadata['state']).toBe('failed');
    await service.assertSingleActiveOneOffRun(actor, project, 'member-360', hash('active-session'));
    await expect(service.retry(actor, project, 'member-360', documentId, hash(session))).resolves.toBeUndefined();
    expect(stored().metadata['state']).toBe('writing');
  });

  it.each([true, false])('checks the selected creator slot when another writer retries (active belongs to creator=%s)', async (creatorActive) => {
    const creator = Object.assign({} as Request, { oidc: { user: { sub: 'synthetic-creator-a' } } });
    const writer = Object.assign({} as Request, { oidc: { user: { sub: 'synthetic-writer-b' } } });
    await service.startForOneOff(creator, 'member-360', project, session);
    stored().metadata['state'] = 'failed';
    await service.startForOneOff(creatorActive ? creator : writer, 'member-360', project, 'other-active-session');
    const retry = service.retry(writer, project, 'member-360', `run-${hash(session).slice(0, 24)}`, hash(session));
    if (creatorActive) {
      await expect(retry).rejects.toMatchObject({ statusCode: 409, details: { activeRunId: hash('other-active-session') } });
      expect(stored().metadata['state']).toBe('failed');
    } else {
      await expect(retry).resolves.toBeUndefined();
      expect(stored().metadata['state']).toBe('writing');
      expect(JSON.parse(stored().body).creatorSubject).toBe('synthetic-creator-a');
    }
    expect(stored('other-active-session').metadata['state']).toBe('writing');
    expect(flows.interrupt).not.toHaveBeenCalled();
  });

  it('finds an active run beyond the navigation discovery window', async () => {
    await service.start(req, project, types[0].agentKey, session);
    for (let i = 0; i < 129; i++)
      objects.set(`document-runs/${project}/${hash(`closed-${i}`)}.json`, {
        body: '{}',
        metadata: { state: 'discarded' },
        lastModified: new Date(Date.now() + i + 1),
      });
    await expect(service.assertSingleActiveRun(req, project, types[0].agentKey)).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each(['linkedin-post', 'member-360'])('recovers %s from private tracking alone and validates its exact document destination', async (agent) => {
    const creator = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-creator' } } });
    const id = `run-${hash(session).slice(0, 24)}`;
    await service.startForOneOff(creator, agent, project, session, { answers: { share_link: 'https://post.example/' }, sourceWords: 32 });
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agent);
    expect(type).toBeDefined();
    const reader = new MktgDocumentRunService();
    const activity = [{ id: 'public-step', kind: 'checking', label: 'Checking the document', status: 'running' }];
    const result = agent === 'linkedin-post' ? flows.linkedin : flows.member;
    result.mockResolvedValue({ status: 'pending', activity });
    expect(await reader.readProgress(creator, project, agent, id)).toMatchObject({ runs: [{ documentId: id, state: 'writing', activity }] });
    const visitor = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-visitor' } } });
    const listing = await reader.readProgress(visitor, project);
    const document = await reader.readProgress(visitor, project, agent, id);
    for (const snapshot of [listing, document]) {
      expect(snapshot.runs[0]).not.toHaveProperty('activity');
      expect(JSON.stringify(snapshot)).not.toContain('public-step');
    }
    expect(flows.attribution).toHaveBeenCalledWith({ creatorSubject: 'synthetic-creator' }, ...(agent === 'linkedin-post' ? [true] : []));
    if (agent === 'linkedin-post') {
      expect(flows.linkedin).toHaveBeenCalledWith(creator, 'synthetic-creator', session, project, { share_link: 'https://post.example/' }, 32);
    }
    const receipt = { ...ready().persistence, document_location: { agent_key: agent, document_id: id, revision_id: location().revision_id } };
    result.mockResolvedValue({ status: 'ready', stored: true, persistence: receipt });
    expect(await reader.readProgress(req, project, agent, id)).toEqual({ runs: [] });
    expect(stored().metadata['state']).toBe('completed');
    const privateBody = JSON.parse(stored().body);
    expect(privateBody.documentId).toBe(id);
    privateBody.documentId = 'living';
    objects.set(key(), { ...stored(), body: JSON.stringify(privateBody), metadata: { ...stored().metadata, state: 'writing' } });
    expect((await reader.readProgress(req, project, agent, id)).runs).toEqual([]);
  });

  it('classifies a settled linkedin-post runtime failure on a Documents read before its writing deadline', async () => {
    const agent = 'linkedin-post';
    await service.startForOneOff(req, agent, project, session);
    const startedAt = new Date().toISOString();
    vi.advanceTimersByTime(61_000);
    flows.events.mockResolvedValue([JSON.stringify({ type: 'runtime_error', created_at: startedAt, content: { error: 'PRIVATE PROVIDER DETAILS' } })]);
    const visitor = { originalUrl: '/api/mktg-agents/documents/' + agent } as Request;
    const progress = await service.readProgress(visitor, project, agent);
    expect(progress.runs[0]).toMatchObject({ state: 'failed', failureText: MKTG_ONE_OFF_STOPPED_MESSAGE });
    expect(Date.now() - Date.parse(startedAt)).toBeLessThan(MKTG_RUN_POLL.timeoutMs);
    expect(JSON.stringify(progress)).not.toContain('PRIVATE PROVIDER DETAILS');
    expect(visitor.originalUrl).toBe('/api/mktg-agents/documents/' + agent);
  });

  it('keeps a member-360 run open past an aged runtime error without a Guild session end on a Documents read', async () => {
    const outcome = vi.spyOn(service['guild'], 'resolveRunOutcome');
    const agent = 'member-360';
    await service.startForOneOff(req, agent, project, session);
    const startedAt = new Date().toISOString();
    vi.advanceTimersByTime(61_000);
    flows.events.mockResolvedValue([JSON.stringify({ type: 'runtime_error', created_at: startedAt, content: { error: 'PRIVATE PROVIDER DETAILS' } })]);
    const visitor = { originalUrl: '/api/mktg-agents/documents/' + agent } as Request;
    const progress = await service.readProgress(visitor, project, agent);
    // Only a Guild session end fails Member 360 (member360TerminalResult); the settled-error overlay is not applied.
    expect(outcome).not.toHaveBeenCalled();
    expect(progress.runs[0]?.state).toBe('writing');
    expect(progress.runs[0]?.failureText).toBeUndefined();
    expect(JSON.stringify(progress)).not.toContain('PRIVATE PROVIDER DETAILS');
  });

  it('uses one completion policy for owned and Documents reads, retaining the record through completion', async () => {
    const creator = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-creator' } } });
    const context = { answers: { share_link: 'https://post.example/original' }, sourceWords: 32 };
    await service.startForOneOff(creator, 'linkedin-post', project, session, context);
    const documentId = `run-${hash(session).slice(0, 24)}`;
    flows.linkedin.mockResolvedValue({
      ...ready(),
      persistence: { ...ready().persistence, document_location: { ...location('linkedin-post'), document_id: documentId } },
    });
    flows.get.mockClear();
    const result = await service.ownedOneOffResult(creator, project, 'linkedin-post', session, {
      answers: { share_link: 'https://post.example/changed' },
      sourceWords: 1,
    });
    expect(result.status).toBe('ready');
    expect(flows.linkedin).toHaveBeenCalledExactlyOnceWith(creator, 'synthetic-creator', session, project, context.answers, 32);
    expect(flows.attribution).toHaveBeenLastCalledWith({ creatorSubject: 'synthetic-creator' }, true);
    // One context lookup, then mark's existing post-write winner confirmation; no duplicate pre-write record/result lookup.
    expect(flows.get.mock.calls).toEqual([[key()], [key()]]);
    expect(flows.get.mock.invocationCallOrder[1]).toBeGreaterThan(flows.beforePut.mock.invocationCallOrder[0]);
    expect(stored().metadata['state']).toBe('completed');
    const visitor = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-other' } } });
    await expect(service.ownedOneOffResult(visitor, project, 'linkedin-post', session, {})).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.ownedOneOffResult(creator, project, 'member-360', session, {})).rejects.toBeInstanceOf(AuthorizationError);
    flows.linkedin.mockResolvedValue({ status: 'pending' });
    await service.ownedOneOffResult(creator, project, 'linkedin-post', 'untracked-session', {});
    expect(flows.linkedin).toHaveBeenLastCalledWith(creator, 'synthetic-creator', 'untracked-session', project, undefined, undefined);
    await service.ownedOneOffResult(creator, 'other-project', 'linkedin-post', session, {});
    expect(flows.linkedin).toHaveBeenLastCalledWith(creator, 'synthetic-creator', session, 'other-project', undefined, undefined);
  });

  it.each(['service', 'provider', 'network'])('falls back on a transient %s read and logs no private body/error details', async (kind) => {
    const creator = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-creator' } } });
    await service.startForOneOff(creator, 'linkedin-post', project, session, { sourceWords: 99 });
    flows.get.mockImplementationOnce(() => {
      if (kind === 'service') throw new MicroserviceError('private provider message', 503, 'STORE_UNAVAILABLE');
      if (kind === 'provider') throw Object.assign(new Error('private provider message'), { $metadata: { httpStatusCode: 503 } });
      throw Object.assign(new Error('private provider message'), { code: 'ECONNRESET' });
    });
    const body = { answers: { share_link: 'https://post.example/fallback' }, sourceWords: 12 };
    expect(await service.ownedOneOffResult(creator, project, 'linkedin-post', session, body)).toMatchObject({ status: 'pending' });
    expect(flows.linkedin).toHaveBeenLastCalledWith(creator, 'synthetic-creator', session, project, body.answers, 12);
    expect(logger.warning).toHaveBeenCalledWith(creator, 'mktg_owned_run_read', expect.any(String), {
      project,
      status: kind === 'network' ? 0 : 503,
      code: kind === 'network' ? 'network' : 'http',
    });
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain('private provider message');
    flows.linkedin.mockClear();
    flows.get.mockImplementationOnce(() => {
      throw new AuthorizationError('No access');
    });
    await expect(service.ownedOneOffResult(creator, project, 'linkedin-post', session, body)).rejects.toBeInstanceOf(AuthorizationError);
    flows.get.mockImplementationOnce(() => {
      throw Object.assign(new Error('Non-transient synthetic permission failure'), { code: 'EACCES' });
    });
    await expect(service.ownedOneOffResult(creator, project, 'linkedin-post', session, body)).rejects.toMatchObject({ code: 'EACCES' });
    expect(flows.linkedin).not.toHaveBeenCalled();
  });

  it('retains the tracking-write error for operators without changing the successful result', async () => {
    const creator = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-creator' } } });
    await service.startForOneOff(creator, 'linkedin-post', project, session);
    const result = {
      ...ready(),
      persistence: { ...ready().persistence, document_location: { ...location('linkedin-post'), document_id: `run-${hash(session).slice(0, 24)}` } },
    };
    flows.linkedin.mockResolvedValue(result);
    const err = new MicroserviceError('Synthetic metadata write failed', 503, 'STORE_UNAVAILABLE');
    flows.beforePut.mockRejectedValueOnce(err);
    expect(await service.ownedOneOffResult(creator, project, 'linkedin-post', session, {})).toBe(result);
    expect(logger.warning).toHaveBeenCalledWith(creator, 'mktg_run_record_result', expect.any(String), { project, err });
  });

  it('records a LinkedIn root refusal with its text on the next authorized creator read, without spending the writing deadline', async () => {
    const creator = Object.assign({}, req, { oidc: { user: { sub: 'synthetic-creator' } } });
    await service.startForOneOff(creator, 'linkedin-post', project, session);
    const text = 'The synthetic request form could not be read. Open the intake form to try again.';
    flows.linkedin.mockResolvedValue({ status: 'failed', failureText: text, activity: [] });
    const progress = await service.readProgress(creator, project, 'linkedin-post');
    expect(progress.runs[0]).toMatchObject({ state: 'failed', failureText: text });
    expect(stored().metadata['state']).toBe('failed');
    expect(Buffer.from(stored().metadata['failure-text'], 'base64').toString()).toBe(text);
    expect(Date.now() - Date.parse(progress.runs[0].startedAt)).toBe(0);
    const reads = flows.linkedin.mock.calls.length;
    await new MktgDocumentRunService().readProgress(creator, project, 'linkedin-post');
    expect(flows.linkedin).toHaveBeenCalledTimes(reads);
  });

  it.each(['creator-first', 'visitor-first'])('keeps LinkedIn refusal prose creator-only across stable terminal reads and refresh: %s', async (order) => {
    const creator = Object.assign({}, req, { oidc: { user: { sub: 'synthetic-creator' } } });
    const visitor = Object.assign({}, req, { oidc: { user: { sub: 'synthetic-visitor' } } });
    await service.startForOneOff(creator, 'linkedin-post', project, session);
    const text = 'SYNTHETIC private profile and source reply';
    flows.linkedin.mockResolvedValue({ status: 'failed', failureText: text });
    vi.advanceTimersByTime(3000);
    await service.readProgress(order === 'creator-first' ? creator : visitor, project, 'linkedin-post');
    vi.advanceTimersByTime(3000); // Exercise the shared terminal-cache stability window.
    for (const reader of [creator, visitor, creator, visitor]) {
      const expected = reader === creator ? text : MKTG_ONE_OFF_STOPPED_MESSAGE;
      expect((await service.readProgress(reader, project, 'linkedin-post')).runs[0]?.failureText).toBe(expected);
    }
    const documentId = `run-${hash(session).slice(0, 24)}`;
    expect((await service.refreshFailure(visitor, project, 'linkedin-post', documentId, hash(session)))?.failureText).toBe(MKTG_ONE_OFF_STOPPED_MESSAGE);
    expect((await service.refreshFailure(creator, project, 'linkedin-post', documentId, hash(session)))?.failureText).toBe(text);
    expect(Buffer.from(stored().metadata['failure-text'], 'base64').toString()).toBe(text); // Stored privately, not projected to visitors.
  });

  it.each(['recordResult', 'Documents reconciliation'] as const)(
    'preserves a settled ICP provider failure through %s with the real dispatcher',
    async (path) => {
      await service.startForCatalogAgent(req, 'icp', project, session);
      const startedAt = new Date().toISOString();
      vi.advanceTimersByTime(61_000);
      flows.events.mockResolvedValue([JSON.stringify({ type: 'runtime_error', created_at: startedAt, content: { error: 'PRIVATE PROVIDER DETAILS' } })]);
      const visitor = Object.assign({}, req, { originalUrl: '/api/mktg-agents/documents/icp/living' });
      if (path === 'recordResult') await service.recordResult(visitor, session, { status: 'failed' }, project);
      const progress = await new MktgDocumentRunService().readProgress(visitor, project, 'icp', 'living');
      expect(flows.result).toHaveBeenCalled();
      expect(flows.events).toHaveBeenCalled();
      expect(stored().metadata['state']).toBe('failed');
      expect(progress.runs[0]).toMatchObject({ state: 'failed', failureText: MKTG_RUN_FAILURE_REASON });
      expect(JSON.stringify(progress)).not.toContain('PRIVATE PROVIDER DETAILS');
      expect(progress.runs[0]).not.toHaveProperty('persistenceFailed');
      expect(visitor.originalUrl).toBe('/api/mktg-agents/documents/icp/living');
    }
  );

  it('keeps independent one-off sessions and pauses Member needs-input without exposing question text', async () => {
    await service.startForOneOff(req, 'member-360', project, session);
    await service.startForOneOff(req, 'member-360', project, 'second-session');
    flows.member.mockResolvedValue({ status: 'needs_input', message: 'private question text', activity: [] });
    const progress = await service.readProgress(req, project, 'member-360');
    expect(progress.runs).toHaveLength(2);
    expect(progress.runs.every((run) => run.state === 'questions')).toBe(true);
    expect(JSON.stringify(progress)).not.toContain('private question text');
    expect(JSON.stringify(progress)).not.toContain('sessionId');
    expect(JSON.stringify(progress)).not.toContain('creatorSubject');
    expect(stored().metadata['state']).toBe('questions');
    flows.member.mockResolvedValue({ status: 'pending' });
    expect((await new MktgDocumentRunService().readProgress(req, project, 'member-360')).runs.every((run) => run.state === 'questions')).toBe(true);
    expect(flows.member).toHaveBeenCalledTimes(4);
  });

  it.each([MKTG_RUN_POLL.timeoutMs + 1, 2 * 60 * 60 * 1000 + 1])(
    'keeps Member needs-input paused after %i ms without a failure or clock-driven write',
    async (elapsed) => {
      await service.startForOneOff(req, 'member-360', project, session);
      flows.member.mockResolvedValue({ status: 'needs_input', message: 'private question text', activity: [] });
      expect((await service.readProgress(req, project)).runs[0]?.state).toBe('questions');
      flows.beforePut.mockClear();
      vi.advanceTimersByTime(elapsed);
      const paused = await new MktgDocumentRunService().readProgress(req, project);
      expect(paused.runs[0]).toMatchObject({ state: 'questions' });
      expect(paused.runs[0]?.failureText).toBeUndefined();
      expect(stored().metadata['state']).toBe('questions');
      expect(stored().metadata['failure-text']).toBeUndefined();
      expect(JSON.stringify(paused)).not.toContain('private question text');
      expect(flows.beforePut).not.toHaveBeenCalled();
      expect(flows.member).toHaveBeenCalledTimes(2);
      expect(flows.events).not.toHaveBeenCalled(); // Member 360 skips the settled-error overlay, so no raw-event read happens here.
    }
  );

  it.each([MKTG_RUN_POLL.timeoutMs + 1, 2 * 60 * 60 * 1000 + 1])('keeps Member writing after %i ms without a clock-driven failure', async (elapsed) => {
    await service.startForOneOff(req, 'member-360', project, session);
    flows.beforePut.mockClear();
    vi.advanceTimersByTime(elapsed);
    const progress = await new MktgDocumentRunService().readProgress(req, project);
    expect(progress.runs[0]).toMatchObject({ state: 'writing' });
    expect(progress.runs[0]?.failureText).toBeUndefined();
    expect(stored().metadata['state']).toBe('writing');
    expect(flows.beforePut).not.toHaveBeenCalled();
    expect(flows.member).toHaveBeenCalledOnce();
  });

  it('leaves Member writing readable on a plain open after the automatic poll window stops', async () => {
    await service.startForOneOff(req, 'member-360', project, session);
    flows.beforePut.mockClear();
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
    const stopped = await service.readProgress(req, project, 'member-360', undefined, true);
    expect(stopped.runs[0]?.state).toBe('writing');
    expect(stopped.progressUnavailable).toBe(true);
    expect(flows.member).not.toHaveBeenCalled();
    expect(flows.beforePut).not.toHaveBeenCalled();
    expect((await new MktgDocumentRunService().readProgress(req, project, 'member-360')).runs[0]?.state).toBe('writing');
    expect(flows.member).toHaveBeenCalledOnce();
  });

  it.each(['writing', 'questions'])('fails Member %s only when its adapter reports a session end, even after two hours', async (state) => {
    await service.startForOneOff(req, 'member-360', project, session);
    if (state === 'questions') {
      flows.member.mockResolvedValue({ status: 'needs_input', activity: [] });
      await service.readProgress(req, project);
    }
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
    flows.member.mockResolvedValue({ status: 'failed', reason: 'agent_stopped', message: 'The agent stopped before producing a result.' });
    const progress = await service.readProgress(req, project);
    expect(progress.runs[0]).toMatchObject({ state: 'failed', failureReason: 'agent_stopped', failureText: 'The agent stopped before producing a result.' });
    expect(stored().metadata['state']).toBe('failed');
  });

  it('retains the ten-minute writing deadline for a non-Member one-off and its creator-visible reason', async () => {
    const creator = Object.assign({}, req, { oidc: { user: { sub: 'synthetic-creator' } } });
    await service.startForOneOff(creator, 'linkedin-post', project, session);
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + 1);
    expect((await service.readProgress(creator, project, 'linkedin-post')).runs[0]).toMatchObject({
      state: 'failed',
      failureText: 'The run did not finish before its writing deadline.',
    });
  });

  it('preserves supported LinkedIn questions beyond the writing deadline', async () => {
    await service.startForOneOff(req, 'linkedin-post', project, session);
    flows.linkedin.mockResolvedValue({ status: 'questions', questionsId: 'a'.repeat(64) });
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + 1);
    const paused = await service.readProgress(req, project);
    expect(paused.runs[0]).toMatchObject({ state: 'questions' });
  });

  it('retains Member failure classification with the redacted details across process-local cache loss', async () => {
    await service.startForOneOff(req, 'member-360', project, session);
    flows.member.mockResolvedValue({ status: 'failed', reason: 'no_edit_access', message: 'Synthetic entitled-project refusal.' });
    const progress = await service.readProgress(req, project);
    expect(progress.runs[0]).toMatchObject({ state: 'failed', failureReason: 'no_edit_access', failureText: 'Synthetic entitled-project refusal.' });
    expect(stored().metadata['failure-reason']).toBe('no_edit_access');
    const reread = await new MktgDocumentRunService().readProgress(req, project);
    expect(reread.runs[0]).toMatchObject({ failureReason: 'no_edit_access' });
  });

  it('ignores failure reason codes outside the dedicated allow-list on writes and legacy metadata reads', async () => {
    await service.startForOneOff(req, 'member-360', project, session);
    flows.member.mockResolvedValue({ status: 'failed', reason: 'unknown_code', message: 'Synthetic refusal.' });
    expect((await service.readProgress(req, project)).runs[0]).not.toHaveProperty('failureReason');
    expect(stored().metadata).not.toHaveProperty('failure-reason');
    stored().metadata['failure-reason'] = 'constructor';
    expect((await new MktgDocumentRunService().readProgress(req, project)).runs[0]).not.toHaveProperty('failureReason');
  });

  it('renews LinkedIn after answers ACK, and ignores the already-answered questions block', async () => {
    await service.startForOneOff(req, 'linkedin-post', project, session);
    const questionsId = 'a'.repeat(64);
    flows.linkedin.mockResolvedValue({ status: 'questions', questionsId });
    expect((await service.readProgress(req, project)).runs[0]?.state).toBe('questions');
    await service.resumeAfterQuestions(req, project, session, questionsId);
    expect((await service.readProgress(req, project)).runs[0]?.state).toBe('writing');
    flows.linkedin.mockResolvedValue({ status: 'questions', questionsId: 'b'.repeat(64) });
    expect((await service.readProgress(req, project)).runs[0]?.state).toBe('questions');
  });

  it('does not attribute or initialize a LinkedIn profile as the visiting reader when the creator is unknown', async () => {
    await service.startForOneOff(req, 'linkedin-post', project, session);
    await new MktgDocumentRunService().readProgress(req, project);
    expect(flows.linkedin).toHaveBeenCalledWith(req, '', session, project, undefined, undefined);
    expect(flows.attribution).toHaveBeenCalledWith({ creatorSubject: null }, false);
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

  it.each(['failed', 'storing'] as const)('fences a stale %s transition so it cannot replace a completed record', async (state) => {
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
    await service.recordResult(req, session, ready(), project);
    const completed = stored();
    expect(JSON.parse(completed.body).state).toBe('completed');
    expect(completed.metadata).toMatchObject({ state: 'completed', 'revision-id': location().revision_id });
    release();
    await failure;
    expect(stored().body).toBe(completed.body);
    expect(stored().metadata).toEqual(completed.metadata);
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
    expect((await service.readProgress(req, project, agent)).runs[0]).toMatchObject({ state: 'failed', persistenceFailed: true });
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
      const closedAt = Date.parse(stored().metadata['closed-at']);
      expect(closedAt).toBeGreaterThanOrEqual(Date.parse(stored('synthetic-second-session').metadata['started-at']));
      expect(closedAt).toBeLessThanOrEqual(Date.now());
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

  it('keeps one-off completion context and redraft revision identity in distinct start options', async () => {
    const oneOff = { answers: { share_link: 'https://post.example/options' }, sourceWords: 24 };
    const start = vi.spyOn(service, 'start');
    await service.startForOneOff(req, 'linkedin-post', project, 'oneoff-options-session', oneOff);
    expect(start).toHaveBeenLastCalledWith(req, project, 'linkedin-post', 'oneoff-options-session', 0, 'initial', { oneOff });
    const basedOnId = location().revision_id;
    await service.start(req, project, types[0].agentKey, 'redraft-options-session', 1, 'redraft-options', { basedOnId });
    expect(JSON.parse(stored('oneoff-options-session').body).oneOff).toMatchObject(oneOff);
    expect(stored('oneoff-options-session').metadata['prior-revision-id']).toBeUndefined();
    expect(JSON.parse(stored('redraft-options-session').body).oneOff).toBeUndefined();
    expect(stored('redraft-options-session').metadata['prior-revision-id']).toBe(basedOnId);
    start.mockRestore();
  });

  it('does not treat the selected base receipt as completion of a fresh redraft', async () => {
    const agent = types[0].agentKey;
    await service.start(req, project, agent, session, 1, 'send-one', { basedOnId: location(agent).revision_id });
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
    const completedBody = stored().body;
    expect(JSON.parse(completedBody).startedAt).toBe(JSON.parse(body).startedAt);
    vi.advanceTimersByTime(120_000);
    await service.start(req, project, type.agentKey, session, 0, 'renewed-turn');
    expect(stored().body).toBe(completedBody);
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
