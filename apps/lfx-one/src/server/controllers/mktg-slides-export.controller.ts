// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_REVISION_ID_REGEX,
  MKTG_SLIDES_EXPORT_MODES,
  MKTG_SLIDES_EXPORT_SHA256_REGEX,
} from '@lfx-one/shared/constants';
import {
  MktgDocumentType,
  MktgSlidesExportAgentKey,
  MktgSlidesExportMode,
  MktgSlidesExportResultRequest,
  MktgSlidesExportStartRequest,
  MktgSlidesExportStartResponse,
} from '@lfx-one/shared/interfaces';
import { findMktgDocumentType, isMktgSlidesExportAgentKey } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MktgSlidesExportService } from '../services/mktg-slides-export.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

/**
 * Export to Google Slides for the Marketing OS asset pages (the Messaging
 * Framework and the Brand Kit): start an export, poll it, and read a
 * document's last export.
 *
 * AUTHZ — the Documents area's boundary: the caller must hold the writer
 * grant on the requested project, and storage is addressed by the
 * SERVER-resolved project uid, never client input. Every path-forming value
 * is shape-gated first. The asset is read from the store, never taken from
 * the browser, and so is the logo the deck carries (the server draws the
 * stored kit's own SVG); the deck an update refreshes comes from the stored
 * export record. The owner token binds the session to its creator AND to the
 * revision it exports, so a poll cannot file the deck under another
 * revision.
 */
export class MktgSlidesExportController {
  private readonly exportService = new MktgSlidesExportService();
  private readonly projectService = new ProjectService();

