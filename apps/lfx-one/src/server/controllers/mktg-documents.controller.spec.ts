// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectMocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));
const storeMocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  getRevision: vi.fn(),
  restoreRevision: vi.fn(),
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
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: loggerMocks }));

import type { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { MktgDocumentsController } from './mktg-documents.controller';

const PROJECT = 'proj-uid-1';
const REVISION_ID = `000002-${'a'.repeat(64)}`;

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
    expect(res.json).toHaveBeenCalledWith({ project: 'resolved-uid', groups: [] });
  });

  it('refuses a caller without the project writer grant', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });

    await controller.listDocuments(buildReq({}, { project: PROJECT }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(storeMocks.listDocuments).not.toHaveBeenCalled();
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

  it('serves one revision by id', async () => {
    const revision = { revision: { number: 2 }, markdown: '# Doc' };
    storeMocks.getRevision.mockResolvedValue(revision);
    const res = buildRes();

    await controller.getRevision(buildReq({ agentKey: 'brand-kit', documentId: 'living', revisionId: REVISION_ID }, { project: PROJECT }), res, next);

    expect(storeMocks.getRevision).toHaveBeenCalledWith(expect.anything(), PROJECT, expect.objectContaining({ agentKey: 'brand-kit' }), 'living', REVISION_ID);
    expect(res.json).toHaveBeenCalledWith(revision);
  });

  it('rejects a malformed revision id', async () => {
    await controller.getRevision(buildReq({ agentKey: 'brand-kit', documentId: 'living', revisionId: 'latest' }, { project: PROJECT }), buildRes(), next);

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

  it('answers 404 when the document has no such revision to restore', async () => {
    storeMocks.restoreRevision.mockResolvedValue(null);

    await controller.restoreRevision(buildReq({ agentKey: 'icp', documentId: 'living' }, {}, { project: PROJECT, revisionId: REVISION_ID }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ResourceNotFoundError));
  });
});
