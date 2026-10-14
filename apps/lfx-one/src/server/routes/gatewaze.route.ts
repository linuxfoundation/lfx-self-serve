// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { GatewazeSessionController } from '../controllers/gatewaze-session.controller';
import { requireGatewazeHostSession } from '../middleware/require-gatewaze-host-session.middleware';
import { requireGwEmbedAccess } from '../middleware/require-gw-embed-access.middleware';

const router = Router();
const controller = new GatewazeSessionController();

// Session answers are per user and change at sign-out, so nothing may cache them. Set first, so the
// 404 and 403 from the gates below carry it too.
router.use('/session', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// The uniform 404 while host-session mode is off, then the same LFX authorization as /api/gw: ED, root
// writer or any writer grant, and a 403 while impersonating. Nothing here mints a Gatewaze session
// for an impersonation target.
router.use(requireGatewazeHostSession, requireGwEmbedAccess);

router.get('/session/me', (req, res, next) => controller.me(req, res, next));
router.post('/session/logout', (req, res, next) => controller.logout(req, res, next));

export default router;
