// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import rateLimit from 'express-rate-limit';

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
