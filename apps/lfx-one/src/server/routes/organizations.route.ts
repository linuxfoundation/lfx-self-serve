// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrganizationController } from '../controllers/organization.controller';

const router = Router();
const organizationController = new OrganizationController();

// GET /api/organizations/search - Search for organizations
router.get('/search', organizationController.searchOrganizations.bind(organizationController));

// POST /api/organizations/resolve - Find or create an organization in CDP
router.post('/resolve', organizationController.resolveOrganization.bind(organizationController));

export default router;
