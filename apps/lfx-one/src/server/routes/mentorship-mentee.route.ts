// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES, MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_CONTENT_TYPE } from '@lfx-one/shared/constants';
import express, { NextFunction, Request, Response, Router } from 'express';

import { MentorshipMenteeController } from '../controllers/mentorship-mentee.controller';
import { MicroserviceError } from '../errors';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

/**
 * Converts the raw body parser's size-limit error (`entity.too.large`) into a 413 before it reaches the global error handler,
 * which keeps the real statusCode only for BaseApiError instances and would otherwise flatten it into a 500. Mirrors
 * `mentorship-admin.route.ts`'s `handleMentorshipLogoParseError`.
 */
function handleTaskFileParseError(err: unknown, req: Request, _res: Response, next: NextFunction): void {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    next(
      new MicroserviceError('File exceeds 20 MB', 413, 'PAYLOAD_TOO_LARGE', {
        operation: 'upload_mentorship_mentee_task_file',
        service: 'mentorship_mentee_controller',
        path: req.path,
      })
    );
    return;
  }
  next(err);
}

const router = Router();
const menteeController = new MentorshipMenteeController();

router.get('/has-profile', (req, res, next) => menteeController.hasMenteeProfile(req, res, next));
// Refused while impersonating: upstream would create/replace the impersonated user's profile.
router.post('/profile', blockDuringImpersonation, (req, res, next) => menteeController.registerMenteeProfile(req, res, next));
router.get('/applications', (req, res, next) => menteeController.getMenteeApplications(req, res, next));
// Refused while impersonating: upstream would withdraw the impersonated mentee's application.
router.post('/applications/:applicationId/withdraw', blockDuringImpersonation, (req, res, next) => menteeController.withdrawMenteeApplication(req, res, next));
// Refused while impersonating: upstream would change the impersonated mentee's task.
router.patch('/tasks/:taskId', blockDuringImpersonation, (req, res, next) => menteeController.updateMenteeTaskStatus(req, res, next));
// Refused while impersonating: upstream would change the impersonated mentee's submission file. The bytes are buffered
// (at most 20 MB) and re-sent upstream as multipart, so the mentorship provisioning retry still applies.
router.post(
  '/tasks/:taskId/file',
  blockDuringImpersonation,
  express.raw({ type: MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_CONTENT_TYPE, limit: MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES }),
  handleTaskFileParseError,
  (req: Request, res: Response, next: NextFunction) => menteeController.uploadMenteeTaskFile(req, res, next)
);
router.delete('/tasks/:taskId/file', blockDuringImpersonation, (req, res, next) => menteeController.deleteMenteeTaskFile(req, res, next));
router.get('/profile', (req, res, next) => menteeController.getMenteeProfile(req, res, next));
// Refused while impersonating: upstream would rewrite the impersonated mentee's profile.
router.patch('/profile', blockDuringImpersonation, (req, res, next) => menteeController.updateMenteeProfile(req, res, next));
router.get('/apply-target', (req, res, next) => menteeController.getMenteeApplyTarget(req, res, next));
// Refused while impersonating: upstream would file the application as the impersonated user.
router.post('/apply', blockDuringImpersonation, (req, res, next) => menteeController.applyToMenteeTerm(req, res, next));

export default router;
