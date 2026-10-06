// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipAdminController } from '../controllers/mentorship-admin.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const adminController = new MentorshipAdminController();

router.get('/programs', (req, res, next) => adminController.getPrograms(req, res, next));
router.get('/programs/:programId', (req, res, next) => adminController.getProgram(req, res, next));
router.get('/programs/:programId/mentees', (req, res, next) => adminController.getProgramMentees(req, res, next));
router.get('/programs/:programId/mentors', (req, res, next) => adminController.getProgramMentors(req, res, next));
router.get('/programs/:programId/terms', (req, res, next) => adminController.getProgramTerms(req, res, next));
router.get('/applications/:applicationId/tasks', (req, res, next) => adminController.getApplicationTasks(req, res, next));
router.patch('/applications/:applicationId/status', blockDuringImpersonation, (req, res, next) => adminController.updateApplicationStatus(req, res, next));
router.put('/applications/:applicationId/note', blockDuringImpersonation, (req, res, next) => adminController.updateApplicationNote(req, res, next));
router.post('/applications/:applicationId/withdraw', blockDuringImpersonation, (req, res, next) => adminController.withdrawApplication(req, res, next));
router.post('/programs/:programId/terms/:termId/decline-pending', blockDuringImpersonation, (req, res, next) =>
  adminController.declinePendingForTerm(req, res, next)
);

export default router;
