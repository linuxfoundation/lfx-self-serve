// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EmailManagementData, UserVerifiedEmails } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { getEffectiveEmail, getEffectiveSub, isImpersonating } from '../utils/auth-helper';
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

// Shared across service instances so one request costs one /me call.
const contactIdByRequest = new WeakMap<Request, Promise<string | null | undefined>>();

export class UserVerifiedEmailsService {
  private emailVerificationService = new EmailVerificationService();
  private meetingPreferenceService = new MeetingPreferenceService();

  /**
   * The signed-in user's v1 contact id, memoized per request so list views cost one `/me` call.
   * Null when anonymous, impersonating, or the lookup fails; callers fall back to email/username.
   */
  public async getContactIdForMatching(req: Request): Promise<string | null> {
    return (await this.getRequestContactId(req)) ?? null;
  }

  /**
   * The signed-in user's verified emails and v1 contact id, or none for an anonymous caller. Never throws.
   * `incomplete` is set when auth-service or the contact-id lookup failed; the preference is best-effort
   * since it is always a verified address.
   */
  public async getUserVerifiedEmails(req: Request): Promise<UserVerifiedEmails> {
    const sub = getEffectiveSub(req);
    if (!sub) {
      return { emails: [], preferenceEmail: null, contactId: null, incomplete: false };
    }

    // The gateway token belongs to the real session user, so skip the preference while impersonating.
    const v1Token = isImpersonating(req) ? undefined : req.apiGatewayToken;
    const [emailData, preference, contactId] = await Promise.all([
      this.emailVerificationService.getUserEmails(req, sub),
      v1Token ? this.meetingPreferenceService.getMeetingInviteEmail(req, v1Token) : Promise.resolve(undefined),
      this.getRequestContactId(req),
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
      contactId: contactId || null,
      // A missing gateway token or a failed /me is incomplete; a /me with no ID is a real "no contact".
      incomplete: !emailData || (!isImpersonating(req) && contactId === undefined),
    };
  }

  // Undefined means the lookup failed or was skipped; null means /me answered without an ID.
  private getRequestContactId(req: Request): Promise<string | null | undefined> {
    const v1Token = isImpersonating(req) ? undefined : req.apiGatewayToken;
    if (!v1Token) {
      return Promise.resolve(undefined);
    }
    let pending = contactIdByRequest.get(req);
    if (!pending) {
      pending = this.getContactId(req, v1Token);
      contactIdByRequest.set(req, pending);
    }
    return pending;
  }

  // Registrant rows keep the user's contact id as `user_id` even when sync rewrites the email.
  // Undefined means the lookup failed; null means /me answered without an ID.
  // Not UserService.getApiGatewayProfile: UserService imports MeetingService, so importing it here is circular.
  private async getContactId(req: Request, v1Token: string): Promise<string | null | undefined> {
    try {
      const response = await fetch(`${getUserServiceBaseUrl('get_contact_id', 'user_verified_emails_service')}/me?basic=true`, {
        headers: { Authorization: `Bearer ${v1Token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        logger.warning(req, 'get_contact_id', 'User-service /me returned a non-OK status', { status: response.status });
        return undefined;
      }
      const profile = (await response.json()) as { ID?: string };
      return profile.ID || null;
    } catch (error) {
      logger.warning(req, 'get_contact_id', 'User-service /me lookup failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return undefined;
    }
  }
}
