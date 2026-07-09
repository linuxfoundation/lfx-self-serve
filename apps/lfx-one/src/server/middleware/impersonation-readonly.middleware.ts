// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { logger } from '../services/logger.service';
import { isImpersonating } from '../utils/auth-helper';

// Profile / account-settings mutations act on the real user's account via the impersonator's
// Flow C management token — there is no Custom Token Exchange equivalent for the Auth0 Management
// API, so a write during impersonation would modify the WRONG account (the impersonator's, not the
// target's). Block every such write while impersonating; impersonated profile viewing is read-only.
export function blockDuringImpersonation(req: Request, _res: Response, next: NextFunction): void {
  if (!isImpersonating(req)) {
    next();
    return;
  }

  logger.warning(req, 'impersonation_readonly', 'Blocked profile write during impersonation', {
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
