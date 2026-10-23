// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_REVISION_ID_REGEX,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_DOCUMENT_COMMENT_ID_REGEX,
} from '@lfx-one/shared/constants';
import { MktgDocumentType, MktgRestoreRevisionRequest, MktgRestoreRevisionResponse, MktgRetryDocumentRunRequest } from '@lfx-one/shared/interfaces';
import { findMktgDocumentType, readMktgRedraftRequest } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MktgDocumentStoreService } from '../services/mktg-document-store.service';
import { MktgDocumentCommentsService } from '../services/mktg-document-comments.service';
import { ProjectService } from '../services/project.service';
import { MktgDocumentRunService } from '../services/mktg-document-run.service';
import { MktgDocumentRedraftService } from '../services/mktg-document-redraft.service';

/**
 * The Marketing OS Documents area: every stored agent output of a project as
 * a document with revisions, and Restore.
 *
 * AUTHZ — the same boundary as the agents' `/stored` reads: the caller must
 * hold the writer grant on the requested project, and the storage partition
 * is the SERVER-resolved project uid, never client input. The raw uid is
 * shape-gated to one safe path segment before it reaches the unencoded
 * `/projects/{uid}` lookup, and every other path parameter is shape-gated
 * before it can form a storage key.
 */
export class MktgDocumentsController {
  private readonly documentStore = new MktgDocumentStoreService();
  private readonly projectService = new ProjectService();
  private readonly documentRuns = new MktgDocumentRunService();
  private readonly comments = new MktgDocumentCommentsService();
  private readonly redrafts = new MktgDocumentRedraftService();

