// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { BadgesController } from '../controllers/badges.controller';

const router = Router();
const badgesController = new BadgesController();

router.get('/', (req, res, next) => badgesController.getBadges(req, res, next));

export default router;
