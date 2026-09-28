// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipMenteeController } from '../controllers/mentorship-mentee.controller';

const router = Router();
const menteeController = new MentorshipMenteeController();

router.get('/has-profile', (req, res, next) => menteeController.hasMenteeProfile(req, res, next));
router.get('/overview', (req, res, next) => menteeController.getMenteeOverview(req, res, next));
router.get('/tasks', (req, res, next) => menteeController.getMenteeTasks(req, res, next));
router.get('/profile', (req, res, next) => menteeController.getMenteeProfile(req, res, next));
router.get('/apply-target', (req, res, next) => menteeController.getMenteeApplyTarget(req, res, next));

export default router;
