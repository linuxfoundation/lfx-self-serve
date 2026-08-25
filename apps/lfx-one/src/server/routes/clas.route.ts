// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ClasController } from '../controllers/clas.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const clasController = new ClasController();

// Read-only "CLAs" (Me lens). Feature gating is enforced Angular-side via the
// route guard + sidebar flag (T020), mirroring the crowdfunding module convention.
router.get('/clas', (req, res, next) => clasController.getMyClas(req, res, next));
router.get('/clas/:signatureId/pdf-url', (req, res, next) => clasController.getPdfUrl(req, res, next));
router.get('/clas/:signatureId/cla-managers', (req, res, next) => clasController.getClaManagers(req, res, next));
router.post('/clas/:signatureId/cla-manager-requests', blockDuringImpersonation, (req, res, next) => clasController.createClaManagerRequest(req, res, next));

// Sign CLA hand-off (#1251). Project selection is a read and stays available while
// impersonating.
router.get('/clas/sign-options', (req, res, next) => clasController.getClaGroupOptions(req, res, next));

// GitHub account selection before the hand-off (#1252). Listing the linked accounts is a
// read and stays available while impersonating; preparing the signing session is guarded, and
// more plainly than the hand-off is — this route causes an identity attribute and a signing
// session to be written against an EasyCLA record, which is literally the hard-to-retract,
// externally-visible act with no in-payload caller identity that the read-only rule exists for.
router.get('/clas/github-accounts', (req, res, next) => clasController.getGithubAccounts(req, res, next));
router.post('/clas/prepare-sign', blockDuringImpersonation, (req, res, next) => clasController.prepareSign(req, res, next));

export default router;
