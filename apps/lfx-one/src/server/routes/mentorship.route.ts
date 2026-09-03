// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipController } from '../controllers/mentorship.controller';

const router = Router();
const mentorshipController = new MentorshipController();

router.get('/programs', (req, res, next) => mentorshipController.getPrograms(req, res, next));

export default router;
