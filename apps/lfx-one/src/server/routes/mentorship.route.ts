// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipController } from '../controllers/mentorship.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const mentorshipController = new MentorshipController();

router.get('/programs/name-available', (req, res, next) => mentorshipController.isProgramNameAvailable(req, res, next));
router.get('/programs/:programId', (req, res, next) => mentorshipController.getProgram(req, res, next));
router.get('/programs', (req, res, next) => mentorshipController.getPrograms(req, res, next));
router.post('/programs', blockDuringImpersonation, (req, res, next) => mentorshipController.enrollProgram(req, res, next));
router.get('/lf-projects', (req, res, next) => mentorshipController.getLfProjects(req, res, next));
router.get('/invitable-users', (req, res, next) => mentorshipController.getInvitableUsers(req, res, next));
router.get('/cii/:projectId', (req, res, next) => mentorshipController.getCiiBadge(req, res, next));

export default router;
