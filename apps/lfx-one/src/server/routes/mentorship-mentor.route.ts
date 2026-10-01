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
router.get('/open-programs', (req, res, next) => mentorController.getOpenPrograms(req, res, next));
router.get('/requests', (req, res, next) => mentorController.getMentorRequests(req, res, next));
// Refused while impersonating: upstream would ask to join a program, or withdraw a request, as the impersonated user.
router.post('/requests', blockDuringImpersonation, (req, res, next) => mentorController.requestToMentor(req, res, next));
router.post('/requests/:requestId/withdraw', blockDuringImpersonation, (req, res, next) => mentorController.withdrawMentorRequest(req, res, next));
// Refused while impersonating: upstream would answer the impersonated user's mentor invitation.
router.post('/invites/accept', blockDuringImpersonation, (req, res, next) => mentorController.acceptMentorInvite(req, res, next));
router.post('/invites/decline', blockDuringImpersonation, (req, res, next) => mentorController.declineMentorInvite(req, res, next));
router.get('/programs', (req, res, next) => mentorController.getMentorPrograms(req, res, next));
router.get('/programs/:programId', (req, res, next) => mentorController.getMentorProgram(req, res, next));
router.get('/profile', (req, res, next) => mentorController.getMentorProfile(req, res, next));
// Refused while impersonating: upstream would edit the impersonated user's profile.
router.patch('/profile', blockDuringImpersonation, (req, res, next) => mentorController.updateMentorProfile(req, res, next));

export default router;
