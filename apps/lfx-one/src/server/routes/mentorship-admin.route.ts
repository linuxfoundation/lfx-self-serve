// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipAdminController } from '../controllers/mentorship-admin.controller';

const router = Router();
const adminController = new MentorshipAdminController();

router.get('/programs', (req, res, next) => adminController.getPrograms(req, res, next));
router.get('/programs/:programId', (req, res, next) => adminController.getProgram(req, res, next));
router.get('/programs/:programId/mentees', (req, res, next) => adminController.getProgramMentees(req, res, next));
router.get('/programs/:programId/mentors', (req, res, next) => adminController.getProgramMentors(req, res, next));
router.get('/programs/:programId/terms', (req, res, next) => adminController.getProgramTerms(req, res, next));
router.get('/applications/:applicationId/tasks', (req, res, next) => adminController.getApplicationTasks(req, res, next));

export default router;
