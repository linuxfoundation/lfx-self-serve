// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX, MKTG_DOCUMENT_ID_REGEX, MKTG_REVISION_ID_REGEX } from '@lfx-one/shared/constants';
import { MktgDocumentType, MktgRestoreRevisionRequest, MktgRestoreRevisionResponse } from '@lfx-one/shared/interfaces';
import { findMktgDocumentType } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MktgDocumentStoreService } from '../services/mktg-document-store.service';
import { ProjectService } from '../services/project.service';

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
      const documents = await this.documentStore.listDocuments(req, project);
      logger.success(req, operation, startTime, { project, groups: documents.groups.length });
      res.json(documents);
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

    const startTime = logger.startOperation(req, operation, { agent: params.type.agentKey, document: params.documentId });
    try {
      const project = await this.resolveWritableProject(req, params.projectUid, operation);
      const detail = await this.documentStore.getDocument(req, project, params.type, params.documentId);
      if (!detail) {
        throw new ResourceNotFoundError('Marketing OS document', params.documentId, {
          operation,
          service: 'mktg_documents_controller',
          path: req.path,
          code: 'MKTG_DOCUMENT_NOT_FOUND',
        });
      }
      logger.success(req, operation, startTime, { project, revisions: detail.revisions.length });
      res.json(detail);
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
      const revision = await this.documentStore.getRevision(req, project, params.type, params.documentId, revisionId);
      if (!revision) {
        await this.requireDocument(req, project, params.type, params.documentId, operation);
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
