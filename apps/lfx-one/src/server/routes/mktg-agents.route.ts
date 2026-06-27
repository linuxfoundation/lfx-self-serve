// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MktgAgentsController } from '../controllers/mktg-agents.controller';

const router = Router();
const mktgAgentsController = new MktgAgentsController();

// POST /api/mktg-agents/chat - create a Guild session or post a follow-up
router.post('/chat', (req, res, next) => mktgAgentsController.chat(req, res, next));

// GET /api/mktg-agents/history - fetch mapped session history
router.get('/history', (req, res, next) => mktgAgentsController.history(req, res, next));

export default router;
