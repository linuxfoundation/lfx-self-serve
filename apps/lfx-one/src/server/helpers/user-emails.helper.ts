// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ResolveVerifiedUserEmailsOptions } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { EmailVerificationService } from '../services/email-verification.service';
import { logger } from '../services/logger.service';
import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername } from '../utils/auth-helper';

/**
 * The signed-in user's verified email addresses (lowercased, de-duplicated, primary first), read
 * from auth-service `lfx.auth-service.user_emails.read`. Impersonation-aware: resolves the
 * impersonation target, never the impersonator. The lookup is keyed on the LFID username (the
 * deprecated `sub` only when no username is available).
 *
 * The primary has no verified flag of its own and is the same root email as the session claim, so
 * it is included only when the session email passed the `email_verified` check
 * (`getEffectiveEmail` non-null); alternates are included only when auth-service marks them
 * verified. Unless `strict`, falls back to the single effective session email if the lookup fails
 * or returns no usable addresses.
 */
export async function resolveVerifiedUserEmails(
  req: Request,
  emailVerificationService: EmailVerificationService,
  options: ResolveVerifiedUserEmailsOptions = {}
): Promise<string[]> {
  const effectiveEmail = getEffectiveEmail(req)?.toLowerCase() ?? null;
  const userIdentifier = getEffectiveUsername(req) ?? getEffectiveSub(req);
  const fallback = effectiveEmail ? [effectiveEmail] : [];

  if (!userIdentifier) {
    logger.debug(req, 'resolve_user_emails', 'No effective identity for user, using session email only', {});
    return fallback;
  }

  // getUserEmails already maps NATS failures to null; this also covers anything thrown before its
  // own try (e.g. the codec), so a lookup failure takes exactly one of the two documented paths.
  const emailData = await emailVerificationService.getUserEmails(req, userIdentifier).catch((error: unknown) => {
    logger.warning(req, 'resolve_user_emails', 'auth-service email lookup threw', { err: error });
    return null;
  });

  if (!emailData) {
    if (options.strict) {
      throw new MicroserviceError('Unable to read your verified email addresses right now', 503, 'USER_EMAILS_UNAVAILABLE', {
        operation: 'resolve_user_emails',
        service: 'auth_service',
      });
    }
    return fallback;
  }

  const seen = new Set<string>();
  const verifiedEmails: string[] = [];

  const add = (email: string): void => {
    if (!email) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      verifiedEmails.push(lower);
    }
  };

  if (effectiveEmail) add(emailData.primary_email);
  for (const alt of emailData.alternate_emails) {
    if (alt.verified) add(alt.email);
  }

  logger.debug(req, 'resolve_user_emails', 'Resolved verified emails from auth-service', {
    alternate_count: emailData.alternate_emails.length,
    verified_count: verifiedEmails.length,
  });

  return verifiedEmails.length > 0 ? verifiedEmails : fallback;
}
