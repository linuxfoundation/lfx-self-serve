// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicGroupsController } from '../controllers/public-groups.controller';

const router = Router();
const publicGroupsController = new PublicGroupsController();

// GET /public/api/foundations/:identifier/groups
// Returns public group summaries for a foundation (by UID or slug).
// Includes groups from all child projects under the foundation.
// Public access — no authentication required; M2M token used for upstream calls.
router.get('/:identifier/groups', (req, res, next) => publicGroupsController.getPublicGroupsByFoundation(req, res, next));

export default router;
