// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipAdminController } from '../controllers/mentorship-admin.controller';

const router = Router();
const adminController = new MentorshipAdminController();

router.get('/programs', (req, res, next) => adminController.getPrograms(req, res, next));
router.get('/programs/:programId', (req, res, next) => adminController.getProgram(req, res, next));

export default router;
