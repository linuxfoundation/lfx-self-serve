// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NavigationController } from '../controllers/navigation.controller';

const router = Router();
const navigationController = new NavigationController();

router.get('/lens-items', (req, res, next) => navigationController.getLensItems(req, res, next));

// Spec 020 — paginated, FGA-filtered org list mirroring the lens-items contract for orgs.
router.get('/org-items', (req, res, next) => navigationController.getOrgItems(req, res, next));

export default router;
