// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipMenteeController } from '../controllers/mentorship-mentee.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const menteeController = new MentorshipMenteeController();

router.get('/has-profile', (req, res, next) => menteeController.hasMenteeProfile(req, res, next));
router.get('/applications', (req, res, next) => menteeController.getMenteeApplications(req, res, next));
// Refused while impersonating: upstream would withdraw the impersonated mentee's application.
router.post('/applications/:applicationId/withdraw', blockDuringImpersonation, (req, res, next) => menteeController.withdrawMenteeApplication(req, res, next));
// Refused while impersonating: upstream would change the impersonated mentee's task.
router.patch('/tasks/:taskId', blockDuringImpersonation, (req, res, next) => menteeController.updateMenteeTaskStatus(req, res, next));
router.get('/profile', (req, res, next) => menteeController.getMenteeProfile(req, res, next));
// Refused while impersonating: upstream would rewrite the impersonated mentee's profile.
router.patch('/profile', blockDuringImpersonation, (req, res, next) => menteeController.updateMenteeProfile(req, res, next));
router.get('/apply-target', (req, res, next) => menteeController.getMenteeApplyTarget(req, res, next));
// Refused while impersonating: upstream would file the application as the impersonated user.
router.post('/apply', blockDuringImpersonation, (req, res, next) => menteeController.applyToMenteeTerm(req, res, next));

export default router;
