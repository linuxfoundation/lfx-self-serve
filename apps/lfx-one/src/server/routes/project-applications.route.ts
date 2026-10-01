// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import {
  acceptProjectApplication,
  createProjectApplication,
  deleteProjectApplication,
  denyProjectApplication,
  getProjectApplicationAccess,
  listMyProjectApplications,
  listProjectApplicationQueue,
  reviseProjectApplication,
  withdrawProjectApplication,
} from '../controllers/project-application.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();

// Project applications — "Propose a project" (#3037). Mounted at `/api/project-applications`, so every
// route requires a session (authMiddleware). Reads use the caller's token against query-service, which
// returns only applications the caller may view; the gateway's OpenFGA check decides every write
// (submitter = `writer`; accept/deny additionally require `formation_team`). No in-app authorization is
// duplicated here by comparing usernames.
router.get('/mine', listMyProjectApplications);
router.get('/queue', listProjectApplicationQueue);
router.get('/access', getProjectApplicationAccess);

// Writes are refused during impersonation: create attributes the application to the session identity,
// and the others are hard-to-retract decisions nobody could trace back to the impersonator.
router.post('/', blockDuringImpersonation, createProjectApplication);
router.put('/:uid', blockDuringImpersonation, reviseProjectApplication);
router.post('/:uid/withdraw', blockDuringImpersonation, withdrawProjectApplication);
router.post('/:uid/accept', blockDuringImpersonation, acceptProjectApplication);
router.post('/:uid/deny', blockDuringImpersonation, denyProjectApplication);
router.delete('/:uid', blockDuringImpersonation, deleteProjectApplication);

export default router;
