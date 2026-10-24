// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { MktgAddDocumentCommentRequest, MktgDocumentCommentsRecord, MktgDocumentType, ObjectStorePutInput } from '@lfx-one/shared/interfaces';
const flows = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  revision: vi.fn(),
  user: vi.fn(),
  subject: vi.fn(),
  impersonating: vi.fn(),
  document: vi.fn(),
  history: vi.fn(),
}));
const objects = vi.hoisted(() => new Map<string, { body: string; etag: string; metadata: Record<string, string> }>());
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-comments.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-redraft.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-comments.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-redraft.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = flows.get;
    public putConditionalObject = flows.put;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public getRevision = flows.revision;
    public redraftForRevision = flows.history;
    public constructor(generationAttribution: unknown, authors: unknown) {
      flows.document(generationAttribution, authors);
    }
  },
}));
vi.mock('./user.service', () => ({
  UserService: class {
    public getUserInfo = flows.user;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: flows.subject, isImpersonating: flows.impersonating }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warning: vi.fn() } }));
import { MktgDocumentCommentsService } from './mktg-document-comments.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import { redraftContextFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-redraft-context.fixture';
import { guardFoundationMessageText } from '@lfx-one/shared/utils/foundation-message.utils';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  MicroserviceError,
  PreconditionFailedError,
  ResourceNotFoundError,
  ServiceValidationError,
} from '../errors';
import { logger } from './logger.service';

const req = {} as Request;
const project = 'project-one';
const revisionId = `000001-${'a'.repeat(64)}`;
const resultId = `000002-${'b'.repeat(64)}`;
const type = { agentKey: 'foundation-message', kind: 'living' } as MktgDocumentType;
const key = `document-comments/${project}/foundation-message/living.json`;
function request(overrides: Partial<MktgAddDocumentCommentRequest> = {}): MktgAddDocumentCommentRequest {
  return {
    project,
    revisionId,
    anchor: { kind: 'field', key: 'mf.tagline' },
    text: '  Shorten this synthetic line.  ',
    clientRequestId: 'request-one',
    ...overrides,
  };
}
function record(): MktgDocumentCommentsRecord {
  return JSON.parse(objects.get(key)?.body ?? '{}') as MktgDocumentCommentsRecord;
}
function replace(value: MktgDocumentCommentsRecord): void {
  objects.set(key, { body: JSON.stringify(value), etag: 'changed', metadata: {} });
}
function service(): MktgDocumentCommentsService {
  return new MktgDocumentCommentsService();
}

