// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_ENROLL_LOGO_MAX_BYTES, MENTORSHIP_ENROLL_LOGO_MIME_TYPES } from '@lfx-one/shared/constants';
import express, { NextFunction, Request, Response, Router } from 'express';

import { MentorshipAdminController } from '../controllers/mentorship-admin.controller';
import { MicroserviceError } from '../errors';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

/**
 * Converts the raw body parser's size-limit error (`entity.too.large`) into a 413 before it reaches the global error handler,
 * which keeps the real statusCode only for BaseApiError instances and would otherwise flatten it into a 500. Mirrors
 * `orgs.route.ts`'s `handleLogoUploadParseError`.
 */
function handleMentorshipLogoParseError(err: unknown, req: Request, _res: Response, next: NextFunction): void {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    next(
      new MicroserviceError('Logo exceeds the maximum upload size', 413, 'PAYLOAD_TOO_LARGE', {
        operation: 'upload_mentorship_program_logo',
        service: 'mentorship_admin_controller',
        path: req.path,
      })
    );
    return;
  }
  next(err);
}

const router = Router();
const adminController = new MentorshipAdminController();

router.get('/programs', (req, res, next) => adminController.getPrograms(req, res, next));
router.get('/programs/:programId', (req, res, next) => adminController.getProgram(req, res, next));
router.get('/programs/:programId/enroll-template', (req, res, next) => adminController.getEnrollTemplate(req, res, next));
router.get('/programs/:programId/mentees', (req, res, next) => adminController.getProgramMentees(req, res, next));
router.get('/programs/:programId/mentors', (req, res, next) => adminController.getProgramMentors(req, res, next));
router.get('/programs/:programId/mentor-candidates', (req, res, next) => adminController.getMentorCandidates(req, res, next));
router.get('/programs/:programId/terms', (req, res, next) => adminController.getProgramTerms(req, res, next));
router.get('/applications/:applicationId/tasks', (req, res, next) => adminController.getApplicationTasks(req, res, next));
router.patch('/applications/:applicationId/status', blockDuringImpersonation, (req, res, next) => adminController.updateApplicationStatus(req, res, next));
router.put('/applications/:applicationId/note', blockDuringImpersonation, (req, res, next) => adminController.updateApplicationNote(req, res, next));
router.post('/applications/:applicationId/withdraw', blockDuringImpersonation, (req, res, next) => adminController.withdrawApplication(req, res, next));
router.post('/tasks', blockDuringImpersonation, (req, res, next) => adminController.createTasks(req, res, next));
router.patch('/tasks/:taskId', blockDuringImpersonation, (req, res, next) => adminController.updateTask(req, res, next));
router.post('/programs/:programId/mentors', blockDuringImpersonation, (req, res, next) => adminController.inviteProgramMentor(req, res, next));
router.patch('/programs/:programId/mentors/:memberId', blockDuringImpersonation, (req, res, next) => adminController.updateProgramMentor(req, res, next));
router.post('/programs/:programId/terms/:termId/decline-pending', blockDuringImpersonation, (req, res, next) =>
  adminController.declinePendingForTerm(req, res, next)
);
router.post('/programs', blockDuringImpersonation, (req, res, next) => adminController.createProgram(req, res, next));
router.patch('/programs/:programId', blockDuringImpersonation, (req, res, next) => adminController.updateProgram(req, res, next));
router.post(
  '/programs/:programId/logo',
  blockDuringImpersonation,
  express.raw({ type: [...MENTORSHIP_ENROLL_LOGO_MIME_TYPES], limit: MENTORSHIP_ENROLL_LOGO_MAX_BYTES }),
  handleMentorshipLogoParseError,
  (req: Request, res: Response, next: NextFunction) => adminController.uploadProgramLogo(req, res, next)
);
router.post('/programs/:programId/terms', blockDuringImpersonation, (req, res, next) => adminController.createTerm(req, res, next));
router.patch('/programs/:programId/terms/:termId', blockDuringImpersonation, (req, res, next) => adminController.updateTerm(req, res, next));
router.post('/programs/:programId/terms/:termId/close', blockDuringImpersonation, (req, res, next) => adminController.closeTerm(req, res, next));
router.post('/programs/:programId/terms/:termId/reopen', blockDuringImpersonation, (req, res, next) => adminController.reopenTerm(req, res, next));
router.delete('/programs/:programId/terms/:termId', blockDuringImpersonation, (req, res, next) => adminController.deleteTerm(req, res, next));

export default router;
