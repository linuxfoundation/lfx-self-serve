// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicGroupsController } from '../controllers/public-groups.controller';

const router = Router();
const publicGroupsController = new PublicGroupsController();

router.get('/:id', (req, res, next) => publicGroupsController.getPublicGroupById(req, res, next));

export default router;
