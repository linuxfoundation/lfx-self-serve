// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { DocumentController } from '../controllers/document.controller';

const router = Router();

const documentController = new DocumentController();

// GET /documents/download?url=<encoded>&filename=<name> - proxy-download a file
router.get('/download', (req, res, next) => documentController.downloadFile(req, res, next));

// GET /documents/count?committee_uid=<uid> - count the documents a group's Documents tab lists
router.get('/count', (req, res, next) => documentController.getCommitteeDocumentCount(req, res, next));

// GET /documents - get all documents for the current user
router.get('/', (req, res, next) => documentController.getMyDocuments(req, res, next));

export default router;
