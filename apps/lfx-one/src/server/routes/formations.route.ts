// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { FormationController } from '../controllers/formation.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();

const formationController = new FormationController();

// Blocked during impersonation: createFormation records submitted_by via getEffectiveUsername,
// so an impersonated write would be recorded as (and later only readable by) the target user.
router.post('/', blockDuringImpersonation, (req, res, next) => formationController.createFormation(req, res, next));

router.get('/:uid', (req, res, next) => formationController.getFormationByUid(req, res, next));

export default router;
