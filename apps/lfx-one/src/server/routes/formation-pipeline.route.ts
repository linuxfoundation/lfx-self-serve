// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { getFormationPipeline } from '../controllers/formation-pipeline.controller';

const router = Router();

// Formation pipeline (#5475): every non-Active project by stage, for the formation team; LF staff get a
// read-only view without Draft and Confidential projects (#5544). Mounted at `/api/formations/pipeline`.
// `team:formation` or `team:lf-staff` membership is the guard, enforced in the service before any upstream
// read — deliberately not `requireAuditor`.
router.get('/', getFormationPipeline);

export default router;
