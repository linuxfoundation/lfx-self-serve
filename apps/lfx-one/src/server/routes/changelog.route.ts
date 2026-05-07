// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ChangelogController } from '../controllers/changelog.controller';

const router = Router();
const changelogController = new ChangelogController();

router.get('/unseen', (req, res, next) => changelogController.getUnseenCount(req, res, next));
router.post('/mark-viewed', (req, res, next) => changelogController.markViewed(req, res, next));

export default router;
