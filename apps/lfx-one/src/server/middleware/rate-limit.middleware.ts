// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * App-wide rate limiter for API routes.
 *
 * Applied globally in server.ts to all /api/* routes
 * so that every current and future route is automatically protected.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 500, // limit each IP to 500 requests per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

/**
 * Rate limiter for public API routes (unauthenticated access).
 *
 * Applied to /public/api/* routes which don't require authentication,
 * so a stricter limit is needed to prevent abuse.
 */
export const publicApiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for AI generation endpoints.
 *
 * Applied per-route to `POST /api/meetings/generate-agenda`. That call fans out to the LiteLLM
 * proxy and is far more expensive than a normal proxy read, while the global `apiRateLimiter`
 * (500/min) is nowhere near tight enough to bound it. Keyed on the authenticated user where
 * available so one user on a shared egress IP can't exhaust the budget for everyone behind it;
 * anonymous callers fall back to a /56-masked IP key.
 *
 * Not yet applied to the other LiteLLM callers (newsletter generation, weekly-brief action-item
 * extraction) — those are reached from different modules and are only bounded by the global limiter.
 *
 * The counter lives in the default in-process MemoryStore — per pod, not cluster-wide:
 * `ecosystem.config.js` runs a single PM2 instance per pod, but the Helm chart deploys
 * `replicaCount: 3` (100% surge ⇒ up to 6 pods mid-rollout), so the effective production ceiling
 * is `limit × pods` (~30/min today, ~60 during a surge). A shared store would be needed for an
 * exact cluster-wide cap.
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // limit each user (or IP, when anonymous) to 10 AI generations per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.oidc?.user?.['sub'] || ipKeyGenerator(req.ip ?? ''),
});

/**
 * Rate limiter for vote write endpoints (GH-2729 review m-10).
 *
 * Applied per-route to `POST /api/votes` (create) and `PUT /api/votes/:uid/enable`. A fused
 * create+open fans out to as many as 22 upstream calls while convergence lags (1 POST + up to
 * 21 enable PUTs on the 600 ms grid under the 13 s deadline — see VoteService's budget
 * constants), so the global 500/min/IP `apiRateLimiter` would still allow ~22 such actions per
 * minute; 10/min per user is far above human admin pacing. Keyed on the authenticated user — these routes are auth-gated,
 * so the `sub` key is effectively always present — with the /56-masked IP key as the anonymous
 * fallback. `POST /api/votes/responses` is deliberately not throttled here: a room of voters
 * can share a NAT IP.
 *
 * The counter lives in the default in-process MemoryStore — per pod, not cluster-wide:
 * `ecosystem.config.js` runs a single PM2 instance per pod, but the Helm chart deploys
 * `replicaCount: 3` (100% surge ⇒ up to 6 pods mid-rollout), so the effective production ceiling
 * is ~30 writes/min per user (~60 during a surge). That relaxed-but-bounded ceiling still serves
 * the limiter's purpose — capping upstream fan-out amplification; a shared store would only be
 * needed if the per-user cap ever had to hold exactly across replicas.
 */
export const voteWriteRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute window
  max: 10, // limit each user to 10 vote writes per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.oidc?.user?.['sub'] || ipKeyGenerator(req.ip ?? ''),
});

/**
 * Stricter rate limiter for authentication endpoints.
 *
 * Applied to /login, /passwordless/*, and /social/* routes
 * to mitigate brute-force and credential-stuffing attacks.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 20, // limit each IP to 20 auth requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
