// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OsspreyController } from '../controllers/ossprey.controller';

const router = Router();
const osspreyController = new OsspreyController();

router.get('/packages/metrics', osspreyController.getMetrics.bind(osspreyController));
router.get('/packages', osspreyController.getPackages.bind(osspreyController));
router.get('/packages/:purl', osspreyController.getPackage.bind(osspreyController));

// Steward admin actions (writes). Authorization gate to be added (see CM-1245 plan, Gap #4).
router.post('/stewardships', osspreyController.openStewardship.bind(osspreyController));
router.put('/stewardships/:id/steward', osspreyController.assignSteward.bind(osspreyController));
router.put('/stewardships/:id/escalate', osspreyController.escalateStewardship.bind(osspreyController));
router.put('/stewardships/:id/status', osspreyController.updateStewardshipStatus.bind(osspreyController));

export default router;
