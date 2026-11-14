// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { AuthorizationError } from '../errors';
import { decodeJwtPayload, resolveRealAccessToken } from './auth-helper';

/**
 * Resolves the signed-in admin's own access token for an action that is the admin's, not the impersonation
 * target's: choosing who to impersonate. While impersonating, `req.bearerToken` is the current target's token,
 * so these calls must not use it.
 *
 * The `can_impersonate` claim is read from the same token that is returned, so the gate and the caller agree.
 * Fails closed: throws when the real token cannot be resolved or lacks the claim.
 */
export async function resolveImpersonatorToken(req: Request, operation: string): Promise<string> {
  const token = await resolveRealAccessToken(req);
  const payload = token ? decodeJwtPayload(token) : null;

  if (!token || !payload || payload['http://lfx.dev/claims/can_impersonate'] !== true) {
    throw new AuthorizationError('Insufficient permissions to impersonate users', { operation, service: 'impersonation' });
  }

  return token;
}