  /** POST a writer-authorized comments-only redraft; no caller previous JSON or agent routing. */
  public async revise(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_document_revise';
    const input = readMktgRedraftRequest(req.body);
    const params = this.readDocumentParams(req, input?.project, operation);
    if (!input || params instanceof Error) {
      next(params instanceof Error ? params : this.invalidField(req, operation, 'body', 'A valid ID-only send is required.'));
      return;
    }
    const started = logger.startOperation(req, operation, {});
    try {
      const project = await this.documentRuns.resolveProject(req, params.projectUid);
      const response = await this.redrafts.send(req, project, params.type, params.documentId, input, this.documentRuns);
      logger.success(req, operation, started, { agent: params.type.agentKey });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** Writer + original creator explicitly release an uncertain/expired send; never start or rebind it. */
  public async releaseRedraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_document_redraft_release';
    const params = this.readDocumentParams(req, req.body?.project, operation);
    const requestId = req.params['requestId'];
    if (params instanceof Error) {
      next(params);
      return;
    }
    if (typeof requestId !== 'string' || !MKTG_DOCUMENT_COMMENT_ID_REGEX.test(requestId)) {
      next(this.invalidField(req, operation, 'requestId', 'A bounded request ID is required.'));
      return;
    }
    const started = logger.startOperation(req, operation, {});
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      await this.comments.release(req, project, params.type, params.documentId, requestId);
      logger.success(req, operation, started, { agent: params.type.agentKey });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/mktg-agents/documents?project=<uid> — the project's documents, grouped by type. */
  public async listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_documents_list';
    const projectUid = this.readProjectUid(req.query['project']);
    if (!projectUid) {
      next(this.invalidProject(req, operation));
      return;
    }

    const startTime = logger.startOperation(req, operation, {});
    try {
      const project = await this.resolveWritableProject(req, projectUid, operation);
      const progress = await this.documentRuns.readProgress(req, project, undefined, undefined, req.query['poll'] === '1');
      const documents = await this.documentStore.listDocuments(req, project);
      logger.success(req, operation, startTime, { project, groups: documents.groups.length });
      res.json({ ...documents, ...progress });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/mktg-agents/documents/:agentKey/:documentId?project=<uid> — one document and its revisions. */
  public async getDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_document_get';
    const params = this.readDocumentParams(req, req.query['project'], operation);
    if (params instanceof Error) {
      next(params);
      return;
    }

    const poll = req.query['poll'] === '1';
    const refreshRun = req.query['refreshRun'];
    if (refreshRun !== undefined && (poll || typeof refreshRun !== 'string' || !MKTG_STARTED_RUN_ID_REGEX.test(refreshRun))) {
      next(this.invalidField(req, operation, 'refreshRun', 'refreshRun must name one run on an explicit detail read'));
      return;
    }
    const startTime = logger.startOperation(req, operation, { agent: params.type.agentKey, document: params.documentId });
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      const progress = await this.documentRuns.readProgress(req, project, params.type.agentKey, params.documentId, poll);
      const response = await this.documentRuns.detailWithProgress(
        req,
        project,
        params.type,
        params.documentId,
        () => this.documentStore.getDocument(req, project, params.type, params.documentId),
        progress,
        poll,
        typeof refreshRun === 'string' ? refreshRun : undefined
      );
      if (!response) {
        throw new ResourceNotFoundError('Marketing OS document', params.documentId, {
          operation,
          service: 'mktg_documents_controller',
          path: req.path,
          code: 'MKTG_DOCUMENT_NOT_FOUND',
        });
      }
      logger.success(req, operation, startTime, { project, revisions: response.revisions.length });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/mktg-agents/documents/:agentKey/:documentId/revisions/:revisionId?project=<uid> — one revision with its Markdown. */
  public async getRevision(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_revision_get';
    const params = this.readDocumentParams(req, req.query['project'], operation);
    if (params instanceof Error) {
      next(params);
      return;
    }
    const revisionId = this.readRevisionId(req.params['revisionId']);
    if (!revisionId) {
      next(this.invalidField(req, operation, 'revisionId', 'revisionId is not a revision id'));
      return;
    }

    const startTime = logger.startOperation(req, operation, { agent: params.type.agentKey, document: params.documentId });
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      const progress = await this.documentRuns.readProgress(req, project, params.type.agentKey, params.documentId, req.query['poll'] === '1');
      const revision = await this.documentStore.getRevision(req, project, params.type, params.documentId, revisionId);
      if (!revision) {
        await this.requireDocument(req, project, params.type, params.documentId, operation);
        throw new ResourceNotFoundError('Marketing OS document revision', revisionId, { operation, service: 'mktg_documents_controller', path: req.path });
      }
      logger.success(req, operation, startTime, { project, revision: revision.revision.number });
      res.json({ ...revision, ...progress });
    } catch (error) {
      next(error);
    }
  }

  /** POST …/revisions/:revisionId/approve?project=<uid> — approve the selected revision. */
  public async approveRevision(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_revision_approve';
    const params = this.readDocumentParams(req, req.query['project'], operation);
    if (params instanceof Error) {
      next(params);
      return;
    }
    const revisionId = this.readRevisionId(req.params['revisionId']);
    if (!revisionId) {
      next(this.invalidField(req, operation, 'revisionId', 'revisionId is required and must be a revision id'));
      return;
    }
    const startTime = logger.startOperation(req, operation, { agent: params.type.agentKey, document: params.documentId });
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      const revision = await this.documentStore.approveRevision(req, project, params.type, params.documentId, revisionId);
      if (!revision) {
        throw new ResourceNotFoundError('Marketing OS document revision', revisionId, { operation, service: 'mktg_documents_controller', path: req.path });
      }
      logger.success(req, operation, startTime, { project, revision: revision.revision.number });
      res.json(revision);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/documents/:agentKey/:documentId/restore — make an
   * revision current by moving its pointer. Body: `{ project, revisionId }`.
   */
  public async restoreRevision(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_revision_restore';
    const body = (req.body ?? {}) as Partial<MktgRestoreRevisionRequest>;
    const params = this.readDocumentParams(req, body.project, operation);
    if (params instanceof Error) {
      next(params);
      return;
    }
    const revisionId = this.readRevisionId(body.revisionId);
    if (!revisionId) {
      next(this.invalidField(req, operation, 'revisionId', 'revisionId is required and must be a revision id'));
      return;
    }

    const startTime = logger.startOperation(req, operation, { agent: params.type.agentKey, document: params.documentId });
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      const restored = await this.documentStore.restoreRevision(req, project, params.type, params.documentId, revisionId);
      if (!restored) {
        await this.requireDocument(req, project, params.type, params.documentId, operation);
        throw new ResourceNotFoundError('Marketing OS document revision', revisionId, { operation, service: 'mktg_documents_controller', path: req.path });
      }
      const response: MktgRestoreRevisionResponse = { ...restored.detail, revision: restored.revision };
      logger.success(req, operation, startTime, { project, revision: restored.revision.number });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** Recheck the exact recorded session; never create another generation. */
  public async retryRun(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_run_retry';
    const body = (req.body ?? {}) as Partial<MktgRetryDocumentRunRequest>;
    const params = this.readDocumentParams(req, body.project, operation);
    if (params instanceof Error) {
      next(params);
      return;
    }
    const runId = req.params['runId'];
    if (typeof runId !== 'string' || !MKTG_STARTED_RUN_ID_REGEX.test(runId)) {
      next(this.invalidField(req, operation, 'runId', 'runId must name a recorded run'));
      return;
    }
    const startTime = logger.startOperation(req, operation, {});
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      await this.documentRuns.retry(req, project, params.type.agentKey, params.documentId, runId);
      const progress = await this.documentRuns.readProgress(req, project, params.type.agentKey, params.documentId);
      const response = await this.documentRuns.detailWithProgress(
        req,
        project,
        params.type,
        params.documentId,
        () => this.documentStore.getDocument(req, project, params.type, params.documentId),
        progress
      );
      if (!response)
        throw new ResourceNotFoundError('Marketing OS document', params.documentId, {
          operation,
          service: 'mktg_documents_controller',
          path: req.path,
          code: 'MKTG_DOCUMENT_NOT_FOUND',
        });
      logger.success(req, operation, startTime, { project });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET .../comments?project=<uid>&revision=<id>; reads require the same writer grant as runs. */
  public async listComments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_document_comments_list';
    const params = this.readDocumentParams(req, req.query['project'], operation);
    if (params instanceof Error) {
      next(params);
      return;
    }
    const revisionId = this.readRevisionId(req.query['revision']);
    if (!revisionId) {
      next(this.invalidField(req, operation, 'revision', 'A revision id is required.'));
      return;
    }
    const started = logger.startOperation(req, operation, {});
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      const response = await this.comments.list(req, project, params.type, params.documentId, revisionId);
      logger.success(req, operation, started, { count: response.threads.length });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** POST .../comments; identity/time/passage are resolved by the server, never from the body. */
  public async addComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_document_comment_add';
    const body = req.body as Record<string, unknown> | null | undefined;
    const params = this.readDocumentParams(req, body?.['project'], operation);
    if (params instanceof Error) {
      next(params);
      return;
    }
    if (!this.readRevisionId(body?.['revisionId'])) {
      next(this.invalidField(req, operation, 'revisionId', 'A revision id is required.'));
      return;
    }
    const started = logger.startOperation(req, operation, {});
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      const response = await this.comments.add(req, project, params.type, params.documentId, body);
      logger.success(req, operation, started, { count: response.threads.length });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private async requireDocument(req: Request, project: string, type: MktgDocumentType, documentId: string, operation: string): Promise<void> {
    if (!(await this.documentStore.getDocument(req, project, type, documentId))) {
      throw new ResourceNotFoundError('Marketing OS document', documentId, {
        operation,
        service: 'mktg_documents_controller',
        path: req.path,
        code: 'MKTG_DOCUMENT_NOT_FOUND',
      });
    }
  }

  /** The project uid, document type and document id of a document route, or the validation error to send. */
  private readDocumentParams(
    req: Request,
    rawProject: unknown,
    operation: string
  ): { projectUid: string; type: MktgDocumentType; documentId: string } | ServiceValidationError {
    const projectUid = this.readProjectUid(rawProject);
    if (!projectUid) {
      return this.invalidProject(req, operation);
    }
    const type = findMktgDocumentType(String(req.params['agentKey'] ?? ''));
    if (!type) {
      return this.invalidField(req, operation, 'agentKey', 'agentKey is not a Marketing OS document type');
    }
    const documentId = String(req.params['documentId'] ?? '');
    if (!MKTG_DOCUMENT_ID_REGEX.test(documentId)) {
      return this.invalidField(req, operation, 'documentId', 'documentId is not a document id');
    }
    return { projectUid, type, documentId };
  }

  private readProjectUid(raw: unknown): string | null {
    const projectUid = typeof raw === 'string' ? raw.trim() : '';
    return projectUid && MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid) ? projectUid : null;
  }

  private readRevisionId(raw: unknown): string | null {
    return typeof raw === 'string' && MKTG_REVISION_ID_REGEX.test(raw) ? raw : null;
  }

  /**
   * Resolve the project WITH the caller's access annotation and require the
   * writer grant — the per-project write entitlement that gates the agents
   * that produce these documents. Returns the SERVER-resolved uid, which is
   * the only value that addresses storage.
   */
  private async resolveWritableProject(req: Request, projectUid: string, operation: string): Promise<string> {
    const project = await this.projectService.getProjectById(req, projectUid, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to use its Marketing OS documents.', {
        operation,
        service: 'mktg_documents_controller',
        path: req.path,
      });
    }
    return project.uid;
  }

  private invalidProject(req: Request, operation: string): ServiceValidationError {
    return this.invalidField(req, operation, 'project', 'project is required and must be a single-segment project uid');
  }

  private invalidField(req: Request, operation: string, field: string, message: string): ServiceValidationError {
    return ServiceValidationError.forField(field, message, { operation, service: 'mktg_documents_controller', path: req.path });
  }
}
