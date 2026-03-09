// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { LensController } from '../controllers/lens.controller';

const router = Router();

const lensController = new LensController();

// POST /lens/chat - SSE endpoint for LFX Lens chat
router.post('/chat', (req, res, next) => lensController.chat(req, res, next));

export default router;
