// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { MktgAddDocumentCommentRequest, MktgDocumentCommentsRecord, MktgDocumentType, ObjectStorePutInput } from '@lfx-one/shared/interfaces';
const flows = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), revision: vi.fn(), user: vi.fn(), subject: vi.fn(), impersonating: vi.fn(), document: vi.fn() }));
const objects = vi.hoisted(() => new Map<string, { body: string; etag: string; metadata: Record<string, string> }>());
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-comments.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-document-comments.utils'));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = flows.get;
    public putConditionalObject = flows.put;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public getRevision = flows.revision;
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
import { AuthenticationError, ConflictError, MicroserviceError, PreconditionFailedError, ResourceNotFoundError, ServiceValidationError } from '../errors';
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

  it('bounds comparison retries instead of spinning indefinitely', async () => {
    flows.put.mockResolvedValue(false);
    await expect(service().add(req, project, type, 'living', request())).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(flows.put).toHaveBeenCalledTimes(8);
  });
});
