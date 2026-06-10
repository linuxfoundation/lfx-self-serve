// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { UpdateInitiativeInput } from '@lfx-one/shared/interfaces';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { CrowdfundingAuthService } from '../services/crowdfunding-auth.service';
import { CrowdfundingService } from '../services/crowdfunding.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class CrowdfundingController {
  private readonly crowdfundingService = new CrowdfundingService();
  private readonly crowdfundingAuthService = new CrowdfundingAuthService();

  // GET /api/crowdfunding/initiatives
  public async getMyInitiatives(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_initiatives');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_my_initiatives' });
      }

      const initiatives = await this.crowdfundingService.getMyInitiatives(req);

      logger.success(req, 'get_my_initiatives', startTime, { result_count: initiatives.data.length });

      res.json(initiatives);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/crowdfunding/payment-method
  public async saveMyPaymentMethod(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'save_my_payment_method');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'save_my_payment_method' });
      }

      const rawId = (req.body as Record<string, unknown>)['paymentMethodId'];
      if (typeof rawId !== 'string' || !rawId.trim()) {
        throw ServiceValidationError.forField('paymentMethodId', 'paymentMethodId is required and must be a non-empty string', {
          operation: 'save_my_payment_method',
        });
      }
      const paymentMethodId = rawId.trim();

      const paymentMethod = await this.crowdfundingService.saveMyPaymentMethod(req, paymentMethodId);

      logger.success(req, 'save_my_payment_method', startTime, { paymentMethodId });

      res.json(paymentMethod);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/crowdfunding/payment-method
  public async getMyPaymentMethod(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_payment_method');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_my_payment_method' });
      }

      const paymentMethod = await this.crowdfundingService.getMyPaymentMethod(req);

      if (!paymentMethod) {
        res.status(404).json({ message: 'No payment method found' });
        return;
      }

      logger.success(req, 'get_my_payment_method', startTime);

      res.json(paymentMethod);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/crowdfunding/donation-stats
  public async getMyDonationStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_donation_stats');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_my_donation_stats' });
      }

      const stats = await this.crowdfundingService.getMyDonationStats(req);

      logger.success(req, 'get_my_donation_stats', startTime);

      res.json(stats);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/crowdfunding/recurring-donations
  public async getMyRecurringDonations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_recurring_donations');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_my_recurring_donations' });
      }

      const recurringDonations = await this.crowdfundingService.getMyRecurringDonations(req);

      logger.success(req, 'get_my_recurring_donations', startTime, { result_count: recurringDonations.data.length });

      res.json(recurringDonations);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/crowdfunding/my-donations
  public async getMyDonations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_donations');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_my_donations' });
      }

      const { pageSize, offset } = req.query;
      const parseNonNegativeInt = (val: unknown): number | undefined => {
        if (val == null || val === '') return undefined;
        const n = Number(val);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
      };

      const donations = await this.crowdfundingService.getMyDonations(req, parseNonNegativeInt(pageSize), parseNonNegativeInt(offset));

      logger.success(req, 'get_my_donations', startTime, { result_count: donations.data.length, total: donations.total });

      res.json(donations);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/crowdfunding/initiatives-stats
  public async getInitiativesStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_initiatives_stats');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_initiatives_stats' });
      }

      const stats = await this.crowdfundingService.getInitiativesStats(req);

      logger.success(req, 'get_initiatives_stats', startTime);

      res.json(stats);
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/crowdfunding/payment-method
  public async deleteMyPaymentMethod(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'delete_my_payment_method');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'delete_my_payment_method' });
      }

      await this.crowdfundingService.deleteMyPaymentMethod(req);

      logger.success(req, 'delete_my_payment_method', startTime);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/crowdfunding/subscriptions/:id
  public async cancelSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'cancel_subscription');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'cancel_subscription' });
      }

      const { id } = req.params;
      if (!id || !id.trim()) {
        throw ServiceValidationError.forField('id', 'Subscription id is required', { operation: 'cancel_subscription' });
      }

      await this.crowdfundingService.cancelSubscription(req, id.trim());

      logger.success(req, 'cancel_subscription', startTime, { subscriptionId: id });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/crowdfunding/initiatives/:slug — update an initiative's editable fields. */
  public async updateInitiative(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_initiative');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'update_initiative' });
      }

      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      const input: UpdateInitiativeInput = {};

      if (typeof body['name'] === 'string') input.name = body['name'].trim();
      if (typeof body['description'] === 'string') input.description = body['description'].trim();
      if (typeof body['industry'] === 'string') input.industry = body['industry'];
      if (typeof body['websiteUrl'] === 'string') input.websiteUrl = body['websiteUrl'].trim() || undefined;

      if (Array.isArray(body['goals'])) {
        input.goals = (body['goals'] as Record<string, unknown>[]).map((g) => ({
          name: typeof g['name'] === 'string' ? g['name'] : 'Annual Funding Goal',
          amountCents: typeof g['amountCents'] === 'number' ? Math.floor(g['amountCents']) : 0,
        }));
      }

      if (Array.isArray(body['beneficiaries'])) {
        input.beneficiaries = (body['beneficiaries'] as Record<string, unknown>[]).map((b) => ({
          name: typeof b['name'] === 'string' ? b['name'] : undefined,
          email: typeof b['email'] === 'string' ? b['email'] : undefined,
        }));
      }

      const initiative = await this.crowdfundingService.updateInitiative(req, id, input);

      logger.success(req, 'update_initiative', startTime, { id });
      res.json(initiative);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/crowdfunding/initiatives/:slug — fetch a single initiative by slug. */
  public async getInitiativeBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_initiative_by_slug');

    try {
      const { slug } = req.params;
      const initiative = await this.crowdfundingService.getInitiativeBySlug(req, slug);

      if (!initiative) {
        res.status(404).json({ message: `Initiative '${slug}' not found` });
        return;
      }

      logger.success(req, 'get_initiative_by_slug', startTime, { slug });

      res.json(initiative);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/crowdfunding/initiatives/:slug/transactions — paginated transactions list. */
  public async getInitiativeTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_initiative_transactions');

    try {
      const { slug } = req.params;
      const { type, size, from } = req.query;

      const ALLOWED_TYPES = ['donations', 'expenses'] as const;
      type AllowedType = (typeof ALLOWED_TYPES)[number];

      const resolvedType = type ? String(type) : undefined;
      if (resolvedType !== undefined && !ALLOWED_TYPES.includes(resolvedType as AllowedType)) {
        res.status(400).json({ message: `Invalid type '${resolvedType}'. Allowed values: ${ALLOWED_TYPES.join(', ')}` });
        return;
      }

      const parseNonNegativeInt = (val: unknown): number | undefined => {
        if (val == null || val === '') return undefined;
        const n = Number(val);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
      };

      const transactions = await this.crowdfundingService.getInitiativeTransactions(
        req,
        slug,
        resolvedType as AllowedType | undefined,
        parseNonNegativeInt(size),
        parseNonNegativeInt(from)
      );

      if (!transactions) {
        res.status(404).json({ message: `Initiative '${slug}' not found` });
        return;
      }

      logger.success(req, 'get_initiative_transactions', startTime, { slug, total: transactions.totalCount });

      res.json(transactions);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/crowdfunding/auth/start — initiates the CF auth-code flow.
  public startCrowdfundingAuth(req: Request, res: Response): void {
    const startTime = logger.startOperation(req, 'crowdfunding_auth_start');
    const returnTo = this.normalizeCrowdfundingReturnTo(req.query['returnTo']);

    if (!this.crowdfundingAuthService.isConfigured()) {
      logger.warning(req, 'crowdfunding_auth_start', 'Crowdfunding auth not configured', {});
      res.redirect(`${returnTo}?error=crowdfunding_auth_not_configured`);
      return;
    }

    const authorizeUrl = this.crowdfundingAuthService.getAuthorizationUrl(req, returnTo);
    logger.success(req, 'crowdfunding_auth_start', startTime, { return_to: returnTo });
    res.redirect(authorizeUrl);
  }

  // GET /crowdfunding/callback — Auth0 redirect target for the CF auth-code flow.
  public async handleCrowdfundingAuthCallback(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'crowdfunding_auth_callback');

    const code = req.query['code'] as string;
    const state = req.query['state'] as string;
    const error = req.query['error'] as string;
    const returnTo = this.normalizeCrowdfundingReturnTo(req.appSession?.crowdfundingAuthReturnTo);

    if (error) {
      // consent_required / interaction_required: prompt=none can't complete silently because
      // the user hasn't consented to the CF audience yet. Retry with a full interactive redirect
      // so they see the one-time consent screen. After consent, subsequent visits are silent.
      if (error === 'consent_required' || error === 'interaction_required') {
        logger.info(req, 'crowdfunding_auth_callback', 'Silent auth requires consent, retrying interactively', { error });
        const authorizeUrl = this.crowdfundingAuthService.getAuthorizationUrl(req, returnTo, false);
        res.redirect(authorizeUrl);
        return;
      }

      // login_required or any other error: fall through to the page without a CF token.
      logger.warning(req, 'crowdfunding_auth_callback', `Auth0 returned error: ${error}`, {
        error_description: req.query['error_description'],
      });
      res.redirect(returnTo);
      return;
    }

    if (!state || state !== req.appSession?.crowdfundingAuthState) {
      logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('Invalid state parameter'), {
        has_state: !!state,
        has_session_state: !!req.appSession?.crowdfundingAuthState,
      });
      res.redirect(`${returnTo}?error=invalid_state`);
      return;
    }

    if (!code) {
      logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('No authorization code received'), {});
      res.redirect(`${returnTo}?error=no_code`);
      return;
    }

    try {
      const tokenResponse = await this.crowdfundingAuthService.exchangeCodeForToken(req, code);

      const currentUserSub = req.oidc?.user?.['sub'] as string;
      if (!currentUserSub) {
        logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('Current user sub not found in login session'), {});
        res.redirect(`${returnTo}?error=login_session_invalid`);
        return;
      }

      if (!this.crowdfundingAuthService.decodeAndValidateSub(tokenResponse.access_token, currentUserSub)) {
        logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('Crowdfunding token sub mismatch'), {
          current_user_sub: currentUserSub,
        });
        res.redirect(`${returnTo}?error=user_mismatch`);
        return;
      }

      this.crowdfundingAuthService.storeToken(req, tokenResponse);

      delete req.appSession?.crowdfundingAuthState;
      delete req.appSession?.crowdfundingAuthReturnTo;

      logger.success(req, 'crowdfunding_auth_callback', startTime, {
        user_sub: currentUserSub,
        scope: tokenResponse.scope,
        expires_in: tokenResponse.expires_in,
      });

      res.redirect(returnTo);
    } catch (err) {
      logger.error(req, 'crowdfunding_auth_callback', startTime, err, {});
      res.redirect(`${returnTo}?error=token_exchange_failed`);
    }
  }

  // Accepts only in-app /crowdfunding paths to prevent open-redirect attacks.
  private normalizeCrowdfundingReturnTo(raw: unknown): string {
    const DEFAULT = '/crowdfunding/initiatives';
    if (typeof raw !== 'string' || raw.length === 0) return DEFAULT;
    try {
      const { pathname } = new URL(raw, 'http://internal');
      return pathname.startsWith('/crowdfunding') ? pathname : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }
}
