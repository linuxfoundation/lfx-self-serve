// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { CredlyService } from '../services/credly.service';
import { logger } from '../services/logger.service';
import { SupabaseService } from '../services/supabase.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class BadgesController {
  private readonly credlyService = new CredlyService();
  private readonly supabaseService = new SupabaseService();

  /**
   * GET /api/badges
   * Get badges for the authenticated user from Credly.
   * Resolves all verified emails from Supabase so badges earned under secondary
   * addresses are included. Falls back to the single OIDC email on failure.
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
   * Resolve all verified email addresses for the authenticated user.
   * Queries Supabase for the full email list, filters to verified only.
   * Falls back to the single OIDC session email if Supabase lookup fails.
   */
  private async resolveUserEmails(req: Request): Promise<string[]> {
    const oidcEmail = (req.oidc?.user?.['email'] as string)?.toLowerCase();

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        logger.debug(req, 'resolve_user_emails', 'No username from auth, using OIDC email only', {});
        return oidcEmail ? [oidcEmail] : [];
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        logger.debug(req, 'resolve_user_emails', 'User not found in Supabase, using OIDC email only', {
          username,
        });
        return oidcEmail ? [oidcEmail] : [];
      }

      const userEmails = await this.supabaseService.getUserEmails(user.id);
      const verifiedEmails = userEmails.filter((e) => e.is_verified && typeof e.email === 'string').map((e) => e.email.toLowerCase());

      logger.debug(req, 'resolve_user_emails', 'Resolved verified emails from Supabase', {
        total_emails: userEmails.length,
        verified_count: verifiedEmails.length,
      });

      // If Supabase returned verified emails, use them; otherwise fall back to OIDC
      if (verifiedEmails.length > 0) return verifiedEmails;
      return oidcEmail ? [oidcEmail] : [];
    } catch (error) {
      logger.warning(req, 'resolve_user_emails', 'Failed to resolve emails from Supabase, falling back to OIDC email', {
        err: error instanceof Error ? error : new Error(String(error)),
      });
      return oidcEmail ? [oidcEmail] : [];
    }
  }
}
