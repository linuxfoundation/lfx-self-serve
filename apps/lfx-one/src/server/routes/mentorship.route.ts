// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipController } from '../controllers/mentorship.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const mentorshipController = new MentorshipController();

router.get('/programs/name-available', (req, res, next) => mentorshipController.isProgramNameAvailable(req, res, next));
router.get('/mentor/programs', (req, res, next) => mentorshipController.getMentorPrograms(req, res, next));
router.get('/mentor/programs/:programId', (req, res, next) => mentorshipController.getMentorProgram(req, res, next));
router.get('/mentor/profile', (req, res, next) => mentorshipController.getMentorProfile(req, res, next));
router.get('/mentee/has-profile', (req, res, next) => mentorshipController.hasMenteeProfile(req, res, next));
router.get('/mentee/overview', (req, res, next) => mentorshipController.getMenteeOverview(req, res, next));
router.get('/mentee/tasks', (req, res, next) => mentorshipController.getMenteeTasks(req, res, next));
router.get('/mentee/profile', (req, res, next) => mentorshipController.getMenteeProfile(req, res, next));
router.get('/mentee/apply-target', (req, res, next) => mentorshipController.getMenteeApplyTarget(req, res, next));
router.get('/programs/:programId', (req, res, next) => mentorshipController.getProgram(req, res, next));
router.get('/programs', (req, res, next) => mentorshipController.getPrograms(req, res, next));
// Approve/reject email links. Proxied to the mentorship service with the caller's token.
router.get('/program-review/:programId', (req, res, next) => mentorshipController.getProgramReview(req, res, next));
// The decision is refused while impersonating: upstream would attribute it to the impersonated
// approver, and a published or rejected program cannot be moved back.
router.post('/program-review/:programId/decision', blockDuringImpersonation, (req, res, next) => mentorshipController.submitProgramDecision(req, res, next));
router.get('/lf-projects', (req, res, next) => mentorshipController.getLfProjects(req, res, next));
router.get('/invitable-users', (req, res, next) => mentorshipController.getInvitableUsers(req, res, next));
router.get('/cii/:projectId', (req, res, next) => mentorshipController.getCiiBadge(req, res, next));

export default router;
