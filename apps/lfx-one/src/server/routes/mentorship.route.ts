// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_ENROLL_LOGO_MAX_BYTES, MENTORSHIP_LOGO_MIME_TYPES } from '@lfx-one/shared/constants';
import express, { NextFunction, Request, Response, Router } from 'express';

import { MentorshipController } from '../controllers/mentorship.controller';
import { MicroserviceError } from '../errors';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const mentorshipController = new MentorshipController();

/**
 * `express.raw` rejects an oversized body with a generic `entity.too.large` error that would reach
 * the global handler as a 500. Translate it into the 413 the client can act on — same pattern as
 * `handlePictureUploadParseError` in `profile.route.ts`.
 */
function handleLogoUploadParseError(err: unknown, req: Request, _res: Response, next: NextFunction): void {
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    next(
      new MicroserviceError('Image exceeds the maximum upload size', 413, 'PAYLOAD_TOO_LARGE', {
        operation: 'upload_mentorship_program_logo',
        service: 'mentorship_controller',
        path: req.path,
      })
    );
    return;
  }
  next(err);
}

router.get('/programs/name-available', (req, res, next) => mentorshipController.isProgramNameAvailable(req, res, next));
router.get('/programs/:programId', (req, res, next) => mentorshipController.getProgram(req, res, next));
router.get('/programs', (req, res, next) => mentorshipController.getPrograms(req, res, next));
router.post('/programs', (req, res, next) => mentorshipController.enrollProgram(req, res, next));
// Body is the raw image bytes (not multipart), mirroring POST /api/profile/picture-upload.
router.post(
  '/programs/:programId/logo',
  blockDuringImpersonation,
  express.raw({ type: [...MENTORSHIP_LOGO_MIME_TYPES], limit: MENTORSHIP_ENROLL_LOGO_MAX_BYTES }),
  handleLogoUploadParseError,
  (req: Request, res: Response, next: NextFunction) => mentorshipController.uploadProgramLogo(req, res, next)
);
router.get('/lf-projects', (req, res, next) => mentorshipController.getLfProjects(req, res, next));
router.get('/cii/:projectId', (req, res, next) => mentorshipController.getCiiBadge(req, res, next));

export default router;
