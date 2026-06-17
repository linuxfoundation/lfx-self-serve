// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { AkritesController } from '../controllers/akrites.controller';

const router = Router();
const akritesController = new AkritesController();

router.get('/packages/metrics', akritesController.getMetrics.bind(akritesController));
router.get('/packages', akritesController.getPackages.bind(akritesController));
router.get('/packages/:purl', akritesController.getPackage.bind(akritesController));

// Steward admin actions (writes). Authorization gate to be added (see CM-1245 plan, Gap #4).
router.post('/stewardships', akritesController.openStewardship.bind(akritesController));
router.put('/stewardships/:id/steward', akritesController.assignSteward.bind(akritesController));
router.put('/stewardships/:id/escalate', akritesController.escalateStewardship.bind(akritesController));
router.put('/stewardships/:id/status', akritesController.updateStewardshipStatus.bind(akritesController));

export default router;
