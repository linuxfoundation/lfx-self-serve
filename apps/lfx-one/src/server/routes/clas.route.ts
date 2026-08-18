// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ClasController } from '../controllers/clas.controller';

const router = Router();
const clasController = new ClasController();

// Read-only "CLAs" (Me lens). Feature gating is enforced Angular-side via the
// route guard + sidebar flag (T020), mirroring the crowdfunding module convention.
router.get('/clas', (req, res, next) => clasController.getMyClas(req, res, next));
router.get('/clas/:signatureId/pdf-url', (req, res, next) => clasController.getPdfUrl(req, res, next));

export default router;
