// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE, FOUNDATION_MESSAGE_MAX_FILE_BYTES } from '@lfx-one/shared/constants';
import express, { NextFunction, Request, Response, Router } from 'express';

import { MktgAgentsController } from '../controllers/mktg-agents.controller';
import { MktgDocumentsController } from '../controllers/mktg-documents.controller';
import { MicroserviceError } from '../errors';

/**
 * Converts the raw body parser's size-limit error (`entity.too.large`) into a 413 before it reaches
 * the global error handler, which would otherwise flatten it into a 500. Mirrors
 * `mentorship-mentee.route.ts`'s `handleTaskFileParseError`.
 */
function handleDocumentFileParseError(err: unknown, req: Request, _res: Response, next: NextFunction): void {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    next(
      new MicroserviceError('File exceeds 20 MB', 413, 'PAYLOAD_TOO_LARGE', {
        operation: 'foundation_message_read_file',
        service: 'mktg_agents_controller',
        path: req.path,
      })
    );
    return;
  }
  next(err);
}

const router = Router();
const mktgAgentsController = new MktgAgentsController();
const mktgDocumentsController = new MktgDocumentsController();

// POST /api/mktg-agents/chat - create a Guild session or post a follow-up
router.post('/chat', (req, res, next) => mktgAgentsController.chat(req, res, next));

// POST /api/mktg-agents/history - fetch mapped session history (owner-token in body)
router.post('/history', (req, res, next) => mktgAgentsController.history(req, res, next));

// POST /api/mktg-agents/brand-kit/generate - start a one-shot form-mode Brand Kit generation
router.post('/brand-kit/generate', (req, res, next) => mktgAgentsController.generateBrandKit(req, res, next));

// POST /api/mktg-agents/brand-kit/result - poll a generation session for the validated document
router.post('/brand-kit/result', (req, res, next) => mktgAgentsController.brandKitResult(req, res, next));

// GET /api/mktg-agents/brand-kit/stored - the project's latest persisted document (writer-entitled callers only)
router.get('/brand-kit/stored', (req, res, next) => mktgAgentsController.storedBrandKit(req, res, next));

// POST /api/mktg-agents/foundation-message/generate - start a one-shot Messaging Document generation
router.post('/foundation-message/generate', (req, res, next) => mktgAgentsController.generateFoundationMessage(req, res, next));

// POST /api/mktg-agents/foundation-message/result - poll a generation session for the validated document
router.post('/foundation-message/result', (req, res, next) => mktgAgentsController.foundationMessageResult(req, res, next));

// POST /api/mktg-agents/foundation-message/documents/file - read one uploaded existing document to text (raw body, at most 20 MB)
router.post(
  '/foundation-message/documents/file',
  express.raw({ type: FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE, limit: FOUNDATION_MESSAGE_MAX_FILE_BYTES }),
  handleDocumentFileParseError,
  (req: Request, res: Response, next: NextFunction) => mktgAgentsController.readFoundationMessageFile(req, res, next)
);

// POST /api/mktg-agents/foundation-message/answers - answer the session's questions turn (owner-token in body), on the same session
router.post('/foundation-message/answers', (req, res, next) => mktgAgentsController.foundationMessageAnswers(req, res, next));

// POST /api/mktg-agents/icp/generate - start a one-shot form-mode ICP & Target Markets generation
router.post('/icp/generate', (req, res, next) => mktgAgentsController.generateIcp(req, res, next));

// POST /api/mktg-agents/icp/result - poll a generation session for the validated document
router.post('/icp/result', (req, res, next) => mktgAgentsController.icpResult(req, res, next));

// GET /api/mktg-agents/foundation-message/stored - the project's latest persisted document (writer-entitled callers only)
router.get('/foundation-message/stored', (req, res, next) => mktgAgentsController.storedFoundationMessage(req, res, next));

// GET /api/mktg-agents/documents?project=<uid> - every stored Marketing OS document of the project, grouped by type (writer-entitled callers only)
router.get('/documents', (req, res, next) => mktgDocumentsController.listDocuments(req, res, next));

// GET /api/mktg-agents/documents/:agentKey/:documentId?project=<uid> - one document and its revisions, newest first
router.get('/documents/:agentKey/:documentId', (req, res, next) => mktgDocumentsController.getDocument(req, res, next));

// GET /api/mktg-agents/documents/:agentKey/:documentId/revisions/:revisionId?project=<uid> - one revision with its Markdown
router.get('/documents/:agentKey/:documentId/revisions/:revisionId', (req, res, next) => mktgDocumentsController.getRevision(req, res, next));

// POST — retry checking an existing server-recorded session, never start a new one.
router.post('/documents/:agentKey/:documentId/runs/:runId/retry', (req, res, next) => mktgDocumentsController.retryRun(req, res, next));

// POST /api/mktg-agents/documents/:agentKey/:documentId/restore - make an older revision the latest, as a new revision
router.post('/documents/:agentKey/:documentId/restore', (req, res, next) => mktgDocumentsController.restoreRevision(req, res, next));

export default router;
