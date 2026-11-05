// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ItOsAgentsController } from '../controllers/it-os-agents.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

// IT OS live agents (#4257). Dev only: the controller refuses every call unless GUILD_IT_OS_WORKSPACE_NAME is set.
const router = Router();
const controller = new ItOsAgentsController();

// GET /api/it-os-agents/status - which agents are live here (none outside dev)
router.get('/status', (req, res) => controller.status(req, res));

// POST /api/it-os-agents/chat - start a session or post a follow-up. The agent can change DNS, so impersonation is blocked.
router.post('/chat', blockDuringImpersonation, (req, res, next) => controller.chat(req, res, next));

// POST /api/it-os-agents/history - the session's messages (owner token in the body)
router.post('/history', (req, res, next) => controller.history(req, res, next));

export default router;
