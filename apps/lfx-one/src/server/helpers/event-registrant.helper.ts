// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EventRegistrantIdentity } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { UserService } from '../services/user.service';
import { isImpersonating } from '../utils/auth-helper';

/**
 * The effective user's registration identity: their session email plus their Salesforce ID from
 * user-service `/v1/me`. Never throws; a failed ID lookup yields `userId: null` (email-only match).
 */
export async function resolveEventRegistrant(req: Request, userService: UserService, email: string): Promise<EventRegistrantIdentity> {
  // req.apiGatewayToken stays the impersonator's, so look up the target with their v2 token.
  const impersonating = isImpersonating(req);
  const targetToken = impersonating ? req.bearerToken : undefined;

  // Fail closed to email-only: an unset target token would resolve the impersonator's own ID.
  if (impersonating && !targetToken) {
    logger.warning(req, 'resolve_event_registrant', 'Impersonation token unavailable, matching registrations by email only', {});
    return { email, userId: null };
  }

  try {
    const profile = await userService.getApiGatewayProfile(req, targetToken);
    return { email, userId: profile.ID || null };
  } catch (error) {
    logger.warning(req, 'resolve_event_registrant', 'Salesforce ID lookup failed, matching registrations by email only', {
      err: error,
    });
    return { email, userId: null };
  }
}

/**
 * Matches the registrant's rows on Salesforce ID or session email, so registrations under another email of a
 * merged account still match. Unqualified columns: only valid directly against the registration tables.
 */
export function registrantFilterSql(registrant: EventRegistrantIdentity): { sql: string; binds: string[] } {
  if (registrant.userId) {
    return { sql: '(USER_ID = ? OR LOWER(USER_EMAIL) = ?)', binds: [registrant.userId, registrant.email] };
  }
  return { sql: 'LOWER(USER_EMAIL) = ?', binds: [registrant.email] };
}
