// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MktgAgentsController } from '../controllers/mktg-agents.controller';
import { MktgDocumentsController } from '../controllers/mktg-documents.controller';

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

// POST /api/mktg-agents/foundation-message/generate - start a one-shot form-mode Message Foundation generation
router.post('/foundation-message/generate', (req, res, next) => mktgAgentsController.generateFoundationMessage(req, res, next));

// POST /api/mktg-agents/foundation-message/result - poll a generation session for the validated document
router.post('/foundation-message/result', (req, res, next) => mktgAgentsController.foundationMessageResult(req, res, next));

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

// POST /api/mktg-agents/documents/:agentKey/:documentId/restore - make an older revision the latest, as a new revision
router.post('/documents/:agentKey/:documentId/restore', (req, res, next) => mktgDocumentsController.restoreRevision(req, res, next));

export default router;
