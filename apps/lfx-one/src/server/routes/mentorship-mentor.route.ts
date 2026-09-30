// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipMentorController } from '../controllers/mentorship-mentor.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const mentorController = new MentorshipMentorController();

router.get('/has-profile', (req, res, next) => mentorController.hasMentorProfile(req, res, next));
// Refused while impersonating: upstream would create/replace the impersonated user's profile.
router.post('/profile', blockDuringImpersonation, (req, res, next) => mentorController.registerMentorProfile(req, res, next));
router.get('/programs', (req, res, next) => mentorController.getMentorPrograms(req, res, next));
router.get('/programs/:programId', (req, res, next) => mentorController.getMentorProgram(req, res, next));
router.get('/profile', (req, res, next) => mentorController.getMentorProfile(req, res, next));

export default router;
