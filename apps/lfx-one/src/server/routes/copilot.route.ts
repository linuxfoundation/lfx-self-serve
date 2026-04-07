// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CopilotController } from '../controllers/copilot.controller';

const router = Router();

const copilotController = new CopilotController();

// POST /copilot/chat - SSE endpoint for LFX Copilot chat
router.post('/chat', (req, res, next) => copilotController.chat(req, res, next));

export default router;
