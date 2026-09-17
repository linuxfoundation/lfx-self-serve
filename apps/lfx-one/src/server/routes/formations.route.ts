// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import {
  getFormationItem,
  getFormationsQueue,
  getProjectFormation,
  updateFormationItem,
  updateFormationItemAssignment,
  updateFormationItemStatus,
} from '../controllers/formation.controller';
import { requireAuditor } from '../middleware/require-auditor.middleware';
import { requireLiveFormation } from '../middleware/require-live-formation.middleware';

const router = Router();

// Project-page checklist (GH-1958) — standard authenticated-user access, same as every other
// `/api/projects/:slug/*` read. A gating item's completion access is enforced entirely by the API
// gateway (writer_guard + team:formation membership) on the actual write route, not here or in the
// controller (GH-2576 Phase 2).
router.get('/projects/:slug/formation', getProjectFormation);

// Shared fail-closed gate (GH-2328): every item mutation below is denied (409 CHECKLIST_READ_ONLY)
// unless the formation's upstream lifecycle is `'live'`. `router.use`'s prefix match covers all
// three write routes (and any future one registered under this same prefix) automatically;
// `requireLiveFormation` itself skips GET/HEAD/OPTIONS, so the read-only `getFormationItem` route
// just below is unaffected.
router.use('/formations/:projectUid/items/:itemKey', requireLiveFormation);

// Items are addressed by (project_uid, item_key), matching the real service's contract (GH-2267
// Phase 2). GH-2576 Phase 2 replaced the earlier six-route/`awaiting_acceptance` write model with
// the three routes `lfx-v2-formation-service` actually shipped at tag v0.1.4 — note `/status` and
// `/assignment` are POST, not PATCH. `updateFormationItem`'s bare PATCH is registered LAST: Express
// matches the first route whose path pattern fits, so registering it earlier would shadow
// `/assignment`/`/status` below, since `:itemKey` alone matches them too.
router.get('/formations/:projectUid/items/:itemKey', getFormationItem);
router.post('/formations/:projectUid/items/:itemKey/assignment', updateFormationItemAssignment);
router.post('/formations/:projectUid/items/:itemKey/status', updateFormationItemStatus);
router.patch('/formations/:projectUid/items/:itemKey', updateFormationItem);

// Formations queue (GH-1958), auditor-only. Root-scoped by default (every formation); an optional
// `?foundation_uid=` narrows to that foundation's direct-child formations (GH-2367). Exception:
// passing the `tlf` LF umbrella foundation's uid is treated as root scope too (every formation),
// not narrowed to its direct children (GH-2378) — the UI always seeds this uid on unscoped landing.
router.get('/formations', requireAuditor, getFormationsQueue);

export default router;
