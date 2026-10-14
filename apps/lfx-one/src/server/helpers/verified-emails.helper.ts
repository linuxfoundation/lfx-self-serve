// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VerifiedUserEmails } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { EmailVerificationService } from '../services/email-verification.service';
import { logger } from '../services/logger.service';
import { getEffectiveEmail, getEffectiveSub } from '../utils/auth-helper';

/**
 * Resolves the caller's email addresses from auth-service via NATS: the primary email plus every
 * alternate auth-service flags verified. The primary has no verified flag of its own and is the same
 * root email as the session claim, so it is included only when the session email passed the
 * `email_verified` check (`getEffectiveEmail` non-null). Unverified alternates are never used.
 *
 * Never fails: with no effective sub, or when auth-service is unavailable or returns nothing usable,
 * it falls back to the single effective session email (the impersonated target while impersonating,
 * otherwise the OIDC user).
 */
export async function resolveVerifiedUserEmails(req: Request, emailVerificationService: EmailVerificationService): Promise<VerifiedUserEmails> {
  const effectiveEmail = getEffectiveEmail(req);
  const fallback: VerifiedUserEmails = { emails: effectiveEmail ? [effectiveEmail.trim().toLowerCase()] : [], alternates: [] };
  const userSub = getEffectiveSub(req);

  if (!userSub) {
    logger.debug(req, 'resolve_user_emails', 'No effective sub for user, using session email only', {});
    return fallback;
  }

  const emailData = await emailVerificationService.getUserEmails(req, userSub);
  if (!emailData) {
    return fallback;
  }

  const seen = new Set<string>();
  const emails: string[] = [];
  const alternates: string[] = [];
  const add = (email: string | undefined, isAlternate: boolean): void => {
    const normalized = email?.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    emails.push(normalized);
    if (isAlternate) alternates.push(normalized);
  };

  if (effectiveEmail) add(emailData.primary_email, false);
  for (const alt of emailData.alternate_emails ?? []) {
    if (alt.verified) add(alt.email, true);
  }

  logger.debug(req, 'resolve_user_emails', 'Resolved verified emails from auth-service', {
    alternate_count: emailData.alternate_emails?.length ?? 0,
    verified_count: emails.length,
  });

  return emails.length > 0 ? { emails, alternates } : fallback;
}
