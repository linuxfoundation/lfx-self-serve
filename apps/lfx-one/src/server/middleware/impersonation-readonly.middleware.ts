// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { logger } from '../services/logger.service';
import { isImpersonating } from '../utils/auth-helper';

// Guards three distinct classes of write during impersonation, all of which produce a result
// wrongly attributed to (or wrongly stored against) an account other than the one that actually
// authenticated:
// 1. Profile / account-settings mutations act on the real user's account via the impersonator's
//    Flow C management token — there is no Custom Token Exchange equivalent for the Auth0
//    Management API, so a write here would modify the impersonator's own account, not the
//    target's (profile.route.ts, enrollment.route.ts).
// 2. Writes that resolve identity via `getEffectiveUsername`/`getEffectiveSub` (impersonation-aware
//    helpers that return the *target's* identity) land directly in the target's own store — the
//    opposite mistake, writing into the wrong account in the other direction (e.g. weekly-brief
//    rating — weekly-brief.route.ts).
// 3. Real, hard-to-retract, externally-visible actions with no in-payload caller identity to
//    attribute or correct after the fact — not a wrong-*account* write like 1/2 above, but the
//    same "produces a result nobody can trace back to the impersonator" failure mode (e.g.
//    Share to Slack, an incoming-webhook POST with no reply-to equivalent — weekly-brief.route.ts).
// Block every such write while impersonating; impersonated viewing/reads stay unaffected.
export function blockDuringImpersonation(req: Request, _res: Response, next: NextFunction): void {
  if (!isImpersonating(req)) {
    next();
    return;
  }

  logger.warning(req, 'impersonation_readonly', 'Blocked write during impersonation', {
    path: req.path,
    method: req.method,
    impersonator_sub: req.appSession?.['impersonator']?.sub,
    target_sub: req.appSession?.['impersonationUser']?.sub,
  });

  next(
    new AuthorizationError('This action is not available while impersonating a user', {
      operation: 'impersonation_readonly',
      service: 'authorization',
      path: req.path,
      code: 'IMPERSONATION_READ_ONLY',
    })
  );
}
