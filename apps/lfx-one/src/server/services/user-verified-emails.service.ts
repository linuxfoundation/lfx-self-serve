// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EmailManagementData, UserVerifiedEmails } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername, isImpersonating } from '../utils/auth-helper';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';
import { MeetingPreferenceService } from './meeting-preference.service';

/**
 * The auth-service primary plus verified alternates, lowercased and deduped. The primary carries no
 * verified flag, so callers include it only when the session email passed `email_verified`.
 */
export function collectAuthServiceVerifiedEmails(emailData: EmailManagementData, includePrimary: boolean): string[] {
  const candidates = (emailData.alternate_emails ?? []).filter((alt) => alt.verified).map((alt) => alt.email);
  if (includePrimary) {
    candidates.unshift(emailData.primary_email);
  }
  return dedupeEmails(candidates);
}

function dedupeEmails(emails: (string | null | undefined)[]): string[] {
  const normalized = emails.map((email) => (email || '').trim().toLowerCase()).filter(Boolean);
  return [...new Set(normalized)];
}

export class UserVerifiedEmailsService {
  private emailVerificationService = new EmailVerificationService();
  private meetingPreferenceService = new MeetingPreferenceService();

  /**
   * The signed-in user's verified emails, or none for an anonymous caller. Never throws.
   * `incomplete` is set when auth-service failed or the preference could not be read (no gateway token or a failed lookup).
   */
  public async getUserVerifiedEmails(req: Request): Promise<UserVerifiedEmails> {
    const userIdentifier = getEffectiveUsername(req) ?? getEffectiveSub(req);
    if (!userIdentifier) {
      return { emails: [], preferenceEmail: null, incomplete: false };
    }

    // The gateway token belongs to the real session user, so skip the preference while impersonating.
    const impersonating = isImpersonating(req);
    const v1Token = impersonating ? undefined : req.apiGatewayToken;
    const [emailData, preference] = await Promise.all([
      this.emailVerificationService.getUserEmails(req, userIdentifier),
      v1Token ? this.meetingPreferenceService.getMeetingInviteEmail(req, v1Token) : Promise.resolve(undefined),
    ]);

    if (!emailData) {
      logger.warning(req, 'get_user_verified_emails', 'Auth-service emails unavailable, verified-email lookup incomplete', {
        has_preference: !!preference?.email,
      });
    }

    const authServiceEmails = emailData ? collectAuthServiceVerifiedEmails(emailData, !!getEffectiveEmail(req)) : [];
    const [preferenceEmail = null] = dedupeEmails([preference?.email]);
    return {
      emails: dedupeEmails([preferenceEmail, ...authServiceEmails]),
      preferenceEmail,
      incomplete: !emailData || (!impersonating && (!v1Token || preference === null)),
    };
  }
}
