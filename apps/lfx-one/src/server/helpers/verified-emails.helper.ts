// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VerifiedUserEmails } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { EmailVerificationService } from '../services/email-verification.service';
import { logger } from '../services/logger.service';
import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';

/**
 * Resolves the caller's email addresses from auth-service via NATS: the primary email plus every
 * alternate auth-service flags verified. The primary has no verified flag of its own and is the same
 * root email as the session claim, so it is included only when the session email passed the
 * `email_verified` check (`getEffectiveEmail` non-null). Unverified alternates are never used.
 *
 * Looks the user up by the plain LFID username, or, for a session with no LF username (an unlinked
 * social or enterprise-SSO login), by the verified session email, which auth-service also resolves.
 *
 * Never fails: with neither, or when auth-service is unavailable or returns nothing usable, it falls back to the single effective session email (the impersonated target while impersonating,
 * otherwise the OIDC user).
 */
export async function resolveVerifiedUserEmails(req: Request, emailVerificationService: EmailVerificationService): Promise<VerifiedUserEmails> {
  const effectiveEmail = getEffectiveEmail(req);
  const fallback: VerifiedUserEmails = { emails: effectiveEmail ? [effectiveEmail.trim().toLowerCase()] : [], alternates: [] };
  // New code names the user by username, not the prefixed `sub` (`docs/architecture/backend/authentication.md`
  // § Migration); the verified session email covers sessions that have no LF username.
  const lookupKey = getEffectiveUsername(req) ?? effectiveEmail;

  if (!lookupKey) {
    logger.debug(req, 'resolve_user_emails', 'No effective username or verified email for user, nothing to look up', {});
    return fallback;
  }

  const emailData = await emailVerificationService.getUserEmails(req, lookupKey);
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
