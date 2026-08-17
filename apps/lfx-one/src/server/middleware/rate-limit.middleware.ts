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
 * Applied per-route to endpoints that call out to the LiteLLM proxy. Those calls are far more
 * expensive than a normal proxy read, and the global `apiRateLimiter` (500/min) is nowhere near
 * tight enough to bound them. Keyed on the authenticated user where available so one user on a
 * shared egress IP can't exhaust the budget for everyone behind it.
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
