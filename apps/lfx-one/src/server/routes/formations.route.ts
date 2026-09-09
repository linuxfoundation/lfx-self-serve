// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import {
  completeFormationItem,
  getFormationItem,
  getFormationsQueue,
  getProjectFormation,
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
router.get('/formation-items/:uid', getFormationItem);
router.patch('/formation-items/:uid/complete', completeFormationItem);
router.patch('/formation-items/:uid/skip', skipFormationItem);
router.patch('/formation-items/:uid/request', requestFormationItem);
router.patch('/formation-items/:uid/status', updateFormationItemStatus);
router.patch('/formation-items/:uid', updateFormationItem);

// Formations queue (GH-1958) — LF-root-scoped, auditor-only.
router.get('/formations', requireAuditor, getFormationsQueue);

export default router;
