// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MktgAgentsController } from '../controllers/mktg-agents.controller';

const router = Router();
const mktgAgentsController = new MktgAgentsController();

// POST /api/mktg-agents/chat - create a Guild session or post a follow-up
router.post('/chat', (req, res, next) => mktgAgentsController.chat(req, res, next));

// GET /api/mktg-agents/history - fetch mapped session history (owner-token gated)
router.get('/history', (req, res, next) => mktgAgentsController.history(req, res, next));

// POST /api/mktg-agents/brand-kit/generate - start a one-shot form-mode Brand Kit generation
router.post('/brand-kit/generate', (req, res, next) => mktgAgentsController.generateBrandKit(req, res, next));

// POST /api/mktg-agents/brand-kit/result - poll a generation session for the validated document
router.post('/brand-kit/result', (req, res, next) => mktgAgentsController.brandKitResult(req, res, next));

export default router;
