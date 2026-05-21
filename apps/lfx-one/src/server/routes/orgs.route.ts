// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgLensFoundationsController } from '../controllers/org-lens-foundations.controller';
import { OrgLensMembershipsController } from '../controllers/org-lens-memberships.controller';

const router = Router();

const orgLensFoundationsController = new OrgLensFoundationsController();
const orgLensMembershipsController = new OrgLensMembershipsController();

// GET /api/orgs/:accountId/lens/foundations-and-projects
router.get('/:accountId/lens/foundations-and-projects', (req, res, next) => orgLensFoundationsController.getFoundationsAndProjects(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/active
router.get('/:accountId/lens/memberships/active', (req, res, next) => orgLensMembershipsController.getActiveMemberships(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/expired
router.get('/:accountId/lens/memberships/expired', (req, res, next) => orgLensMembershipsController.getExpiredMemberships(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/discover
router.get('/:accountId/lens/memberships/discover', (req, res, next) => orgLensMembershipsController.getDiscoverOpportunities(req, res, next));

export default router;
