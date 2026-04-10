// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Router } from 'express';

import { TrainingController } from '../controllers/training.controller';

const router = Router();
const trainingController = new TrainingController();

router.get('/certifications', (req, res, next) => trainingController.getCertifications(req, res, next));

export default router;
