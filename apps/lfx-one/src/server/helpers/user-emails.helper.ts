// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { EmailVerificationService } from '../services/email-verification.service';
import { logger } from '../services/logger.service';
import { getEffectiveEmail, getEffectiveSub } from '../utils/auth-helper';

/**
 * The signed-in user's verified email addresses (lowercased, de-duplicated, primary first), read
 * from auth-service `lfx.auth-service.user_emails.read`. Impersonation-aware: resolves the
 * impersonation target, never the impersonator.
 *
 * The primary has no verified flag of its own and is the same root email as the session claim, so
 * it is included only when the session email passed the `email_verified` check
 * (`getEffectiveEmail` non-null); alternates are included only when auth-service marks them
 * verified. Falls back to the single effective session email if the lookup fails or returns no
 * usable addresses.
 */
export async function resolveVerifiedUserEmails(req: Request, emailVerificationService: EmailVerificationService): Promise<string[]> {
  const effectiveEmail = getEffectiveEmail(req);
  const userSub = getEffectiveSub(req);

  if (!userSub) {
    logger.debug(req, 'resolve_user_emails', 'No effective sub for user, using session email only', {});
    return effectiveEmail ? [effectiveEmail] : [];
  }

  const emailData = await emailVerificationService.getUserEmails(req, userSub);

  if (!emailData) {
    return effectiveEmail ? [effectiveEmail] : [];
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

  if (verifiedEmails.length > 0) return verifiedEmails;
  return effectiveEmail ? [effectiveEmail] : [];
}