  /** POST /api/mktg-agents/slides-export/start — start an export of a stored revision. */
  public async start(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_slides_export_start';
    const body = (req.body ?? {}) as Partial<MktgSlidesExportStartRequest>;
    const target = this.readTarget(req, body, operation);
    if (target instanceof Error) {
      next(target);
      return;
    }
    if (!(MKTG_SLIDES_EXPORT_MODES as readonly unknown[]).includes(body.mode)) {
      next(this.invalidField(req, operation, 'mode', `mode must be one of ${MKTG_SLIDES_EXPORT_MODES.join(', ')}`));
      return;
    }
    const userId = getEffectiveUsername(req);
    if (!userId) {
      next(new AuthenticationError('Could not identify the requesting user.', { operation, service: 'mktg_slides_export_controller', path: req.path }));
      return;
    }

    const mode = body.mode as MktgSlidesExportMode;
    const startTime = logger.startOperation(req, operation, { agent: target.agentKey, mode });
    try {
      const project = await this.resolveWritableProject(req, target.projectUid, operation);
      const started = await this.exportService.startExport(req, {
        project: project.uid,
        projectName: project.name,
        type: target.type,
        agentKey: target.agentKey,
        documentId: target.documentId,
        selector: { revisionId: target.revisionId, contentSha256: target.contentSha256 },
        mode,
      });
      const binding = this.binding(started.sessionId, target.projectUid, target.agentKey, target.documentId, started.revision.id);
      const response: MktgSlidesExportStartResponse = { ...started, ownerToken: createSessionOwnerToken(userId, binding) };
      logger.success(req, operation, startTime, { revision: started.revision.number, logo_note: started.logoNote });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/mktg-agents/slides-export/result — poll an export; a ready one is kept with the revision it was made from. */
  public async result(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_slides_export_result';
    const body = (req.body ?? {}) as Partial<MktgSlidesExportResultRequest>;
    const target = this.readTarget(req, body, operation);
    if (target instanceof Error) {
      next(target);
      return;
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId) {
      next(this.invalidField(req, operation, 'sessionId', 'sessionId is required and must be a non-empty string'));
      return;
    }
    if (!target.revisionId) {
      next(this.invalidField(req, operation, 'revisionId', 'revisionId is required: the revision the export was started for'));
      return;
    }
    const userId = getEffectiveUsername(req);
    if (!userId) {
      next(new AuthenticationError('Could not identify the requesting user.', { operation, service: 'mktg_slides_export_controller', path: req.path }));
      return;
    }
    const ownerToken = typeof body.ownerToken === 'string' && body.ownerToken ? body.ownerToken : undefined;
    const binding = this.binding(sessionId, target.projectUid, target.agentKey, target.documentId, target.revisionId);
    if (!verifySessionOwnerToken(ownerToken, userId, binding)) {
      next(new AuthorizationError('You do not have permission to read this export.', { operation, service: 'mktg_slides_export_controller', path: req.path }));
      return;
    }

    const startTime = logger.startOperation(req, operation, { agent: target.agentKey });
    try {
      const project = await this.resolveWritableProject(req, target.projectUid, operation);
      const result = await this.exportService.getResult(req, sessionId, {
        project: project.uid,
        type: target.type,
        agentKey: target.agentKey,
        documentId: target.documentId,
        revisionId: target.revisionId,
      });
      logger.success(req, operation, startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/mktg-agents/slides-export/last?project=&agentKey=&documentId= — the document's last export and latest revision. */
  public async last(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_slides_export_last';
    const target = this.readTarget(req, { project: req.query['project'], agentKey: req.query['agentKey'], documentId: req.query['documentId'] }, operation);
    if (target instanceof Error) {
      next(target);
      return;
    }

    const startTime = logger.startOperation(req, operation, { agent: target.agentKey });
    try {
      const project = await this.resolveWritableProject(req, target.projectUid, operation);
      const last = await this.exportService.getLast(req, project.uid, target.type, target.agentKey, target.documentId);
      logger.success(req, operation, startTime, { has_export: !!last.last });
      res.json(last);
    } catch (error) {
      next(error);
    }
  }

  /** The project, document and revision an export names, shape-gated, or the validation error to send. */
  private readTarget(
    req: Request,
    raw: { project?: unknown; agentKey?: unknown; documentId?: unknown; revisionId?: unknown; contentSha256?: unknown },
    operation: string
  ):
    | { projectUid: string; agentKey: MktgSlidesExportAgentKey; type: MktgDocumentType; documentId: string; revisionId?: string; contentSha256?: string }
    | ServiceValidationError {
    const projectUid = typeof raw.project === 'string' ? raw.project.trim() : '';
    if (!projectUid || !MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid)) {
      return this.invalidField(req, operation, 'project', 'project is required and must be a single-segment project uid');
    }
    const type = isMktgSlidesExportAgentKey(raw.agentKey) ? findMktgDocumentType(raw.agentKey) : undefined;
    if (!type || !isMktgSlidesExportAgentKey(raw.agentKey)) {
      return this.invalidField(req, operation, 'agentKey', 'agentKey must be a document that exports to Google Slides');
    }
    if (typeof raw.documentId !== 'string' || !MKTG_DOCUMENT_ID_REGEX.test(raw.documentId)) {
      return this.invalidField(req, operation, 'documentId', 'documentId is not a document id');
    }
    if (raw.revisionId !== undefined && (typeof raw.revisionId !== 'string' || !MKTG_REVISION_ID_REGEX.test(raw.revisionId))) {
      return this.invalidField(req, operation, 'revisionId', 'revisionId is not a revision id');
    }
    if (raw.contentSha256 !== undefined && (typeof raw.contentSha256 !== 'string' || !MKTG_SLIDES_EXPORT_SHA256_REGEX.test(raw.contentSha256))) {
      return this.invalidField(req, operation, 'contentSha256', 'contentSha256 must be 64 lowercase hex characters');
    }
    return {
      projectUid,
      agentKey: raw.agentKey,
      type,
      documentId: raw.documentId,
      revisionId: raw.revisionId as string | undefined,
      contentSha256: raw.contentSha256 as string | undefined,
    };
  }

  /**
   * Resolve the project WITH the caller's access annotation and require the
   * writer grant. Returns the SERVER-resolved uid, the only value that
   * addresses storage, and the name the deck is titled with.
   */
  private async resolveWritableProject(req: Request, projectUid: string, operation: string): Promise<{ uid: string; name: string }> {
    const project = await this.projectService.getProjectById(req, projectUid, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to export its Marketing OS documents.', {
        operation,
        service: 'mktg_slides_export_controller',
        path: req.path,
      });
    }
    return { uid: project.uid, name: project.name ?? '' };
  }

  /** What the owner token signs besides the user: the session and the exact revision it exports. */
  private binding(sessionId: string, project: string, agentKey: string, documentId: string, revisionId: string): string {
    return ['slides-export', sessionId, project, agentKey, documentId, revisionId].join('|');
  }

  private invalidField(req: Request, operation: string, field: string, message: string): ServiceValidationError {
    return ServiceValidationError.forField(field, message, { operation, service: 'mktg_slides_export_controller', path: req.path });
  }
}
