// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runMocks = vi.hoisted(() => ({ readProgress: vi.fn(), retry: vi.fn(), refreshFailure: vi.fn() }));
const projectMocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));
const storeMocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  getRevision: vi.fn(),
  restoreRevision: vi.fn(),
  approveRevision: vi.fn(),
}));
const loggerMocks = vi.hoisted(() => ({
  startOperation: vi.fn(() => 0),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-document-store.utils'));
vi.mock('../services/mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public listDocuments = storeMocks.listDocuments;
    public getDocument = storeMocks.getDocument;
    public getRevision = storeMocks.getRevision;
    public restoreRevision = storeMocks.restoreRevision;
    public approveRevision = storeMocks.approveRevision;
  },
}));
vi.mock('../services/mktg-document-run.service', async () => {
  const actual = await vi.importActual<typeof import('../services/mktg-document-run.service')>('../services/mktg-document-run.service');
  return {
    MktgDocumentRunService: class {
      public readProgress = runMocks.readProgress;
      public retry = runMocks.retry;
      public refreshFailure = runMocks.refreshFailure;
      public detailWithProgress = actual.MktgDocumentRunService.prototype.detailWithProgress;
    },
  };
});
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: loggerMocks }));

import type { NextFunction, Request, Response } from 'express';
import { findMktgDocumentType } from '@lfx-one/shared/utils';
import type { MktgDocumentDetailResponse, MktgDocumentRunProgress } from '@lfx-one/shared/interfaces';

import { AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { MktgDocumentsController } from './mktg-documents.controller';

const PROJECT = 'proj-uid-1';
const REVISION_ID = `000002-${'a'.repeat(64)}`;

function runProgress(overrides: Partial<MktgDocumentRunProgress> = {}): MktgDocumentRunProgress {
  return {
    runId: 'b'.repeat(64),
    project: PROJECT,
    agentKey: 'brand-kit',
    documentId: 'living',
    state: 'questions',
    startedAt: '2026-10-19T12:00:00Z',
    ...overrides,
  };
}

function buildReq(params: Record<string, string> = {}, query: Record<string, unknown> = {}, body?: unknown): Request {
  return { path: '/api/mktg-agents/documents', params, query, body } as unknown as Request;
}

function buildRes(): Response & { json: ReturnType<typeof vi.fn> } {
  return { json: vi.fn() } as unknown as Response & { json: ReturnType<typeof vi.fn> };
}

describe('MktgDocumentsController', () => {
  let controller: MktgDocumentsController;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: true });
    runMocks.readProgress.mockResolvedValue({ runs: [] });
    runMocks.retry.mockResolvedValue(undefined);
    runMocks.refreshFailure.mockResolvedValue(null);
    controller = new MktgDocumentsController();
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  });

  it('lists the documents of the SERVER-resolved project for a writer', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: 'resolved-uid', writer: true });
    storeMocks.listDocuments.mockResolvedValue({ project: 'resolved-uid', groups: [] });
    const res = buildRes();

    await controller.listDocuments(buildReq({}, { project: PROJECT }), res, next);

    expect(projectMocks.getProjectById).toHaveBeenCalledWith(expect.anything(), PROJECT, true);
    expect(storeMocks.listDocuments).toHaveBeenCalledWith(expect.anything(), 'resolved-uid');
    expect(res.json).toHaveBeenCalledWith({ project: 'resolved-uid', groups: [], runs: [] });
    expect(runMocks.readProgress).toHaveBeenCalledWith(expect.anything(), 'resolved-uid', undefined, undefined, false);
  });

  it('approves under the SERVER-resolved writer project and returns the updated response', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: 'resolved-uid', writer: true });
    storeMocks.approveRevision.mockResolvedValue({ revision: { number: 1 }, approval: { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: null } } });
    const res = buildRes();
    await controller.approveRevision(buildReq({ agentKey: 'faq', documentId: 'living', revisionId: REVISION_ID }, { project: PROJECT }), res, next);
    expect(storeMocks.approveRevision).toHaveBeenCalledWith(
      expect.anything(),
      'resolved-uid',
      expect.objectContaining({ agentKey: 'faq' }),
      'living',
      REVISION_ID
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ approval: expect.any(Object) }));
  });

  it('refuses approval without writer rights and rejects invalid revision/project params', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });
    await controller.approveRevision(buildReq({ agentKey: 'faq', documentId: 'living', revisionId: REVISION_ID }, { project: PROJECT }), buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(storeMocks.approveRevision).not.toHaveBeenCalled();
    next.mockClear();
    await controller.approveRevision(buildReq({ agentKey: 'faq', documentId: 'living', revisionId: '../bad' }, { project: PROJECT }), buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    next.mockClear();
    await controller.approveRevision(buildReq({ agentKey: 'faq', documentId: 'living', revisionId: REVISION_ID }, { project: '../bad' }), buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  it('returns not-found for approval of a missing revision and forwards write failures', async () => {
    const request = buildReq({ agentKey: 'faq', documentId: 'living', revisionId: REVISION_ID }, { project: PROJECT });
    storeMocks.approveRevision.mockResolvedValue(null);
    await controller.approveRevision(request, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
    const failure = ServiceValidationError.forField('revision', 'Write failed');
    storeMocks.approveRevision.mockRejectedValue(failure);
    await controller.approveRevision(request, buildRes(), next);
    expect(next).toHaveBeenCalledWith(failure);
  });

  it('refuses a caller without the project writer grant', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });

    await controller.listDocuments(buildReq({}, { project: PROJECT }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(storeMocks.listDocuments).not.toHaveBeenCalled();
    expect(runMocks.readProgress).not.toHaveBeenCalled();
  });

  it.each(['', '../other', 'a/b', 'proj?x=1'])('rejects the project uid %j before any upstream lookup', async (project) => {
    await controller.listDocuments(buildReq({}, { project }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(projectMocks.getProjectById).not.toHaveBeenCalled();
  });

  it.each([
    [{ agentKey: 'not-an-agent', documentId: 'living' }],
    [{ agentKey: 'brand-kit', documentId: '../living' }],
    [{ agentKey: 'brand-kit', documentId: 'run-xyz' }],
  ])('rejects document params %j before any storage call', async (params) => {
    await controller.getDocument(buildReq(params, { project: PROJECT }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(storeMocks.getDocument).not.toHaveBeenCalled();
  });

  it('answers 404 for a document with nothing stored', async () => {
    storeMocks.getDocument.mockResolvedValue(null);

    await controller.getDocument(buildReq({ agentKey: 'brand-kit', documentId: 'living' }, { project: PROJECT }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });

  it('distinguishes an absent document from an absent revision', async () => {
    storeMocks.getRevision.mockResolvedValue(null);
    storeMocks.getDocument.mockResolvedValue(null);
    await controller.getRevision(buildReq({ agentKey: 'brand-kit', documentId: 'living', revisionId: REVISION_ID }, { project: PROJECT }), buildRes(), next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'MKTG_DOCUMENT_NOT_FOUND', statusCode: 404 }));
    storeMocks.getDocument.mockResolvedValue({ revisions: [] });
    await controller.getRevision(buildReq({ agentKey: 'brand-kit', documentId: 'living', revisionId: REVISION_ID }, { project: PROJECT }), buildRes(), next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'NOT_FOUND', statusCode: 404 }));
  });

  it('serves one revision by id', async () => {
    const revision = { revision: { number: 2 }, markdown: '# Doc' };
    storeMocks.getRevision.mockResolvedValue(revision);
    const res = buildRes();

    await controller.getRevision(buildReq({ agentKey: 'brand-kit', documentId: 'living', revisionId: REVISION_ID }, { project: PROJECT }), res, next);

    expect(storeMocks.getRevision).toHaveBeenCalledWith(expect.anything(), PROJECT, expect.objectContaining({ agentKey: 'brand-kit' }), 'living', REVISION_ID);
    expect(res.json).toHaveBeenCalledWith({ ...revision, runs: [] });
  });

  it.each(['latest', `000000-${'a'.repeat(64)}`])('rejects invalid revision id %s', async (revisionId) => {
    await controller.getRevision(buildReq({ agentKey: 'brand-kit', documentId: 'living', revisionId }, { project: PROJECT }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(storeMocks.getRevision).not.toHaveBeenCalled();
  });

  it('restores a revision for a writer and returns the document with its new latest revision', async () => {
    storeMocks.restoreRevision.mockResolvedValue({ detail: { project: PROJECT, documentId: 'living', revisions: [] }, revision: { number: 3 } });
    const res = buildRes();

    await controller.restoreRevision(buildReq({ agentKey: 'icp', documentId: 'living' }, {}, { project: PROJECT, revisionId: REVISION_ID }), res, next);

    expect(storeMocks.restoreRevision).toHaveBeenCalledWith(expect.anything(), PROJECT, expect.objectContaining({ agentKey: 'icp' }), 'living', REVISION_ID);
    expect(res.json).toHaveBeenCalledWith({ project: PROJECT, documentId: 'living', revisions: [], revision: { number: 3 } });
  });

  it('never restores for a caller without the writer grant', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });

    await controller.restoreRevision(buildReq({ agentKey: 'icp', documentId: 'living' }, {}, { project: PROJECT, revisionId: REVISION_ID }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(storeMocks.restoreRevision).not.toHaveBeenCalled();
  });

  it('serves an unstored document with public progress without inventing a revision or current pointer', async () => {
    const run = runProgress();
    runMocks.readProgress.mockResolvedValue({ runs: [run] });
    storeMocks.getDocument.mockResolvedValue(null);
    const res = buildRes();
    await controller.getDocument(buildReq({ agentKey: 'brand-kit', documentId: 'living' }, { project: PROJECT }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ revisions: [], runs: [run] }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('current');
  });

  it('treats a missing draft on timer reads as a partial read, not a not-found completion signal', async () => {
    storeMocks.getDocument.mockResolvedValue(null);
    const res = buildRes();
    await controller.getDocument(buildReq({ agentKey: 'brand-kit', documentId: 'living' }, { project: PROJECT, poll: '1' }), res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ revisions: [], runs: [] }));
    expect(next).not.toHaveBeenCalled();
    expect(runMocks.readProgress).toHaveBeenCalledWith(expect.anything(), PROJECT, 'brand-kit', 'living', true);
  });

  it('explicitly refreshes only the selected failed run on navigation, never list/timer reads', async () => {
    storeMocks.getDocument.mockResolvedValue(null);
    const id = 'b'.repeat(64);
    runMocks.readProgress.mockResolvedValue({ runs: [] });
    runMocks.refreshFailure.mockResolvedValue(runProgress({ runId: id, state: 'failed', failureText: 'Synthetic plain reply' }));
    const res = buildRes();
    await controller.getDocument(buildReq({ agentKey: 'brand-kit', documentId: 'living' }, { project: PROJECT, refreshRun: id }), res, next);
    expect(runMocks.refreshFailure).toHaveBeenCalledWith(expect.anything(), PROJECT, 'brand-kit', 'living', id);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ runs: [expect.objectContaining({ failureText: 'Synthetic plain reply' })] }));
    runMocks.refreshFailure.mockClear();
    await controller.getDocument(buildReq({ agentKey: 'brand-kit', documentId: 'living' }, { project: PROJECT, poll: '1', refreshRun: id }), buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(runMocks.refreshFailure).not.toHaveBeenCalled();
  });

  async function assertStoredDetailRetained(failure: Error): Promise<void> {
    const type = findMktgDocumentType('brand-kit');
    if (!type) throw new Error('Missing synthetic document type');
    const detail: MktgDocumentDetailResponse = {
      project: PROJECT,
      type,
      documentId: 'living',
      revisions: [],
      approvedCurrent: null,
      current: { revisionId: REVISION_ID, changedAt: '2026-10-19T12:00:00Z', changedBy: null },
    };
    storeMocks.getDocument.mockResolvedValue(detail);
    runMocks.readProgress.mockResolvedValue({ runs: [runProgress({ state: 'failed' })] });
    runMocks.refreshFailure.mockRejectedValueOnce(failure);
    const res = buildRes();
    await controller.getDocument(buildReq({ agentKey: type.agentKey, documentId: 'living' }, { project: PROJECT, refreshRun: 'c'.repeat(64) }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ...detail, runs: [runProgress({ state: 'failed' })], progressUnavailable: true });
  }

  it.each(['stale', 'foreign'])('keeps a stored document readable for a %s selector without caller-floodable warnings', async () => {
    const failure = new ResourceNotFoundError('Run', 'c'.repeat(64));
    await assertStoredDetailRetained(failure);
    expect(loggerMocks.debug).toHaveBeenCalledWith(expect.anything(), 'mktg_run_failure_detail', expect.any(String), expect.objectContaining({ err: failure }));
    expect(loggerMocks.warning).not.toHaveBeenCalled();
  });

  it('warns for genuine transient tracking degradation while retaining the stored document', async () => {
    const failure = new MicroserviceError('Synthetic tracking outage', 503, 'STORE_UNAVAILABLE', { service: 'object_store' });
    await assertStoredDetailRetained(failure);
    expect(loggerMocks.warning).toHaveBeenCalledWith(
      expect.anything(),
      'mktg_run_failure_detail',
      expect.any(String),
      expect.objectContaining({ err: failure })
    );
    expect(loggerMocks.debug).not.toHaveBeenCalled();
  });

  it('retries only a validated stored run under server-resolved writer scope', async () => {
    const id = 'b'.repeat(64);
    storeMocks.getDocument.mockResolvedValue(null);
    const params = { agentKey: 'brand-kit', documentId: 'living', runId: id };
    await controller.retryRun(buildReq(params, {}, { project: PROJECT }), buildRes(), next);
    expect(runMocks.retry).toHaveBeenCalledWith(expect.anything(), PROJECT, 'brand-kit', 'living', id);
    runMocks.retry.mockClear();
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });
    await controller.retryRun(buildReq(params, {}, { project: PROJECT }), buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(runMocks.retry).not.toHaveBeenCalled();
  });

  it('rejects malformed run/refresh selectors before project or storage lookup', async () => {
    await controller.retryRun(buildReq({ agentKey: 'brand-kit', documentId: 'living', runId: '../run' }, {}, { project: PROJECT }), buildRes(), next);
    await controller.getDocument(buildReq({ agentKey: 'brand-kit', documentId: 'living' }, { project: PROJECT, refreshRun: ['bad'] }), buildRes(), next);
    expect(projectMocks.getProjectById).not.toHaveBeenCalled();
    expect(runMocks.retry).not.toHaveBeenCalled();
    expect(runMocks.refreshFailure).not.toHaveBeenCalled();
  });

  it('answers 404 when the document has no such revision to restore', async () => {
    storeMocks.restoreRevision.mockResolvedValue(null);

    await controller.restoreRevision(buildReq({ agentKey: 'icp', documentId: 'living' }, {}, { project: PROJECT, revisionId: REVISION_ID }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });
});
