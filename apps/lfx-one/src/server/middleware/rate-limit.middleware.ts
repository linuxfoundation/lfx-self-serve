// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import rateLimit from 'express-rate-limit';

/**
 * App-wide rate limiter for API and auth routes.
 *
 * Applied globally in server.ts to all /api/*, /login, /passwordless/*, and /social/* routes
 * so that every current and future route is automatically protected.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
