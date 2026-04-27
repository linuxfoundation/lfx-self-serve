// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { CredlyService } from '../services/credly.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { logger } from '../services/logger.service';
import { getEffectiveEmail, getEffectiveSub } from '../utils/auth-helper';

export class BadgesController {
  private readonly credlyService = new CredlyService();
  private readonly emailVerificationService = new EmailVerificationService();

  /**
   * GET /api/badges
   * Get badges for the authenticated user from Credly.
   * Resolves all verified emails from auth-service so badges earned under secondary
   * addresses are included. Falls back to the single effective session email
   * (impersonated target during impersonation, otherwise the OIDC user) on failure.
   */
  public async getBadges(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_badges');

    try {
      const emails = await this.resolveUserEmails(req);

      if (emails.length === 0) {
        return next(new AuthenticationError('User authentication required', { operation: 'get_badges' }));
      }

      const badges = await this.credlyService.getBadgesForEmails(req, emails);

      logger.success(req, 'get_badges', startTime, {
        email_count: emails.length,
        badge_count: badges.length,
      });

      res.json(badges);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Resolve email addresses for the authenticated user used to look up Credly badges.
   * Queries auth-service via NATS and returns the primary email plus any alternate
   * emails flagged verified by auth-service (the primary has no separate verified flag,
   * so it is always included). Falls back to the single effective session email
   * (impersonated target during impersonation, otherwise the OIDC user) if the
   * auth-service lookup fails or returns no usable addresses.
   */
  private async resolveUserEmails(req: Request): Promise<string[]> {
    const effectiveEmail = getEffectiveEmail(req);
    const userSub = getEffectiveSub(req);

    if (!userSub) {
      logger.debug(req, 'resolve_user_emails', 'No effective sub for user, using session email only', {});
      return effectiveEmail ? [effectiveEmail] : [];
    }

    const emailData = await this.emailVerificationService.getUserEmails(req, userSub);

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

    add(emailData.primary_email);
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
}
