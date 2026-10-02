// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { AkritesController } from '../controllers/akrites.controller';
import { requireExecutiveDirector } from '../middleware/require-executive-director.middleware';

const router = Router();
const akritesController = new AkritesController();

router.get('/packages/metrics', akritesController.getMetrics.bind(akritesController));
router.get('/packages/scatter', akritesController.getScatterData.bind(akritesController));
router.get('/packages/advisories', akritesController.getPackageAdvisories.bind(akritesController));
router.get('/packages', akritesController.getPackages.bind(akritesController));
router.get('/packages/:purl', akritesController.getPackage.bind(akritesController));
router.get('/activity', akritesController.getActivityFeed.bind(akritesController));

// Steward admin actions (writes) require server-verified Executive Director access.
router.post('/stewardships', requireExecutiveDirector, akritesController.openStewardship.bind(akritesController));
router.put('/stewardships/:id/steward', requireExecutiveDirector, akritesController.assignSteward.bind(akritesController));
router.put('/stewardships/:id/escalate', requireExecutiveDirector, akritesController.escalateStewardship.bind(akritesController));
router.put('/stewardships/:id/status', requireExecutiveDirector, akritesController.updateStewardshipStatus.bind(akritesController));

export default router;
