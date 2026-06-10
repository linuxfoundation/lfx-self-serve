// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OsspreyController } from '../controllers/ossprey.controller';

const router = Router();
const osspreyController = new OsspreyController();

router.get('/packages', osspreyController.getPackages.bind(osspreyController));
router.get('/packages/:purl', osspreyController.getPackage.bind(osspreyController));

export default router;
