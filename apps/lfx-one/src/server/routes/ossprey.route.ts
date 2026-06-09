// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OsspreyController } from '../controllers/ossprey.controller';

const router = Router();
const osspreyController = new OsspreyController();

router.get('/packages', (req, res, next) => osspreyController.getPackages(req, res, next));
router.get('/packages/:purl', (req, res, next) => osspreyController.getPackage(req, res, next));

export default router;
