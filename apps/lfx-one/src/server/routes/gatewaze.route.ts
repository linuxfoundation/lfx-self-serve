// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { GatewazeProxyController } from '../controllers/gatewaze-proxy.controller';
import { GatewazeSessionController } from '../controllers/gatewaze-session.controller';
import { requireGatewazeBearer, requireGatewazeHostSession } from '../middleware/require-gatewaze-host-session.middleware';
import { requireGwEmbedAccess } from '../middleware/require-gw-embed-access.middleware';

const router = Router();
const controller = new GatewazeSessionController();
const proxy = new GatewazeProxyController();

// Session answers are per user and change at sign-out, so nothing may cache them. Set first, so the
// 404 and 403 from the gates below carry it too.
router.use('/session', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// The uniform 404 while host-session mode is off or the request has no LFX bearer token, then the
// same LFX authorization as /api/gw: ED, root writer or any writer grant, and a 403 while
// impersonating. Nothing here mints a Gatewaze session for an impersonation target.
// requireGwEmbedAccess lets a request with no bearer token through (on /api/gw the controller 404s
// it), so requireGatewazeBearer refuses it first rather than relying on authMiddleware alone.
router.use(requireGatewazeHostSession, requireGatewazeBearer, requireGwEmbedAccess);

// The proxies. Supabase services are matched by name, so GoTrue's /auth/v1 is never proxied (the
// embed's shim answers auth itself from /session/me) and Realtime is left to its upgrade handler.
// Regex routes are case-sensitive, unlike the mount.
router.all(/^\/supabase\/(rest|storage|functions)\/v1(?:\/.*)?$/, (req, res, next) => proxy.proxySupabase(req, res, next));
router.all(/^\/api(?:\/.*)?$/, (req, res, next) => proxy.proxyApi(req, res, next));

router.get('/session/me', (req, res, next) => controller.me(req, res, next));
router.post('/session/logout', (req, res, next) => controller.logout(req, res, next));

export default router;
