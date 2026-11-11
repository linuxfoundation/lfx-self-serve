// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ImpersonationController } from '../controllers/impersonation.controller';
import { impersonationSearchRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

const impersonationController = new ImpersonationController();

router.post('/', (req, res, next) => impersonationController.startImpersonation(req, res, next));
// A POST so the searched name or email travels in the body: a GET puts it in the URL, which request logs, error logs,
// browser analytics and traces all record.
router.post('/users/search', impersonationSearchRateLimiter, (req, res, next) => impersonationController.searchUsers(req, res, next));
router.post('/stop', (req, res, next) => impersonationController.stopImpersonation(req, res, next));
router.get('/status', (req, res, next) => impersonationController.getImpersonationStatus(req, res, next));

export default router;
