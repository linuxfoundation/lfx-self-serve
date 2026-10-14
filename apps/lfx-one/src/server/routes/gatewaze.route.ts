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

// Session answers are per user and change at sign-out, and gate answers change with access and
// impersonation, so nothing may cache them. Set first, so the 404 and 403 from the gates below carry
// it too. A proxied response replaces it with the upstream's own Cache-Control, when it sends one.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// The uniform 404 while host-session mode is off or the request has no LFX bearer token, then the
// LFX authorization: ED, root writer or any writer grant, and a 403 while impersonating. Nothing
// here mints a Gatewaze session for an impersonation target. requireGatewazeBearer refuses a
// request with no bearer token rather than relying on authMiddleware alone.
router.use(requireGatewazeHostSession, requireGatewazeBearer, requireGwEmbedAccess);

// The proxies. Supabase services are matched by name, so GoTrue's /auth/v1 is never proxied (the
// embed's shim answers auth itself from /session/me) and Realtime is left to its upgrade handler.
// Case-insensitive like the mount, so an upper-cased path reaches the proxy and gets its 400 from the
// prefix check rather than falling through to the SSR catch-all.
router.all(/^\/supabase\/(rest|storage|functions)\/v1(?:\/.*)?$/i, (req, res, next) => proxy.proxySupabase(req, res, next));
router.all(/^\/api(?:\/.*)?$/i, (req, res, next) => proxy.proxyApi(req, res, next));

router.get('/session/me', (req, res, next) => controller.me(req, res, next));
router.post('/session/logout', (req, res, next) => controller.logout(req, res, next));

// The Realtime WebSocket. An upgrade reaches this route only through GatewazeRealtimeService.onUpgrade,
// which runs it through the whole app, so it has passed every gate above.
router.get(/^\/supabase\/realtime\/v1\/websocket$/, (req, res, next) => controller.realtime(req, res, next));

export default router;
