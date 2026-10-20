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
// Signed-in callers also get `is_member` / `has_pending_application` per group, resolved once per request with their own token and served `private, no-store`; anonymous callers get neither field.
// Foundations that are not publicly discoverable (`public` false or Formation - Confidential) are answered exactly like an unknown identifier, and groups of hidden child projects are omitted (lfx-self-serve-ops#437).
// Slug metadata failures use the same non-cacheable 404 as unknown slugs; UID metadata failures propagate.
router.get('/:identifier/groups', (req, res, next) => publicGroupsController.getPublicGroupsByFoundation(req, res, next));

export default router;
