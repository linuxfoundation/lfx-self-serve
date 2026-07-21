// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { ALLOWED_LOGO_MIME_TYPES, CROWDFUNDING_INITIATIVE_STATUSES, SPONSORSHIP_DONATION_MODES, SPONSORSHIP_TIER_NAMES } from '@lfx-one/shared/constants';
import {
  CreateAnnouncementInput,
  CrowdfundingInitiativeStatus,
  SponsorshipDonationMode,
  SponsorshipTierName,
  UpdateAnnouncementInput,
  UpdateInitiativeInput,
} from '@lfx-one/shared/interfaces';
import { stripHtml } from '@lfx-one/shared/utils';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { CrowdfundingAuthService } from '../services/crowdfunding-auth.service';
import { CrowdfundingService } from '../services/crowdfunding.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

const parseNonNegativeInt = (val: unknown): number | undefined => {
  if (val == null || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

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

      const { pageSize, offset } = req.query;

      const initiatives = await this.crowdfundingService.getMyInitiatives(req, parseNonNegativeInt(pageSize), parseNonNegativeInt(offset));

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

      logger.success(req, 'get_my_payment_method', startTime);

      // null when the user has no payment method — not a 404, just an empty state
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

  /** POST /api/crowdfunding/presigned-url — obtain a presigned S3 URL for a logo upload. */
  public async getPresignedUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_presigned_url');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_presigned_url' });
      }

      const rawContentType = (req.body as Record<string, unknown>)['contentType'];
      if (typeof rawContentType !== 'string' || !rawContentType.trim()) {
        throw ServiceValidationError.forField('contentType', 'contentType is required', {
          operation: 'get_presigned_url',
        });
      }

      const contentType = rawContentType.trim();
      if (!ALLOWED_LOGO_MIME_TYPES.includes(contentType as (typeof ALLOWED_LOGO_MIME_TYPES)[number])) {
        throw ServiceValidationError.forField('contentType', `contentType must be one of: ${ALLOWED_LOGO_MIME_TYPES.join(', ')}`, {
          operation: 'get_presigned_url',
        });
      }

      const result = await this.crowdfundingService.getPresignedUrl(req, contentType);

      logger.success(req, 'get_presigned_url', startTime);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/crowdfunding/initiatives/:id — update an initiative's editable fields. */
  public async updateInitiative(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_initiative');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'update_initiative' });
      }

      const id = (req.params['id'] ?? '').trim();
      if (!id) {
        throw ServiceValidationError.forField('id', 'Initiative id is required', { operation: 'update_initiative' });
      }
      const body = req.body as Record<string, unknown>;

      const input: UpdateInitiativeInput = {};

      if (typeof body['name'] === 'string') input.name = body['name'].trim();
      if (typeof body['description'] === 'string') input.description = body['description'].trim();
      if (typeof body['industry'] === 'string') input.industry = body['industry'];
      if (typeof body['logoUrl'] === 'string') input.logoUrl = body['logoUrl'];
      if (typeof body['websiteUrl'] === 'string') input.websiteUrl = body['websiteUrl'].trim() || undefined;
      if (typeof body['status'] === 'string') {
        const rawStatus = body['status'];
        if (!CROWDFUNDING_INITIATIVE_STATUSES.includes(rawStatus as (typeof CROWDFUNDING_INITIATIVE_STATUSES)[number])) {
          throw ServiceValidationError.forField('status', `status must be one of: ${CROWDFUNDING_INITIATIVE_STATUSES.join(', ')}`, {
            operation: 'update_initiative',
          });
        }
        input.status = rawStatus as CrowdfundingInitiativeStatus;
      }

      if (Array.isArray(body['goals'])) {
        input.goals = (body['goals'] as Record<string, unknown>[]).map((g) => ({
          name: typeof g['name'] === 'string' ? g['name'] : 'Annual Funding Goal',
          amountCents: parseNonNegativeInt(g['amountCents']) ?? 0,
        }));
      }

      if (Array.isArray(body['beneficiaries'])) {
        input.beneficiaries = (body['beneficiaries'] as Record<string, unknown>[]).map((b) => ({
          name: typeof b['name'] === 'string' ? b['name'] : undefined,
          email: typeof b['email'] === 'string' ? b['email'] : undefined,
        }));
      }

      if (Array.isArray(body['sponsorshipTiers'])) {
        const rawTiers = body['sponsorshipTiers'] as unknown[];
        const hasInvalidTier = rawTiers.some(
          (t) =>
            !t || typeof t !== 'object' || !SPONSORSHIP_TIER_NAMES.includes((t as Record<string, unknown>)['name'] as (typeof SPONSORSHIP_TIER_NAMES)[number])
        );
        if (hasInvalidTier) {
          throw ServiceValidationError.forField('sponsorshipTiers', `tier name must be one of: ${SPONSORSHIP_TIER_NAMES.join(', ')}`, {
            operation: 'update_initiative',
          });
        }
        input.sponsorshipTiers = (rawTiers as Record<string, unknown>[]).map((t) => ({
          name: t['name'] as SponsorshipTierName,
          enabled: t['enabled'] === true,
          goalCents: parseNonNegativeInt(t['goalCents']),
          benefits: Array.isArray(t['benefits']) ? (t['benefits'] as unknown[]).filter((b): b is string => typeof b === 'string') : [],
        }));
      }

      if (body['donationMode'] !== undefined) {
        if (!SPONSORSHIP_DONATION_MODES.includes(body['donationMode'] as (typeof SPONSORSHIP_DONATION_MODES)[number])) {
          throw ServiceValidationError.forField('donationMode', `donationMode must be one of: ${SPONSORSHIP_DONATION_MODES.join(', ')}`, {
            operation: 'update_initiative',
          });
        }
        input.donationMode = body['donationMode'] as SponsorshipDonationMode;
      }

      const initiative = await this.crowdfundingService.updateInitiative(req, id, input);

      logger.success(req, 'update_initiative', startTime, { id });
      res.json(initiative);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/crowdfunding/recurring-donations/:id
  public async getRecurringDonationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_recurring_donation_by_id');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_recurring_donation_by_id' });
      }

      const { id } = req.params;
      if (!id || !id.trim()) {
        throw ServiceValidationError.forField('id', 'Subscription id is required', { operation: 'get_recurring_donation_by_id' });
      }

      const donation = await this.crowdfundingService.getRecurringDonationById(req, id.trim());

      if (!donation) {
        res.status(404).json({ message: `Recurring donation '${id}' not found` });
        return;
      }

      logger.success(req, 'get_recurring_donation_by_id', startTime, { id });

      res.json(donation);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/crowdfunding/initiatives/:slug — fetch a single initiative by slug. */
  public async getInitiativeBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_initiative_by_slug');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_initiative_by_slug' });
      }

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
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_initiative_transactions' });
      }

      const { slug } = req.params;
      const { type, size, from, kind } = req.query;

      const ALLOWED_TYPES = ['donations', 'expenses'] as const;
      type AllowedType = (typeof ALLOWED_TYPES)[number];

      const resolvedType = type ? String(type) : undefined;
      if (resolvedType !== undefined && !ALLOWED_TYPES.includes(resolvedType as AllowedType)) {
        res.status(400).json({ message: `Invalid type '${resolvedType}'. Allowed values: ${ALLOWED_TYPES.join(', ')}` });
        return;
      }

      const ALLOWED_KINDS = ['one-time', 'recurring'] as const;
      type AllowedKind = (typeof ALLOWED_KINDS)[number];

      const resolvedKind = kind ? String(kind) : undefined;
      if (resolvedKind !== undefined && !ALLOWED_KINDS.includes(resolvedKind as AllowedKind)) {
        res.status(400).json({ message: `Invalid kind '${resolvedKind}'. Allowed values: ${ALLOWED_KINDS.join(', ')}` });
        return;
      }

      const transactions = await this.crowdfundingService.getInitiativeTransactions(
        req,
        slug,
        resolvedType as AllowedType | undefined,
        parseNonNegativeInt(size),
        parseNonNegativeInt(from),
        resolvedKind as AllowedKind | undefined
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

  /** GET /api/crowdfunding/initiatives/:slug/my-transactions — paginated list of the caller's own contributions to the initiative. */
  public async getMyInitiativeTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_initiative_transactions');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_my_initiative_transactions' });
      }

      const { slug } = req.params;
      const { type, size, from, subscriptionOnly } = req.query;

      const ALLOWED_TYPES = ['donations', 'expenses'] as const;
      type AllowedType = (typeof ALLOWED_TYPES)[number];

      const resolvedType = type ? String(type) : undefined;
      if (resolvedType !== undefined && !ALLOWED_TYPES.includes(resolvedType as AllowedType)) {
        res.status(400).json({ message: `Invalid type '${resolvedType}'. Allowed values: ${ALLOWED_TYPES.join(', ')}` });
        return;
      }

      const transactions = await this.crowdfundingService.getMyInitiativeTransactions(
        req,
        slug,
        resolvedType as AllowedType | undefined,
        parseNonNegativeInt(size),
        parseNonNegativeInt(from),
        subscriptionOnly === 'true'
      );

      if (!transactions) {
        res.status(404).json({ message: `Initiative '${slug}' not found` });
        return;
      }

      logger.success(req, 'get_my_initiative_transactions', startTime, { slug, total: transactions.totalCount });

      res.json(transactions);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/crowdfunding/initiatives/:id/announcements — list announcements for an initiative. */
  public async getAnnouncements(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_announcements');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_announcements' });
      }

      const id = (req.params['id'] ?? '').trim();
      if (!id) {
        throw ServiceValidationError.forField('id', 'Initiative id is required', { operation: 'get_announcements' });
      }

      const announcements = await this.crowdfundingService.getAnnouncements(req, id);
      logger.success(req, 'get_announcements', startTime, { id, count: announcements.data.length });
      res.json(announcements);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/crowdfunding/initiatives/:id/announcements — create an announcement. */
  public async createAnnouncement(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_announcement');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'create_announcement' });
      }

      const id = (req.params['id'] ?? '').trim();
      if (!id) {
        throw ServiceValidationError.forField('id', 'Initiative id is required', { operation: 'create_announcement' });
      }

      const body = req.body as Record<string, unknown>;
      const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
      const description = typeof body['description'] === 'string' ? body['description'].trim() : '';

      if (!title) throw ServiceValidationError.forField('title', 'title is required', { operation: 'create_announcement' });
      if (!description || !stripHtml(description)) {
        throw ServiceValidationError.forField('description', 'description is required', { operation: 'create_announcement' });
      }

      const input: CreateAnnouncementInput = { title, description };
      const announcement = await this.crowdfundingService.createAnnouncement(req, id, input);
      logger.success(req, 'create_announcement', startTime, { id, announcementId: announcement.id });
      res.status(201).json(announcement);
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/crowdfunding/initiatives/:id/announcements/:announcementId — update an announcement. */
  public async updateAnnouncement(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_announcement');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'update_announcement' });
      }

      const id = (req.params['id'] ?? '').trim();
      const announcementId = (req.params['announcementId'] ?? '').trim();
      if (!id) throw ServiceValidationError.forField('id', 'Initiative id is required', { operation: 'update_announcement' });
      if (!announcementId) throw ServiceValidationError.forField('announcementId', 'announcementId is required', { operation: 'update_announcement' });

      const body = req.body as Record<string, unknown>;
      const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
      const description = typeof body['description'] === 'string' ? body['description'].trim() : '';

      if (!title) throw ServiceValidationError.forField('title', 'title is required', { operation: 'update_announcement' });
      if (!description || !stripHtml(description)) {
        throw ServiceValidationError.forField('description', 'description is required', { operation: 'update_announcement' });
      }

      const input: UpdateAnnouncementInput = { title, description };
      const announcement = await this.crowdfundingService.updateAnnouncement(req, id, announcementId, input);
      logger.success(req, 'update_announcement', startTime, { id, announcementId });
      res.json(announcement);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/crowdfunding/initiatives/:id/announcements/:announcementId — delete an announcement. */
  public async deleteAnnouncement(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'delete_announcement');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'delete_announcement' });
      }

      const id = (req.params['id'] ?? '').trim();
      const announcementId = (req.params['announcementId'] ?? '').trim();
      if (!id) throw ServiceValidationError.forField('id', 'Initiative id is required', { operation: 'delete_announcement' });
      if (!announcementId) throw ServiceValidationError.forField('announcementId', 'announcementId is required', { operation: 'delete_announcement' });

      await this.crowdfundingService.deleteAnnouncement(req, id, announcementId);
      logger.success(req, 'delete_announcement', startTime, { id, announcementId });
      res.status(204).send();
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
      res.redirect(this.returnToWithError(returnTo, 'crowdfunding_auth_not_configured'));
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

      // login_required or any other error: redirect with the error param so server.ts
      // does not immediately re-trigger the silent redirect (which checks !req.query['error']).
      logger.warning(req, 'crowdfunding_auth_callback', `Auth0 returned error: ${error}`, {
        error_description: req.query['error_description'],
      });
      res.redirect(this.returnToWithError(returnTo, encodeURIComponent(error)));
      return;
    }

    if (!state || state !== req.appSession?.crowdfundingAuthState) {
      logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('Invalid state parameter'), {
        has_state: !!state,
        has_session_state: !!req.appSession?.crowdfundingAuthState,
      });
      res.redirect(this.returnToWithError(returnTo, 'invalid_state'));
      return;
    }

    if (!code) {
      logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('No authorization code received'), {});
      res.redirect(this.returnToWithError(returnTo, 'no_code'));
      return;
    }

    try {
      const tokenResponse = await this.crowdfundingAuthService.exchangeCodeForToken(req, code);

      const currentUserSub = req.oidc?.user?.['sub'] as string;
      if (!currentUserSub) {
        logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('Current user sub not found in login session'), {});
        res.redirect(this.returnToWithError(returnTo, 'login_session_invalid'));
        return;
      }

      if (!this.crowdfundingAuthService.decodeAndValidateSub(tokenResponse.access_token, currentUserSub)) {
        logger.error(req, 'crowdfunding_auth_callback', startTime, new Error('Crowdfunding token sub mismatch'), {
          current_user_sub: currentUserSub,
        });
        res.redirect(this.returnToWithError(returnTo, 'user_mismatch'));
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
      res.redirect(this.returnToWithError(returnTo, 'token_exchange_failed'));
    }
  }

  private returnToWithError(returnTo: string, error: string): string {
    const sep = returnTo.includes('?') ? '&' : '?';
    return `${returnTo}${sep}error=${error}`;
  }

  // Accepts only in-app /crowdfunding paths to prevent open-redirect attacks.
  // Strips any existing `error` query params so they do not accumulate across
  // redirect rounds (e.g. if the client passes a returnTo that already contains
  // an error from a prior failed auth attempt).
  private normalizeCrowdfundingReturnTo(raw: unknown): string {
    const DEFAULT = '/crowdfunding/initiatives';
    if (typeof raw !== 'string' || raw.length === 0) return DEFAULT;
    try {
      const url = new URL(raw, 'http://internal');
      if (!url.pathname.startsWith('/crowdfunding')) return DEFAULT;
      url.searchParams.delete('error');
      const search = url.searchParams.size > 0 ? `?${url.searchParams.toString()}` : '';
      return url.pathname + search;
    } catch {
      return DEFAULT;
    }
  }
}
