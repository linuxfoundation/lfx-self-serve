// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { getFormationPipeline } from '../controllers/formation-pipeline.controller';

const router = Router();

// Formation pipeline (#5475): every non-Active project by stage, for the formation team. Mounted at
// `/api/formations/pipeline`. Formation-team membership is the only guard, enforced in the service
// before any upstream read — deliberately not `requireAuditor`.
router.get('/', getFormationPipeline);

export default router;
