// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipController } from '../controllers/mentorship.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

import adminRouter from './mentorship-admin.route';
import menteeRouter from './mentorship-mentee.route';
import mentorRouter from './mentorship-mentor.route';
import taskRouter from './mentorship-task.route';

const router = Router();
const mentorshipController = new MentorshipController();

router.get('/programs/name-available', (req, res, next) => mentorshipController.isProgramNameAvailable(req, res, next));
router.use('/admin', adminRouter);
router.use('/mentor', mentorRouter);
router.use('/mentee', menteeRouter);
router.use('/tasks', taskRouter);
// Approve/reject email links. Proxied to the mentorship service with the caller's token.
router.get('/program-review/:programId', (req, res, next) => mentorshipController.getProgramReview(req, res, next));
// The decision is refused while impersonating: upstream would attribute it to the impersonated
// approver, and a published or rejected program cannot be moved back.
router.post('/program-review/:programId/decision', blockDuringImpersonation, (req, res, next) => mentorshipController.submitProgramDecision(req, res, next));
// Copies the LFX profile's name, email and logo onto the caller's mentor and mentee profiles. A
// write to the caller's own profiles, so it is refused while impersonating.
router.patch('/me/lfx-profile', blockDuringImpersonation, (req, res, next) => mentorshipController.syncLfxProfile(req, res, next));
router.get('/lf-projects', (req, res, next) => mentorshipController.getLfProjects(req, res, next));
router.get('/cii/:projectId', (req, res, next) => mentorshipController.getCiiBadge(req, res, next));

export default router;
