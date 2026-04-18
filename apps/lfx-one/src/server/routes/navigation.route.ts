// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NavigationController } from '../controllers/navigation.controller';

const router = Router();
const navigationController = new NavigationController();

router.get('/lens-items', (req, res, next) => navigationController.getLensItems(req, res, next));

export default router;
