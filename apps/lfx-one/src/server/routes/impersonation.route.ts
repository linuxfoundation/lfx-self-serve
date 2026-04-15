// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ImpersonationController } from '../controllers/impersonation.controller';

const router = Router();

const impersonationController = new ImpersonationController();

router.post('/', (req, res, next) => impersonationController.startImpersonation(req, res, next));
router.post('/stop', (req, res, next) => impersonationController.stopImpersonation(req, res, next));
router.get('/status', (req, res, next) => impersonationController.getImpersonationStatus(req, res, next));

export default router;
