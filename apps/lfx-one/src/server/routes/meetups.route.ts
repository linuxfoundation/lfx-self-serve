// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MeetupsController } from '../controllers/meetups.controller';

const router = Router();
const meetupsController = new MeetupsController();

router.get('/', (req, res, next) => meetupsController.getMyMeetups(req, res, next));
router.get('/filters', (req, res, next) => meetupsController.getMeetupFilters(req, res, next));

export default router;
