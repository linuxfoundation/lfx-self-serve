// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { FormationController } from '../controllers/formation.controller';

const router = Router();

const formationController = new FormationController();

router.post('/', (req, res, next) => formationController.createFormation(req, res, next));

router.get('/:uid', (req, res, next) => formationController.getFormationByUid(req, res, next));

export default router;
