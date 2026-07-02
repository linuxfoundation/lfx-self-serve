// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Router } from 'express';

import { EnrollmentController } from '../controllers/enrollment.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const enrollmentController = new EnrollmentController();

router.get('/', (req, res, next) => enrollmentController.getEnrollments(req, res, next));
// Auto-renew resolves the member via the API-gateway `/me` token (the impersonator's), so a write
// during impersonation would modify the impersonator's own membership — block it.
router.patch('/:id/auto-renew', blockDuringImpersonation, (req, res, next) => enrollmentController.updateAutoRenew(req, res, next));

export default router;
