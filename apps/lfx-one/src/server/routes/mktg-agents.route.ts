// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MktgAgentsController } from '../controllers/mktg-agents.controller';

const router = Router();
const mktgAgentsController = new MktgAgentsController();

// POST /api/mktg-agents/chat - create a Guild session or post a follow-up
router.post('/chat', (req, res, next) => mktgAgentsController.chat(req, res, next));

// POST /api/mktg-agents/history - fetch mapped session history (owner-token in body)
router.post('/history', (req, res, next) => mktgAgentsController.history(req, res, next));

// POST /api/mktg-agents/brand-kit/generate - start a one-shot form-mode Brand Kit generation
router.post('/brand-kit/generate', (req, res, next) => mktgAgentsController.generateBrandKit(req, res, next));

// POST /api/mktg-agents/brand-kit/result - poll a generation session for the validated document
router.post('/brand-kit/result', (req, res, next) => mktgAgentsController.brandKitResult(req, res, next));

// POST /api/mktg-agents/foundation-message/generate - start a one-shot form-mode Message Foundation generation
router.post('/foundation-message/generate', (req, res, next) => mktgAgentsController.generateFoundationMessage(req, res, next));

// POST /api/mktg-agents/foundation-message/result - poll a generation session for the validated document
router.post('/foundation-message/result', (req, res, next) => mktgAgentsController.foundationMessageResult(req, res, next));

export default router;
