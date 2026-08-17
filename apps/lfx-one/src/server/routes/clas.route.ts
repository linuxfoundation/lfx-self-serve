// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ClasController } from '../controllers/clas.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const clasController = new ClasController();

// Read-only "My CLAs" (Me lens). Feature gating is enforced Angular-side via the
// route guard + sidebar flag (T020), mirroring the crowdfunding module convention.
router.get('/clas', (req, res, next) => clasController.getMyClas(req, res, next));
router.get('/clas/:signatureId/pdf-url', (req, res, next) => clasController.getPdfUrl(req, res, next));

// Sign CLA hand-off (#1251). Selection is a read and stays available while impersonating; the
// hand-off is guarded, because starting a signature is a real, externally-visible act that would
// be attributed to the target rather than the impersonator who performed it. Registered before
// `/clas/:signatureId/pdf-url` would not matter (distinct final segments), but both sign routes
// are kept together so the guard is visible next to what it protects.
router.get('/clas/sign-options', (req, res, next) => clasController.getClaGroupOptions(req, res, next));
router.get('/clas/sign-handoff', blockDuringImpersonation, (req, res, next) => clasController.getSignHandoff(req, res, next));

export default router;