describe('private field comment store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    objects.clear();
    flows.history.mockResolvedValue(null);
    flows.subject.mockReturnValue('opaque-user-one');
    flows.impersonating.mockReturnValue(false);
    flows.user.mockResolvedValue({ success: true, data: { name: 'Project writer' } });
    flows.revision.mockResolvedValue({
      revision: { id: revisionId, format: 'json' },
      markdown: JSON.stringify({ mf: { tagline: 'Open mesh' }, icp: [{ cta: null }] }),
      sidecar: null,
    });
    flows.get.mockImplementation(async (_req, _purpose, objectKey: string) => objects.get(objectKey) ?? null);
    flows.put.mockImplementation(async (_req, _purpose, objectKey: string, input: ObjectStorePutInput) => {
      const old = objects.get(objectKey);
      if (input.ifNoneMatch ? !!old : old?.etag !== input.ifMatch) return false;
      objects.set(objectKey, { body: Buffer.from(input.body).toString('utf8'), etag: `${old?.etag ?? 'new'}-next`, metadata: {} });
      return true;
    });
  });

  it('passes its exact author helper instance to the revision reader', async () => {
    const store = service();
    expect(flows.document.mock.calls[0][0]).toBeUndefined();
    const shared = flows.document.mock.calls[0][1] as MktgDocumentAuthorService;
    expect(shared).toBeInstanceOf(MktgDocumentAuthorService);
    const capture = vi.spyOn(shared, 'captureAuthorId');
    const resolve = vi.spyOn(shared, 'resolveAuthor');
    await store.add(req, project, type, 'living', request());
    expect(capture).toHaveBeenCalledWith(req);
    expect(resolve).toHaveBeenCalledWith(req, 'opaque-user-one', 'mktg_document_comment_author', 'Comment author lookup unavailable');
  });

  it('returns known-empty comments only after verifying the selected revision', async () => {
    expect(await service().list(req, project, type, 'living', revisionId)).toEqual({ revisionId, threads: [] });
    expect(flows.revision).toHaveBeenCalledWith(req, project, type, 'living', revisionId);
    expect(flows.get).toHaveBeenCalledWith(req, 'marketing-os-artifacts', key);
  });

  it('stores opaque effective attribution, preserves text, and strips private fields on reads', async () => {
    const response = await service().add(req, project, type, 'living', request());
    expect(record().threads[0]).toMatchObject({
      authorId: 'opaque-user-one',
      clientRequestId: 'request-one',
      text: request().text,
      revisionId,
      status: 'open',
    });
    expect(objects.get(key)?.body).not.toContain('Project writer');
    expect(response.threads[0]).toMatchObject({ author: { name: 'Project writer' }, anchor: { kind: 'field', key: 'mf.tagline' } });
    expect(response.threads[0]).not.toHaveProperty('authorId');
    expect(response.threads[0]).not.toHaveProperty('clientRequestId');
    expect(response).not.toHaveProperty('submissions');
    expect(flows.put.mock.calls[0][3]).toMatchObject({ ifNoneMatch: '*', cacheControl: 'private, no-store' });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(req, 'mktg_document_comment_add', 'Stored a field comment', { agent: 'foundation-message' });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(request().text);
  });

  it('returns the exact created/replayed comment ID without changing the public add response', async () => {
    const store = service();
    const a = await store.addWithReceipt(req, project, type, 'living', request());
    await store.add(req, project, type, 'living', request({ clientRequestId: 'another', text: request().text }));
    const replay = await store.addWithReceipt(req, project, type, 'living', request());
    expect(replay.commentId).toBe(a.commentId);
    expect(replay.response.threads).toHaveLength(2);
    expect(await store.add(req, project, type, 'living', request())).toEqual(replay.response);
    expect(replay.response).not.toHaveProperty('commentId');
  });

  it('stores a whole-kit marker rather than inventing a leaf passage or accepting caller passage bytes', async () => {
    const kit = { ...type, agentKey: 'brand-kit' } as MktgDocumentType;
    flows.revision.mockResolvedValue({
      revision: { id: revisionId, format: 'markdown' },
      markdown: '# Kit',
      sidecar: { chapters: { voice: { line: 'Open mesh' } } },
    });
    const result = await service().addWithReceipt(req, project, kit, 'living', request({ anchor: { kind: 'document', key: 'chapters' } }));
    expect(result.response.threads[0].anchor).toEqual({ kind: 'document', key: 'chapters', passage: 'Whole asset' });
    await expect(
      service().add(req, project, kit, 'living', request({ clientRequestId: 'wrong-root', anchor: { kind: 'document', key: 'chapters.voice.line' } }))
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not silently reuse a nonce with another anchor kind at the same root', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request({ anchor: { kind: 'field', key: 'mf' } }));
    await expect(store.add(req, project, type, 'living', request({ anchor: { kind: 'document', key: 'mf' } }))).rejects.toMatchObject({
      code: 'MKTG_COMMENT_REQUEST_CONFLICT',
    });
  });

  it('retries a contention comparison and does not lose concurrent comments', async () => {
    const store = service();
    await Promise.all([
      store.add(req, project, type, 'living', request()),
      store.add(req, project, type, 'living', request({ clientRequestId: 'request-two', text: 'Another writer comment' })),
    ]);
    expect(record().threads).toHaveLength(2);
    expect(new Set(record().threads.map((entry) => entry.id)).size).toBe(2);
    expect(flows.put.mock.calls.some((call) => call[3].ifMatch)).toBe(true);
  });

  it('deduplicates the same request across concurrent writers without duplicating a thread', async () => {
    const store = service();
    const [a, b] = await Promise.all([store.add(req, project, type, 'living', request()), store.add(req, project, type, 'living', request())]);
    expect(record().threads).toHaveLength(1);
    expect(a.threads[0].id).toBe(b.threads[0].id);
    await expect(store.add(req, project, type, 'living', request({ text: 'Different request content' }))).rejects.toBeInstanceOf(ConflictError);
    flows.subject.mockReturnValue('opaque-user-two');
    await expect(store.add(req, project, type, 'living', request())).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps source revision context and displays sent comments against their result revision', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const value = record();
    Object.assign(value.threads[0], {
      status: 'resolved',
      resultRevisionId: resultId,
      sentInRun: 'c'.repeat(64),
      resolution: 'Shortened the line.',
      sessionId: 'private-session',
    });
    replace(value);
    const response = await store.list(req, project, type, 'living', resultId);
    expect(response.threads[0]).toMatchObject({ revisionId, resultRevisionId: resultId, resolution: 'Shortened the line.' });
    expect(response.threads[0]).not.toHaveProperty('sessionId');
    expect((await store.list(req, project, type, 'living', `000003-${'d'.repeat(64)}`)).threads).toEqual([]);
  });

  it('uses stored brand-kit passage text, never a caller passage or path as prose', async () => {
    flows.revision.mockResolvedValue({ revision: { format: 'markdown' }, sidecar: { chapters: { voice: { line: 'Open, together.' } } } });
    const response = await service().add(
      req,
      project,
      { ...type, agentKey: 'brand-kit' },
      'living',
      request({ anchor: { kind: 'passage', key: 'chapters.voice.line' } })
    );
    expect(response.threads[0].anchor).toEqual({ kind: 'passage', key: 'chapters.voice.line', passage: 'Open, together.' });
    expect(objects.has(`document-comments/${project}/brand-kit/living.json`)).toBe(true);
    await expect(
      service().add(req, project, { ...type, agentKey: 'brand-kit' }, 'living', request({ anchor: { kind: 'passage', key: 'chapters.voice' } }))
    ).rejects.toBeInstanceOf(ServiceValidationError);
  });

  it('accepts null fields, rejects inherited/prototype/foreign paths and unsupported assets', async () => {
    await service().add(req, project, type, 'living', request({ anchor: { kind: 'field', key: 'icp[0].cta' } }));
    for (const path of ['mf.constructor', 'mf.missing', 'report.gaps']) {
      await expect(service().add(req, project, type, 'living', request({ anchor: { kind: 'field', key: path } }))).rejects.toBeInstanceOf(
        ServiceValidationError
      );
    }
    await expect(service().list(req, project, { ...type, agentKey: 'member-360', kind: 'run' }, 'living', revisionId)).rejects.toBeInstanceOf(
      ServiceValidationError
    );
  });

  it.each([
    { text: '' },
    { text: 'x'.repeat(4001) },
    { clientRequestId: '../bad' },
    { authorId: 'forged' },
    { createdAt: 'forged' },
    { anchor: { kind: 'passage', key: 'kit.font', passage: 'forged' } },
    { anchor: { kind: 'bad', key: 'mf.tagline' } },
    { anchor: null },
  ])('rejects malformed or server-owned request fields %j without writing', async (override) => {
    await expect(service().add(req, project, type, 'living', { ...request(), ...override })).rejects.toBeInstanceOf(ServiceValidationError);
    expect(flows.put).not.toHaveBeenCalled();
  });

  it('fails closed on missing revisions, unreadable JSON and legacy Markdown', async () => {
    flows.revision.mockResolvedValueOnce(null);
    await expect(service().list(req, project, type, 'living', revisionId)).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(flows.get).not.toHaveBeenCalled();
    flows.revision.mockResolvedValue({ revision: { format: 'json' }, markdown: 'not JSON' });
    await expect(service().add(req, project, type, 'living', request())).rejects.toBeInstanceOf(ServiceValidationError);
    flows.revision.mockResolvedValue({ revision: { format: 'markdown' }, markdown: '# Legacy' });
    await expect(service().add(req, project, type, 'living', request())).rejects.toBeInstanceOf(ServiceValidationError);
    expect(flows.put).not.toHaveBeenCalled();
  });

  it('requires an effective subject unless the impersonated target is deliberately unattributed', async () => {
    flows.subject.mockReturnValue(null);
    await expect(service().add(req, project, type, 'living', request())).rejects.toBeInstanceOf(AuthenticationError);
    flows.impersonating.mockReturnValue(true);
    expect((await service().add(req, project, type, 'living', request())).threads[0].author).toBeNull();
    expect(record().threads[0].authorId).toBeNull();
    expect(flows.user).not.toHaveBeenCalled();
  });

  it('memoizes names per request and isolates directory failures in a new request', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    await store.add(req, project, type, 'living', request({ clientRequestId: 'request-two' }));
    expect(flows.user).toHaveBeenCalledTimes(1);
    flows.user.mockClear();
    const error = new MicroserviceError('Unavailable', 503, 'UNAVAILABLE');
    flows.user.mockRejectedValueOnce(error);
    const nextReq = {} as Request;
    const response = await store.list(nextReq, project, type, 'living', revisionId);
    expect(flows.user).toHaveBeenCalledTimes(1);
    expect(response.threads.map((entry) => entry.author)).toEqual([{ name: null }, { name: null }]);
    expect(JSON.stringify(response)).not.toContain('opaque-user-one');
    expect(logger.warning).toHaveBeenCalledExactlyOnceWith(nextReq, 'mktg_document_comment_author', 'Comment author lookup unavailable', { err: error });
  });

  it.each(['missing-etag', 'wrong-scope', 'invalid-json', 'invalid-thread'])('does not overwrite corrupt comments (%s)', async (failure) => {
    await service().add(req, project, type, 'living', request());
    const value = record();
    if (failure === 'wrong-scope') value.project = 'other-project';
    if (failure === 'invalid-thread') Object.assign(value.threads[0], { text: 123 });
    objects.set(key, {
      body: failure === 'invalid-json' ? '{ private malformed data' : JSON.stringify(value),
      etag: failure === 'missing-etag' ? '' : 'old',
      metadata: {},
    });
    flows.put.mockClear();
    await expect(service().add(req, project, type, 'living', request({ clientRequestId: 'request-two' }))).rejects.toMatchObject({
      code: 'MKTG_COMMENTS_CORRUPT',
    });
    expect(flows.put).not.toHaveBeenCalled();
  });

  it('refuses a full history without deleting old comments', async () => {
    await service().add(req, project, type, 'living', request());
    const value = record();
    const template = value.threads[0];
    value.threads = Array.from({ length: 500 }, (_, index) => ({ ...template, id: `thread-${index}`, clientRequestId: `request-${index}` }));
    replace(value);
    flows.put.mockClear();
    await expect(service().add(req, project, type, 'living', request({ clientRequestId: 'new-request' }))).rejects.toBeInstanceOf(ServiceValidationError);
    expect(flows.put).not.toHaveBeenCalled();
    expect(record().threads).toHaveLength(500);
  });

  it('fails closed on oversized stored bytes and duplicate thread IDs', async () => {
    objects.set(key, { body: ' '.repeat(2_000_001), etag: 'old', metadata: {} });
    await expect(service().list(req, project, type, 'living', revisionId)).rejects.toMatchObject({ code: 'MKTG_COMMENTS_CORRUPT' });
    objects.clear();
    await service().add(req, project, type, 'living', request());
    const value = record();
    value.threads.push({ ...value.threads[0], clientRequestId: 'second-request' });
    replace(value);
    await expect(service().list(req, project, type, 'living', revisionId)).rejects.toMatchObject({ code: 'MKTG_COMMENTS_CORRUPT' });
  });

  it('propagates access/storage failures rather than treating them as empty', async () => {
    flows.get.mockRejectedValueOnce(new MicroserviceError('Denied', 403, 'DENIED'));
    await expect(service().list(req, project, type, 'living', revisionId)).rejects.toMatchObject({ statusCode: 403 });
    flows.put.mockRejectedValueOnce(new MicroserviceError('Unavailable', 503, 'UNAVAILABLE'));
    await expect(service().add(req, project, type, 'living', request())).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each(['reserved', 'started', 'uncertain', 'completed', 'failed'] as const)('reports creator-only recovery for %s without writing', async (state) => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    await store.reserve(req, project, type, 'living', { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-one' });
    const saved = record();
    saved.submissions[0].state = state;
    replace(saved);
    const writes = flows.put.mock.calls.length;
    expect(await store.isRedraftTerminal(req, project, type, 'living', 'send-one', revisionId)).toBe(state === 'completed' || state === 'failed');
    expect(await store.isRedraftTerminal(req, project, type, 'living', 'missing-send', revisionId)).toBe(false);
    expect(await store.isRedraftTerminal(req, project, type, 'living', 'send-one', resultId)).toBe(false);
    flows.subject.mockReturnValue('other-opaque-writer');
    expect(await store.isRedraftTerminal(req, project, type, 'living', 'send-one', revisionId)).toBe(false);
    expect(flows.put).toHaveBeenCalledTimes(writes);
  });

  it('reserves an ordered send once and freezes only the selected input, not concurrent new comments', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const id = record().threads[0].id;
    const body = { project, revisionId, commentIds: [id], clientRequestId: 'send-one' };
    const preflight = vi.fn().mockResolvedValue(undefined);
    const first = await store.reserve(req, project, type, 'living', body, preflight);
    expect(first.fresh).toBe(true);
    expect(first.submission).toMatchObject({ requestedBy: 'opaque-user-one', state: 'reserved', runId: null });
    expect(record().threads[0].status).toBe('open');
    expect(first.comments[0]).toMatchObject({ id, text: request().text });
    expect(first.comments[0]).not.toHaveProperty('authorId');
    await store.add(req, project, type, 'living', request({ clientRequestId: 'new-comment', text: 'Concurrent new input.' }));
    const replay = await store.reserve(req, project, type, 'living', body, preflight);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(replay.fresh).toBe(false);
    expect(replay.comments).toEqual(first.comments);
    expect(record().threads.find((entry) => entry.id !== id)?.status).toBe('open');
    expect(JSON.stringify(record().submissions)).not.toContain('sessionId');
    expect(JSON.stringify(record().submissions)).not.toContain('ownerToken');
  });

  it('does not lease comments when source/dependency/form preflight fails before commitment', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const before = record();
    const body = { project, revisionId, commentIds: [before.threads[0].id], clientRequestId: 'send-one' };
    await expect(
      store.reserve(req, project, type, 'living', body, () => {
        throw new Error('Synthetic preflight rejection');
      })
    ).rejects.toThrow('Synthetic preflight rejection');
    expect(record().threads).toEqual(before.threads);
    expect(record().submissions[0].state).toBe('failed');
    const preflight = vi.fn();
    const replay = await store.reserve(req, project, type, 'living', body, preflight);
    expect(replay).toMatchObject({ fresh: false, submission: { state: 'failed' } });
    expect(preflight).not.toHaveBeenCalled();
  });

  it('lets only one competing handler acquire permission to create a session', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const body = { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-one' };
    const replies = await Promise.all([store.reserve(req, project, type, 'living', body), store.reserve(req, project, type, 'living', body)]);
    expect(replies.filter((reply) => reply.fresh)).toHaveLength(1);
    expect(record().submissions).toHaveLength(1);
    flows.subject.mockReturnValue('other-creator');
    await expect(store.reserve(req, project, type, 'living', body)).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not reopen on pending, reopens on conclusive failure and preserves an earlier result across a later send', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const body = { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-a' };
    const frozen = await store.reserve(req, project, type, 'living', body);
    const context = { ...redraftContextFixture(), project, basedOnId: revisionId, requestId: 'send-a', comments: frozen.comments };
    await store.bindRun(req, project, type, 'living', 'send-a', context.runId);
    await store.settle(req, context, { status: 'pending' });
    expect(record().threads[0].status).toBe('sent');
    await store.settle(req, context, { status: 'failed', failureText: 'Synthetic agent failure' });
    expect(record().threads[0].status).toBe('open');
    await store.reserve(req, project, type, 'living', { ...body, clientRequestId: 'send-b' });
    await store.bindRun(req, project, type, 'living', 'send-b', 'd'.repeat(64));
    const sidecar = {
      mode: 'redraft',
      version: 3,
      project_name: context.projectName,
      revision: {
        mode: 'redraft',
        prior_version: 2,
        comments: [{ number: 1, field: 'mf.tagline', comment: guardFoundationMessageText(frozen.comments[0].text), resolution: 'Earlier result resolution.' }],
      },
    };
    flows.revision.mockResolvedValue({ revision: { id: resultId, format: 'json' }, markdown: '{}', sidecar });
    const persistence = {
      project,
      version: 3,
      s3_key: 'synthetic-result',
      content_sha256: 'a'.repeat(64),
      document_location: { agent_key: type.agentKey, document_id: 'living', revision_id: resultId },
    };
    await store.settle(req, context, { status: 'ready', persistence });
    expect(record().submissions[0].state).toBe('failed');
    expect(record().threads[0]).toMatchObject({ status: 'sent', sentInRun: 'd'.repeat(64), resultRevisionId: null });
    flows.history.mockResolvedValue(context);
    expect((await store.list(req, project, type, 'living', resultId)).threads[0]).toMatchObject({
      text: frozen.comments[0].text,
      status: 'resolved',
      resolution: 'Earlier result resolution.',
      sentInRun: context.runId,
    });
  });

  it.each(['ready', 'failed'] as const)('adopts owned sent/null-hash rows so a %s result settles them', async (status) => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const body = { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-a' };
    const frozen = await store.reserve(req, project, type, 'living', body);
    await store.endStart(req, project, type, 'living', 'send-a', true);
    expect(record().threads[0]).toMatchObject({ status: 'sent', sentInRun: null });
    const context = { ...redraftContextFixture(), project, basedOnId: revisionId, requestId: 'send-a', comments: frozen.comments };
    await store.bindRun(req, project, type, 'living', 'send-a', context.runId, true);
    expect(record().threads[0]).toMatchObject({ status: 'sent', sentInRun: context.runId });
    const sidecar = {
      mode: 'redraft',
      version: 3,
      project_name: context.projectName,
      revision: {
        mode: 'redraft',
        prior_version: 2,
        comments: [{ number: 1, field: 'mf.tagline', comment: guardFoundationMessageText(frozen.comments[0].text), resolution: 'Synthetic resolved.' }],
      },
    };
    flows.revision.mockResolvedValue({ revision: { id: resultId, format: 'json' }, sidecar, markdown: '{}' });
    const persistence = {
      project,
      version: 3,
      s3_key: 'synthetic',
      content_sha256: 'a'.repeat(64),
      document_location: { agent_key: type.agentKey, document_id: 'living', revision_id: resultId },
    };
    await store.settle(req, context, { status, persistence });
    expect(record().threads[0].status).toBe(status === 'ready' ? 'resolved' : 'open');
    expect(record().submissions[0].state).toBe(status === 'ready' ? 'completed' : 'failed');
  });

  it('idempotently releases unknown sends without a ledger write, but still requires a creator identity', async () => {
    const store = service();
    expect(await store.release(req, project, type, 'living', 'unknown-send')).toEqual({ state: 'unknown' });
    expect(await store.release(req, project, type, 'living', 'unknown-send')).toEqual({ state: 'unknown' });
    expect(flows.put).not.toHaveBeenCalled();
    expect(objects.size).toBe(0);
    await store.add(req, project, type, 'living', request());
    const before = JSON.stringify(record());
    flows.put.mockClear();
    expect(await store.release(req, project, type, 'living', 'another-unknown')).toEqual({ state: 'unknown' });
    expect(JSON.stringify(record())).toBe(before);
    expect(flows.put).not.toHaveBeenCalled();
    flows.subject.mockReturnValue(null);
    await expect(store.release(req, project, type, 'living', 'unknown-send')).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('records uncertainty, permits only creator release, and preserves the old hash without touching a newer send', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const body = { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-a' };
    await store.reserve(req, project, type, 'living', body);
    const hash = 'c'.repeat(64);
    await store.bindRun(req, project, type, 'living', 'send-a', hash);
    await store.endStart(req, project, type, 'living', 'send-a', true);
    expect(record().submissions[0].state).toBe('uncertain');
    expect(record().threads[0]).toMatchObject({ status: 'sent', sentInRun: hash });
    flows.subject.mockReturnValue('other-creator');
    const before = JSON.stringify(record());
    flows.put.mockClear();
    expect(await store.release(req, project, type, 'living', 'send-a')).toEqual({ state: 'unknown' });
    expect(await store.release(req, project, type, 'living', 'unknown-send')).toEqual({ state: 'unknown' });
    expect(flows.put).not.toHaveBeenCalled();
    expect(JSON.stringify(record())).toBe(before);
    expect(logger.debug).toHaveBeenCalledWith(
      req,
      'mktg_document_redraft_release',
      'No creator-owned reservation to release',
      expect.objectContaining({ reservation_found: true })
    );
    flows.subject.mockReturnValue('opaque-user-one');
    await store.release(req, project, type, 'living', 'send-a');
    expect(record().submissions[0]).toMatchObject({ state: 'failed', runId: hash });
    expect(record().threads[0]).toMatchObject({ status: 'open', sentInRun: null });
    expect((await store.reserve(req, project, type, 'living', body)).submission.state).toBe('failed');
    await store.reserve(req, project, type, 'living', { ...body, clientRequestId: 'send-b' });
    await store.bindRun(req, project, type, 'living', 'send-b', 'd'.repeat(64));
    await store.release(req, project, type, 'living', 'send-a');
    expect(record().threads[0]).toMatchObject({ status: 'sent', sentInRun: 'd'.repeat(64) });
    await expect(store.bindRun(req, project, type, 'living', 'send-a', 'e'.repeat(64))).rejects.toBeInstanceOf(ConflictError);
  });
  it('permits creator release of an expired bound reservation even when tracking never produced a record', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    await store.reserve(req, project, type, 'living', { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-a' });
    await store.bindRun(req, project, type, 'living', 'send-a', 'c'.repeat(64));
    const expired = record();
    expired.submissions[0].createdAt = '2000-01-01T00:00:00Z';
    replace(expired);
    await store.release(req, project, type, 'living', 'send-a');
    expect(record().submissions[0]).toMatchObject({ state: 'failed', runId: 'c'.repeat(64) });
    expect(record().threads[0]).toMatchObject({ status: 'open', sentInRun: null });
  });
  it('fails conclusive non-acceptance and allows only an explicit new nonce', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const body = { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-a' };
    await store.reserve(req, project, type, 'living', body);
    await store.endStart(req, project, type, 'living', 'send-a', false);
    expect(record().threads[0]).toMatchObject({ status: 'open', sentInRun: null });
    const replay = await store.reserve(req, project, type, 'living', body);
    expect(replay).toMatchObject({ fresh: false, submission: { state: 'failed' } });
    expect((await store.reserve(req, project, type, 'living', { ...body, clientRequestId: 'send-b' })).fresh).toBe(true);
  });
  it('unblocks an expired unbound reservation and rejects its late bind without clobbering the new lease', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const body = { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-a' };
    await store.reserve(req, project, type, 'living', body);
    const old = record();
    old.submissions[0].createdAt = '2000-01-01T00:00:00Z';
    replace(old);
    expect((await store.reserve(req, project, type, 'living', { ...body, clientRequestId: 'send-b' })).fresh).toBe(true);
    await expect(store.bindRun(req, project, type, 'living', 'send-a', 'c'.repeat(64))).rejects.toMatchObject({ code: 'MKTG_REDRAFT_REQUEST_EXPIRED' });
    await store.endStart(req, project, type, 'living', 'send-a', true);
    expect(record().threads[0]).toMatchObject({ status: 'open', sentInRun: null });
  });

  it('binds only an opaque run hash and cannot rebind to a different run or creator', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    await store.reserve(req, project, type, 'living', { project, revisionId, commentIds: [record().threads[0].id], clientRequestId: 'send-one' });
    const runId = 'd'.repeat(64);
    await store.endStart(req, project, type, 'living', 'send-one', true);
    expect(record().threads[0]).toMatchObject({ status: 'sent', sentInRun: null });
    await store.bindRun(req, project, type, 'living', 'send-one', runId);
    expect(record().threads[0]).toMatchObject({ status: 'sent', sentInRun: runId });
    expect((await store.bindRun(req, project, type, 'living', 'send-one', runId, true)).state).toBe('started');
    await store.endStart(req, project, type, 'living', 'send-one', true);
    expect(record().submissions[0].state).toBe('started');
    await expect(store.release(req, project, type, 'living', 'send-one')).rejects.toMatchObject({ code: 'MKTG_REDRAFT_COMMENTS_BUSY' });
    await expect(store.bindRun(req, project, type, 'living', 'send-one', 'e'.repeat(64))).rejects.toBeInstanceOf(ConflictError);
    flows.subject.mockReturnValue('other-creator');
    await expect(store.bindRun(req, project, type, 'living', 'send-one', runId)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects foreign, busy, duplicate or over-cap input IDs without another reservation', async () => {
    const store = service();
    await store.add(req, project, type, 'living', request());
    const id = record().threads[0].id;
    const body = { project, revisionId, commentIds: [id], clientRequestId: 'send-one' };
    for (const commentIds of [[id, id], ['foreign-comment']])
      await expect(store.reserve(req, project, type, 'living', { ...body, commentIds })).rejects.toBeInstanceOf(ServiceValidationError);
    const value = record();
    value.threads = Array.from({ length: 31 }, (_, index) => ({ ...value.threads[0], id: `comment-${index}`, clientRequestId: `input-${index}` }));
    replace(value);
    await expect(store.reserve(req, project, type, 'living', { ...body, commentIds: value.threads.map((entry) => entry.id) })).rejects.toBeInstanceOf(
      ServiceValidationError
    );
    expect(record().submissions).toEqual([]);
    await store.reserve(req, project, type, 'living', { ...body, commentIds: ['comment-0'] });
    await expect(store.reserve(req, project, type, 'living', { ...body, commentIds: ['comment-0'], clientRequestId: 'different-send' })).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  describe('server-only sign-off submission proof/release', () => {
    async function seeded(state: MktgDocumentCommentsRecord['submissions'][number]['state'], descriptor = false) {
      const store = service();
      const receipt = await store.addWithReceipt(req, project, type, 'living', request());
      const scope = { revisionId, requestedBy: 'opaque-user-one', requestId: 'sign-off-send', commentRequestId: 'request-one' };
      await store.reserve(req, project, type, 'living', { project, revisionId, commentIds: [receipt.commentId], clientRequestId: scope.requestId });
      const saved = record();
      saved.submissions[0].state = state;
      saved.submissions[0].createdAt = '2020-01-01T00:00:00Z';
      saved.submissions[0].runId = descriptor || state === 'started' || state === 'completed' ? 'c'.repeat(64) : null;
      replace(saved);
      if (descriptor) {
        const thread = saved.threads[0];
        const context = {
          ...redraftContextFixture(),
          project,
          requestId: scope.requestId,
          basedOnId: revisionId,
          comments: [{ id: thread.id, anchor: thread.anchor, text: thread.text, createdAt: thread.createdAt }],
        };
        objects.set(`document-redrafts/${context.runId}.json`, { body: JSON.stringify(context), etag: 'descriptor', metadata: {} });
      }
      flows.put.mockClear();
      return { store, scope, id: receipt.commentId };
    }
    it('reports absence without fabricating a ledger row, a terminal status or a no-start guarantee', async () => {
      const scope = { revisionId, requestedBy: 'opaque-user-one', requestId: 'missing-send', commentRequestId: 'missing-comment' };
      expect(await service().signOffSubmissionProof(req, project, type, 'living', scope)).toEqual({ state: 'absent', commentId: null });
      expect(flows.put).not.toHaveBeenCalled();
    });
    it.each(['started', 'completed', 'failed'] as const)('projects confirmed %s without modifying its ledger', async (state) => {
      const { store, scope, id } = await seeded(state);
      const proof = await store.signOffSubmissionProof(req, project, type, 'living', scope, async () => {});
      expect(proof).toEqual({ state: state === 'failed' ? 'failed' : 'accepted', commentId: id });
      expect(JSON.stringify(proof)).not.toContain(scope.requestedBy);
      expect(flows.put).not.toHaveBeenCalled();
    });
    it('treats a matching immutable descriptor as accepted, not releasable uncertainty', async () => {
      const { store, scope, id } = await seeded('uncertain', true);
      expect(await store.signOffSubmissionProof(req, project, type, 'living', scope, async () => {})).toEqual({ state: 'accepted', commentId: id });
      expect(record().submissions[0].state).toBe('uncertain');
      expect(flows.put).not.toHaveBeenCalled();
    });
    it('inspects uncertainty read-only and releases only after explicit authorization, preserving the original creator', async () => {
      const { store, scope, id } = await seeded('uncertain');
      expect(await store.signOffSubmissionProof(req, project, type, 'living', scope)).toEqual({ state: 'uncertain', commentId: id });
      expect(flows.put).not.toHaveBeenCalled();
      flows.subject.mockReturnValue('opaque-project-writer');
      const authorize = vi.fn(async () => {});
      expect(await store.signOffSubmissionProof(req, project, type, 'living', scope, authorize)).toEqual({ state: 'released', commentId: id });
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(record().submissions[0]).toMatchObject({ state: 'failed', requestedBy: scope.requestedBy });
      expect(flows.subject()).toBe('opaque-project-writer');
      expect(record().threads[0]).toMatchObject({ status: 'open', authorId: scope.requestedBy });
    });
    it('re-evaluates an accepted concurrent start after a lost release CAS rather than overwriting it', async () => {
      const { store, scope, id } = await seeded('uncertain');
      flows.put.mockImplementationOnce(async () => {
        const accepted = record();
        accepted.submissions[0].state = 'started';
        accepted.submissions[0].runId = 'c'.repeat(64);
        replace(accepted);
        return false;
      });
      expect(await store.signOffSubmissionProof(req, project, type, 'living', scope, () => Promise.resolve())).toEqual({ state: 'accepted', commentId: id });
      expect(record().submissions[0].state).toBe('started');
      expect(flows.put).toHaveBeenCalledTimes(1);
    });
    it('does not infer release permission from nonce knowledge', async () => {
      const { store, scope } = await seeded('uncertain');
      const denied = new AuthorizationError('Release denied');
      await expect(
        store.signOffSubmissionProof(req, project, type, 'living', scope, async () => {
          throw denied;
        })
      ).rejects.toBe(denied);
      expect(flows.put).not.toHaveBeenCalled();
      expect(record().submissions[0].state).toBe('uncertain');
    });
    it('refuses even an old unbound reservation instead of time-based release or theft', async () => {
      const { store, scope, id } = await seeded('reserved');
      expect(await store.signOffSubmissionProof(req, project, type, 'living', scope)).toEqual({ state: 'in-flight', commentId: id });
      await expect(store.signOffSubmissionProof(req, project, type, 'living', scope, async () => {})).rejects.toMatchObject({
        code: 'MKTG_REDRAFT_COMMENTS_BUSY',
      });
      expect(flows.put).not.toHaveBeenCalled();
    });
    it.each([{ requestedBy: 'another-actor' }, { revisionId: resultId }, { commentRequestId: 'another-comment' }])(
      'rejects a mismatched frozen correlation %j',
      async (override) => {
        const { store, scope } = await seeded('uncertain');
        await expect(store.signOffSubmissionProof(req, project, type, 'living', { ...scope, ...override }, async () => {})).rejects.toMatchObject({
          code: 'MKTG_SIGN_OFF_CORRELATION_CONFLICT',
        });
        expect(flows.put).not.toHaveBeenCalled();
      }
    );
    it('never uses a descriptor from another request as acceptance proof', async () => {
      const { store, scope } = await seeded('uncertain', true);
      const key = `document-redrafts/${'c'.repeat(64)}.json`;
      const context = JSON.parse(objects.get(key)?.body ?? '{}');
      context.requestId = 'another-request';
      objects.set(key, { body: JSON.stringify(context), etag: 'descriptor', metadata: {} });
      await expect(store.signOffSubmissionProof(req, project, type, 'living', scope)).rejects.toMatchObject({ code: 'MKTG_SIGN_OFF_CORRELATION_CONFLICT' });
      expect(flows.put).not.toHaveBeenCalled();
    });
  });

  it('bounds comparison retries instead of spinning indefinitely', async () => {
    flows.put.mockResolvedValue(false);
    await expect(service().add(req, project, type, 'living', request())).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(flows.put).toHaveBeenCalledTimes(8);
  });
});
