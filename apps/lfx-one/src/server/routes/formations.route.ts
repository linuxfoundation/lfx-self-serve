// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import {
  getFormationItem,
  getFormationPeople,
  getFormationsQueue,
  getProjectFormation,
  updateFormationItem,
  updateFormationItemAssignment,
  updateFormationItemStatus,
} from '../controllers/formation.controller';
import { requireLiveFormation } from '../middleware/require-live-formation.middleware';

const router = Router();

// Project-page checklist (GH-1958) — standard authenticated-user access, same as every other
// `/api/projects/:slug/*` read. A gating item's completion access is enforced entirely by the API
// gateway (writer_guard + team:formation membership) on the actual write route, not here or in the
// controller (GH-2576 Phase 2).
router.get('/projects/:slug/formation', getProjectFormation);

// People on this formation (#2724) — the checklist sidebar's people card, served from the project's
// settings roles. Same ungated per-project audience as the checklist read above: the service's own
// masking checklist read is the access gate, and the settings read behind it degrades to an
// `unavailable` state for a caller upstream 403s (global-grant staff) instead of failing the card.
router.get('/projects/:slug/formation/people', getFormationPeople);

// Shared fail-closed gate (GH-2328): every item mutation below is denied (409 CHECKLIST_READ_ONLY)
// unless the formation's upstream lifecycle is `'live'`. `router.use`'s prefix match covers all
// three write routes (and any future one registered under this same prefix) automatically;
// `requireLiveFormation` itself skips GET/HEAD/OPTIONS, so the read-only `getFormationItem` route
// just below is unaffected.
router.use('/formations/:projectUid/items/:itemKey', requireLiveFormation);

// Items are addressed by (project_uid, item_key), matching the real service's contract (GH-2267
// Phase 2). GH-2576 Phase 2 replaced the earlier six-route/`awaiting_acceptance` write model with
// the three routes `lfx-v2-formation-service` actually shipped at tag v0.1.4 — note `/status` and
// `/assignment` are POST, not PATCH. `updateFormationItem`'s bare PATCH is registered last purely by
// convention (Express matches on exact path shape plus method — `/assignment`/`/status` are a
// different segment count and a different verb, so registration order can't actually shadow them
// here; GH-2613 review).
router.get('/formations/:projectUid/items/:itemKey', getFormationItem);
router.post('/formations/:projectUid/items/:itemKey/assignment', updateFormationItemAssignment);
router.post('/formations/:projectUid/items/:itemKey/status', updateFormationItemStatus);
router.patch('/formations/:projectUid/items/:itemKey', updateFormationItem);

// Formations queue (GH-1958). Not gated on a ROOT relation (#2812): the query runs with the
// caller's token and upstream returns only the formations the caller holds `auditor_guard` on,
// so a per-project grant — including a per-project `global_auditor` — sees exactly its own rows.
// Root-scoped by default (every readable formation); an optional
// `?foundation_uid=` narrows to that foundation's formations (GH-2367 — the whole subtree at any
// depth since GH-2368's upstream ancestry chain). The `tlf` LF umbrella foundation's uid — where
// LF staff land by default — narrows to LF's own formations instead: parentless rows plus tlf's
// direct children (GH-2699, superseding GH-2378's treat-tlf-as-everything behaviour).
router.get('/formations', getFormationsQueue);

// Queue drill-down checklist read (LFXV2-3386): the same controller and response as
// `GET /projects/:slug/formation` above, and the same per-project audience — the service's
// masking checklist read is the access gate, so a caller without upstream access to that
// project gets a 404 whether it renders on the server or in the browser (#2812).
router.get('/formations/:slug/checklist', getProjectFormation);

export default router;
