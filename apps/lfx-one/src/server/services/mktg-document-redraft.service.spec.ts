// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { MktgDocumentCommentsRecord, MktgRunResultResponse, ObjectStorePutInput } from '@lfx-one/shared/interfaces';
import { MKTG_DOCUMENT_COMMENTS_SCHEMA } from '@lfx-one/shared/constants';
import { guardFoundationMessageText } from '@lfx-one/shared/utils/foundation-message.utils';
import type { MktgDocumentRunService } from './mktg-document-run.service';
import { MKTG_DOCUMENT_TYPES, MKTG_KIT_FRAMEWORK_KEY } from '@lfx-one/shared/constants';
import { redraftContextFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-redraft-context.fixture';
const f = vi.hoisted(() => ({
  reserve: vi.fn(),
  bind: vi.fn(),
  guild: vi.fn(),
  configured: vi.fn(),
  prepare: vi.fn(),
  view: vi.fn(),
  remember: vi.fn(),
  context: vi.fn(),
  known: vi.fn(),
  scope: vi.fn(),
  create: vi.fn(),
  subject: vi.fn(),
  start: vi.fn(),
  fresh: true,
  state: 'reserved',
  hash: null as string | null,
  records: new Map<string, { body: string; etag: string; metadata: Record<string, string> }>(),
  end: vi.fn(),
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-redraft.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-comments.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public async getObject(_req: unknown, _purpose: string, key: string) {
      return f.records.get(key) ?? null;
    }
    public async putConditionalObject(_req: unknown, _purpose: string, key: string, input: ObjectStorePutInput) {
      const old = f.records.get(key);
      if (input.ifNoneMatch ? !!old : old?.etag !== input.ifMatch) return false;
      f.records.set(key, { body: Buffer.from(input.body).toString('utf8'), metadata: {}, etag: `${old?.etag ?? ''}-next` });
      return true;
    }
  },
}));
vi.mock('./guild.service', () => ({
  GuildService: class {
    public createSession = f.guild;
    public preflight = f.configured;
  },
}));
vi.mock('./mktg-document-comments.service', () => ({
  MktgDocumentCommentsService: class {
    public reserve = f.reserve;
    public bindRun = f.bind;
    public endStart = f.end;
    public failedRequest() {
      return new ConflictError('Recorded send failure', 'MKTG_REDRAFT_REQUEST_FAILED');
    }
  },
}));
vi.mock('./mktg-document-author.service', () => ({
  MktgDocumentAuthorService: class {
    public captureAuthorId = f.subject;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public getRevision = f.view;
    public rememberGenerationFramework = f.remember;
  },
}));
vi.mock('./mktg-document-redraft-input.service', () => ({
  MktgDocumentRedraftInputService: class {
    public prepare = f.prepare;
  },
}));
vi.mock('./mktg-document-redraft-context.service', () => ({
  MktgDocumentRedraftContextService: class {
    public create = f.create;
    public forSession = f.context;
    public assertScope = f.scope;
    public static runId() {
      return 'c'.repeat(64);
    }
  },
}));
vi.mock('../utils/mktg-session-token.util', () => ({ createSessionOwnerToken: (creator: string) => `synthetic-capability-${creator}` }));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn() } }));
import { MktgDocumentRedraftService } from './mktg-document-redraft.service';
import { AuthorizationError, ConflictError, MicroserviceError, ServiceValidationError } from '../errors';
import { logger } from './logger.service';
const req = {} as Request;
const context = redraftContextFixture();
const type = MKTG_DOCUMENT_TYPES.find((row) => row.agentKey === MKTG_KIT_FRAMEWORK_KEY);
if (!type) throw new Error('Missing registered synthetic target');
const body = { project: context.project, revisionId: context.basedOnId, commentIds: context.comments.map((row) => row.id), clientRequestId: context.requestId };
const runs = { knownRedraftSession: f.known, start: f.start } as unknown as MktgDocumentRunService;
const send = () => new MktgDocumentRedraftService().send(req, context.project, type, 'living', body, runs);
describe('reserved redraft delivery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    f.fresh = true;
    f.state = 'reserved';
    f.hash = null;
    f.records.clear();
    f.bind.mockImplementation(async (_req, _project, _type, _doc, _id, hash: string, started = false) => {
      f.hash = hash;
      if (started) f.state = 'started';
    });
    f.end.mockImplementation(async (_req, _project, _type, _doc, _id, uncertain: boolean) => {
      f.state = uncertain ? 'uncertain' : 'failed';
    });
    f.subject.mockReturnValue('opaque-creator');
    f.view.mockResolvedValue({ revision: { id: context.basedOnId } });
    f.prepare.mockResolvedValue({ context, message: 'synthetic canonical form', framework: null });
    f.guild.mockResolvedValue('synthetic-session');
    f.context.mockResolvedValue(context);
    f.reserve.mockImplementation(async (_req, _project, _type, _document, _raw, preflight) => {
      const fresh = f.fresh;
      f.fresh = false;
      if (fresh) await preflight(context.comments);
      return { fresh, comments: context.comments, submission: { runId: f.hash, state: f.state, createdAt: new Date().toISOString() } };
    });
  });
  it('reserves first, ACKs the authoritative sidecar version, then only replays the creator ACK', async () => {
    f.view.mockResolvedValue({ revision: { id: context.basedOnId, draftVersion: 1 } });
    const first = await send();
    expect(first.priorVersion).toBe(context.priorVersion);
    expect(first.priorVersion).not.toBe(1);
    expect(first.ownerToken).toBe('synthetic-capability-opaque-creator');
    expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.guild.mock.invocationCallOrder[0]);
    expect(f.create.mock.invocationCallOrder[0]).toBeLessThan(f.start.mock.invocationCallOrder[0]);
    f.known.mockResolvedValue('synthetic-session');
    const replay = await send();
    expect(replay.sessionId).toBe(first.sessionId);
    expect(replay.priorVersion).toBe(context.priorVersion);
    expect(f.guild).toHaveBeenCalledTimes(1);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.start).toHaveBeenLastCalledWith(
      req,
      context.project,
      type.agentKey,
      'synthetic-session',
      context.priorVersion,
      context.requestId,
      context.basedOnId
    );
  });
  it.each([400, 401, 409, 501])('records definitive Guild %s failure and replays that failure without another SDK call', async (status) => {
    const error = MicroserviceError.fromMicroserviceResponse(status, 'Synthetic rejection', {}, 'guild', '/synthetic', 'guild_create_session');
    f.guild.mockRejectedValueOnce(error);
    await expect(send()).rejects.toBe(error);
    expect(f.end).toHaveBeenCalledWith(req, context.project, type, 'living', context.requestId, false);
    await expect(send()).rejects.toMatchObject({ code: 'MKTG_REDRAFT_REQUEST_FAILED' });
    expect(f.guild).toHaveBeenCalledTimes(1);
    expect(logger.warning).toHaveBeenCalledWith(req, 'mktg_document_redraft', expect.any(String), expect.objectContaining({ err: error }));
  });
  it.each([false, true])('keeps an unusable successful ACK uncertain (SDK rejection=%s)', async (sdkRejection) => {
    if (sdkRejection) f.guild.mockRejectedValueOnce(new MicroserviceError('Synthetic unusable ACK', 502, 'guild_invalid_response'));
    else f.guild.mockResolvedValueOnce('');
    await expect(send()).rejects.toMatchObject({ code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(f.state).toBe('uncertain');
    f.fresh = true;
    f.state = 'reserved';
    const error = new ConflictError('Synthetic context conflict', 'SYNTHETIC_CONTEXT_CONFLICT');
    f.create.mockRejectedValueOnce(error);
    await expect(send()).rejects.toMatchObject({ statusCode: 503, code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(f.state).toBe('uncertain');
  });
  it.each(['create', 'start', 'bind'] as const)('keeps a real ledger uncertain after a session and %s validation/conflict failures', async (stage) => {
    const { MktgDocumentCommentsService } = await vi.importActual<typeof import('./mktg-document-comments.service')>('./mktg-document-comments.service');
    for (const error of [
      new ConflictError('Synthetic conflict', 'MKTG_REDRAFT_CONTEXT_CONFLICT'),
      ServiceValidationError.forField('context', 'Synthetic validation'),
    ]) {
      f.records.clear();
      const ledger = new MktgDocumentCommentsService();
      const key = `document-comments/${context.project}/${context.agentKey}/living.json`;
      const initial: MktgDocumentCommentsRecord = {
        schema: MKTG_DOCUMENT_COMMENTS_SCHEMA,
        project: context.project,
        agentKey: context.agentKey,
        documentId: 'living',
        submissions: [],
        threads: context.comments.map((row) => ({
          ...row,
          clientRequestId: 'comment-one',
          authorId: 'opaque-creator',
          revisionId: context.basedOnId,
          status: 'open',
          sentInRun: null,
          resultRevisionId: null,
          resolution: null,
        })),
      };
      f.records.set(key, { body: JSON.stringify(initial), metadata: {}, etag: 'seed' });
      f.view.mockResolvedValue({
        revision: { id: context.basedOnId, format: 'json' },
        markdown: JSON.stringify({ mf: { tagline: 'Stored line' } }),
        sidecar: null,
      });
      f.reserve.mockImplementation(ledger.reserve.bind(ledger));
      f.bind.mockImplementation(ledger.bindRun.bind(ledger));
      f.end.mockImplementation(ledger.endStart.bind(ledger));
      f[stage].mockRejectedValueOnce(error);
      await expect(send()).rejects.toMatchObject({ statusCode: 503, code: 'MKTG_REDRAFT_START_UNCERTAIN' });
      const stored = JSON.parse(f.records.get(key)?.body ?? '{}') as MktgDocumentCommentsRecord;
      expect(stored.submissions[0].state).toBe('uncertain');
      expect(stored.threads.every((row) => row.status === 'sent')).toBe(true);
      await ledger.release(req, context.project, type, 'living', context.requestId);
      const released = JSON.parse(f.records.get(key)?.body ?? '{}') as MktgDocumentCommentsRecord;
      expect(released.threads.every((row) => row.status === 'open')).toBe(true);
    }
    expect(f.guild).toHaveBeenCalledTimes(2);
  });
  it.each(['context', 'scope', 'start', 'bind'] as const)('keeps confirmed starts on replay %s failure without another Guild call', async (stage) => {
    await send();
    f.known.mockResolvedValue('synthetic-session');
    const error = stage === 'scope' ? new AuthorizationError('Synthetic scope') : ServiceValidationError.forField('context', 'Synthetic rejection');
    if (stage === 'scope')
      f.scope.mockImplementationOnce(() => {
        throw error;
      });
    else f[stage].mockRejectedValueOnce(error);
    await expect(send()).rejects.toMatchObject({ statusCode: 503, code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(f.state).toBe('started');
    expect(f.end).not.toHaveBeenCalled();
    expect(f.guild).toHaveBeenCalledTimes(1);
  });
  it('never leaks a cleanup4xx after a session as a definitive primary rejection', async () => {
    f.create.mockRejectedValueOnce(ServiceValidationError.forField('context', 'Synthetic invalid context'));
    f.end.mockRejectedValueOnce(new AuthorizationError('Synthetic ledger outage'));
    await expect(send()).rejects.toMatchObject({ statusCode: 503, code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'mktg_document_redraft',
      'Could not record redraft uncertainty',
      expect.objectContaining({ err: expect.any(AuthorizationError) })
    );
  });

  it('fails post-reservation validation before any session request without making it uncertain', async () => {
    f.prepare.mockResolvedValueOnce(undefined);
    await expect(send()).rejects.toBeInstanceOf(ServiceValidationError);
    expect(f.guild).not.toHaveBeenCalled();
    expect(f.state).toBe('failed');
  });

  it.each([408, 429, 500, 502, 503, 504])('keeps HTTP %s uncertain rather than reopening a possibly accepted start', async (status) => {
    const error = MicroserviceError.fromMicroserviceResponse(status, 'Synthetic gateway failure', {}, 'guild', '/synthetic', 'guild_create_session');
    f.guild.mockRejectedValueOnce(error);
    await expect(send()).rejects.toMatchObject({ code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(f.state).toBe('uncertain');
    expect(f.end).toHaveBeenLastCalledWith(req, context.project, type, 'living', context.requestId, true);
  });
  it.each(['ready', 'failed'] as const)('interleaves a live same-ID replay, then binds and really settles every thread on %s', async (status) => {
    const { MktgDocumentCommentsService } = await vi.importActual<typeof import('./mktg-document-comments.service')>('./mktg-document-comments.service');
    const ledger = new MktgDocumentCommentsService();
    const initial: MktgDocumentCommentsRecord = {
      schema: MKTG_DOCUMENT_COMMENTS_SCHEMA,
      project: context.project,
      agentKey: context.agentKey,
      documentId: 'living',
      submissions: [],
      threads: context.comments.map((row) => ({
        ...row,
        clientRequestId: 'comment-one',
        authorId: 'opaque-creator',
        revisionId: context.basedOnId,
        status: 'open',
        sentInRun: null,
        resultRevisionId: null,
        resolution: null,
      })),
    };
    const key = `document-comments/${context.project}/${context.agentKey}/living.json`;
    f.records.set(key, { body: JSON.stringify(initial), metadata: {}, etag: 'seed' });
    const record = () => JSON.parse(f.records.get(key)?.body ?? '{}') as MktgDocumentCommentsRecord;
    f.view.mockResolvedValue({
      revision: { id: context.basedOnId, format: 'json' },
      markdown: JSON.stringify({ mf: { tagline: 'Stored line' } }),
      sidecar: null,
    });
    f.reserve.mockImplementation(ledger.reserve.bind(ledger));
    f.bind.mockImplementation(ledger.bindRun.bind(ledger));
    f.end.mockImplementation(ledger.endStart.bind(ledger));
    let finish: ((value: string) => void) | undefined;
    f.guild.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finish = resolve;
      })
    );
    const original = send();
    await vi.waitFor(() => expect(f.guild).toHaveBeenCalledTimes(1));
    await expect(send()).rejects.toMatchObject({ code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(record().submissions[0]).toMatchObject({ state: 'reserved', runId: null });
    expect(record().threads[0]).toMatchObject({ status: 'open', sentInRun: null });
    expect(f.end).not.toHaveBeenCalled();
    expect(f.known).not.toHaveBeenCalled();
    expect(f.bind).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    await expect(ledger.release(req, context.project, type, 'living', context.requestId)).rejects.toMatchObject({ code: 'MKTG_REDRAFT_COMMENTS_BUSY' });
    if (!finish) throw new Error('Missing synthetic resolver');
    finish('synthetic-session');
    await original;
    expect(record().threads.every((row) => row.status === 'sent' && row.sentInRun === context.runId)).toBe(true);
    const revisionId = `000003-${'d'.repeat(64)}`;
    const sidecar = {
      mode: 'redraft',
      version: 3,
      project_name: context.projectName,
      revision: {
        mode: 'redraft',
        prior_version: 2,
        comments: context.comments.map((row, index) => ({
          number: index + 1,
          field: row.anchor.key,
          comment: guardFoundationMessageText(row.text),
          resolution: 'Resolved.',
        })),
      },
    };
    f.view.mockResolvedValue({ revision: { id: revisionId, format: 'json' }, markdown: '{}', sidecar });
    const persistence = {
      project: context.project,
      version: 3,
      s3_key: 'synthetic-result',
      content_sha256: 'd'.repeat(64),
      document_location: { agent_key: context.agentKey, document_id: 'living', revision_id: revisionId },
    };
    const result: MktgRunResultResponse = status === 'ready' ? { status, persistence } : { status, failureText: 'Conclusive synthetic failure' };
    await ledger.settle(req, context, result);
    expect(record().submissions[0].state).toBe(status === 'ready' ? 'completed' : 'failed');
    expect(record().threads.every((row) => row.status === (status === 'ready' ? 'resolved' : 'open'))).toBe(true);
    expect(f.guild).toHaveBeenCalledTimes(1);
  });

  it('never creates again after an uncertain external POST or missing durable private session', async () => {
    f.guild.mockRejectedValueOnce(new Error('Synthetic transport uncertainty'));
    await expect(send()).rejects.toMatchObject({ code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    f.known.mockResolvedValue(null);
    await expect(send()).rejects.toMatchObject({ code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(f.guild).toHaveBeenCalledTimes(1);
    expect(f.start).not.toHaveBeenCalled();
  });
  it('publishes no run when descriptor storage fails and never regenerates on replay', async () => {
    f.create.mockRejectedValueOnce(new Error('Synthetic storage failure'));
    await expect(send()).rejects.toMatchObject({ code: 'MKTG_REDRAFT_START_UNCERTAIN' });
    expect(f.start).not.toHaveBeenCalled();
    f.known.mockResolvedValue(null);
    await expect(send()).rejects.toThrow();
    expect(f.guild).toHaveBeenCalledTimes(1);
  });
  it('rejects foreign creator/input conflicts and invalid body without a session or capability', async () => {
    f.reserve.mockRejectedValueOnce(new Error('Synthetic creator conflict'));
    await expect(send()).rejects.toThrow('Synthetic creator conflict');
    expect(f.guild).not.toHaveBeenCalled();
    await expect(new MktgDocumentRedraftService().send(req, context.project, type, 'living', { ...body, previous: {} }, runs)).rejects.toThrow();
    expect(f.guild).not.toHaveBeenCalled();
  });
});
