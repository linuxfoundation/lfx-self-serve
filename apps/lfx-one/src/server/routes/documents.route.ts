// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { DocumentController } from '../controllers/document.controller';

const router = Router();

const documentController = new DocumentController();

// GET /documents - get all documents for the current user
router.get('/', (req, res, next) => documentController.getMyDocuments(req, res, next));

export default router;
