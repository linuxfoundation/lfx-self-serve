// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PublicVoteLinkController } from '../controllers/public-vote-link.controller';

const router = Router();
const publicVoteLinkController = new PublicVoteLinkController();

// The vote link token is the only credential. It travels in the request body (never a URL) and is never logged.

// POST /public/api/votes/link-ballot - read the ballot for a vote link token
router.post('/link-ballot', (req, res, next) => publicVoteLinkController.getLinkBallot(req, res, next));

// POST /public/api/votes/link-responses - first submission for a vote link token
router.post('/link-responses', (req, res, next) => publicVoteLinkController.submitLinkResponse(req, res, next));

// PUT /public/api/votes/link-responses - update an existing response for a vote link token
router.put('/link-responses', (req, res, next) => publicVoteLinkController.updateLinkResponse(req, res, next));

export default router;
