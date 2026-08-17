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
 * The counter lives in the default in-process MemoryStore, so the effective ceiling is
 * `limit × replicas`. That's exact today (`ecosystem.config.js` runs a single instance) but would
 * need a shared store to hold under horizontal scaling.
 */
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // limit each user (or IP, when anonymous) to 10 AI generations per window
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
