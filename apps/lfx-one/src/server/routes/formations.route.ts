// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import {
  acceptFormationItem,
  completeFormationItem,
  getFormationItem,
  getFormationsQueue,
  getProjectFormation,
  rejectFormationItem,
  reopenFormationItem,
  requestFormationItem,
  skipFormationItem,
  updateFormationItem,
  updateFormationItemStatus,
} from '../controllers/formation.controller';
import { requireAuditor } from '../middleware/require-auditor.middleware';

const router = Router();

// Project-page checklist (GH-1958) — standard authenticated-user access, same as every other
// `/api/projects/:slug/*` read. gate_writer is checked per-item inside the controller, not here.
router.get('/projects/:slug/formation', getProjectFormation);

// Items are addressed by (project_uid, item_key), matching the real service's contract (GH-2267
// Phase 2) — not by a bare item uid. `updateFormationItem`'s bare PATCH is registered LAST among
// these routes: Express matches the first route whose path pattern fits, so registering it earlier
// would shadow every sub-path below (`/complete`, `/skip`, etc.) since `:itemKey` alone matches them.
router.get('/formations/:projectUid/items/:itemKey', getFormationItem);
router.patch('/formations/:projectUid/items/:itemKey/complete', completeFormationItem);
router.patch('/formations/:projectUid/items/:itemKey/skip', skipFormationItem);
router.patch('/formations/:projectUid/items/:itemKey/request', requestFormationItem);
router.patch('/formations/:projectUid/items/:itemKey/status', updateFormationItemStatus);
router.post('/formations/:projectUid/items/:itemKey/accept', acceptFormationItem);
router.post('/formations/:projectUid/items/:itemKey/reject', rejectFormationItem);
router.post('/formations/:projectUid/items/:itemKey/reopen', reopenFormationItem);
router.patch('/formations/:projectUid/items/:itemKey', updateFormationItem);

// Formations queue (GH-1958) — LF-root-scoped, auditor-only.
router.get('/formations', requireAuditor, getFormationsQueue);

export default router;
