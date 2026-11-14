// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NavigationController } from '../controllers/navigation.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const navigationController = new NavigationController();

router.get('/lens-items', (req, res, next) => navigationController.getLensItems(req, res, next));

// Spec 020 — paginated, FGA-filtered org list mirroring the lens-items contract for orgs.
router.get('/org-items', (req, res, next) => navigationController.getOrgItems(req, res, next));

// Favorite foundations/projects (GH-2995) — single global per-user preference; writes blocked during impersonation.
router.get('/favorite-projects', (req, res, next) => navigationController.getFavoriteProjects(req, res, next));
router.put('/favorite-projects', blockDuringImpersonation, (req, res, next) => navigationController.upsertFavoriteProjects(req, res, next));
router.delete('/favorite-projects', blockDuringImpersonation, (req, res, next) => navigationController.deleteFavoriteProjects(req, res, next));

export default router;
