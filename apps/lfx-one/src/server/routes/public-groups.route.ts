// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicGroupsController } from '../controllers/public-groups.controller';

const router = Router();
const publicGroupsController = new PublicGroupsController();

// GET /public/api/groups/:id
// Returns a public group's detail (by UID or sso_group_name slug).
// Public access — no authentication required; M2M token used for upstream calls.
// A group whose owning project is not publicly discoverable (`public` false or Formation - Confidential) is answered exactly like an unknown group, and a hidden parent foundation is omitted (lfx-self-serve-ops#437).
// Owning-project metadata failures use the same non-cacheable 404 as unknown groups, by UID or slug.
router.get('/:id', (req, res, next) => publicGroupsController.getPublicGroupById(req, res, next));

export default router;
