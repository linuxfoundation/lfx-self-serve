// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { InviteController } from '../controllers/invite.controller';

const router = Router();
const inviteController = new InviteController();

// POST /api/invite/accept — accept an invite JWT and receive the return_url
router.post('/accept', (req, res, next) => inviteController.acceptInvite(req, res, next));

export default router;
