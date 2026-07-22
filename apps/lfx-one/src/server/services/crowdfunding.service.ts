// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  Announcement,
  AnnouncementList,
  CreateAnnouncementInput,
  CrowdfundingInitiativesStats,
  CrowdfundingTransactionList,
  DonationStats,
  InitiativeDetail,
  InitiativesResponse,
  MyDonationsResponse,
  PaymentMethod,
  PresignedURLResult,
  RecurringDonation,
  RecurringDonationsResponse,
  UpdateAnnouncementInput,
  UpdateInitiativeInput,
} from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import {
  BackendAnnouncement,
  BackendBeneficiaryInput,
  BackendCrowdfundingResponse,
  BackendDonation,
  BackendGoalInput,
  BackendInitiative,
  BackendSponsorshipTierInput,
  BackendSubscription,
  BackendTransactionList,
  BackendUpdateInitiativeInput,
  PaymentMethodWire,
  PresignedURLWire,
} from '../types/crowdfunding.types';
import { MicroserviceError } from '../errors';
import { getHttpErrorCode } from '../helpers/http-status.helper';
import {
  mapAnnouncementWire,
  mapToInitiativeBase,
  mapToInitiativeDetail,
  mapCfDonationToMyDonation,
  mapSubscriptionToRecurringDonation,
  mapToTransaction,
  mapPaymentMethodWire,
} from '../utils/crowdfunding-mapper';
import { logger } from './logger.service';

const cfBaseUrl = (): string => (process.env['CROWDFUNDING_API_BASE_URL'] || '').replace(/\/+$/, '');

const CF_TIMEOUT_MS = 30_000;

function throwCfNetworkError(operation: string, error: unknown): never {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    throw new MicroserviceError(`CF API ${operation} timed out after ${CF_TIMEOUT_MS}ms`, 504, 'UPSTREAM_TIMEOUT', { operation, service: 'crowdfunding' });
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new MicroserviceError(`CF API ${operation} network error: ${message}`, 502, 'UPSTREAM_UNREACHABLE', { operation, service: 'crowdfunding' });
}

async function cfFetch<T>(req: Request, operation: string, path: string, options: { method?: string; body?: unknown; noBody?: boolean } = {}): Promise<T> {
  const token = req.crowdfundingToken;
  if (!token) {
    throw new MicroserviceError(`No crowdfunding token available for ${operation}`, 401, 'CF_UNAUTHENTICATED', { operation, service: 'crowdfunding' });
  }

  const baseUrl = cfBaseUrl();
  if (!baseUrl) {
    throw new MicroserviceError(`CROWDFUNDING_API_BASE_URL is not configured — cannot call ${operation}`, 503, 'CF_MISCONFIGURED', {
      operation,
      service: 'crowdfunding',
    });
  }

  const url = `${baseUrl}${path}`;
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(CF_TIMEOUT_MS),
  };
  if (options.body !== undefined) {
    (init as { body?: string }).body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error: unknown) {
    throwCfNetworkError(operation, error);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new MicroserviceError(`CF API ${operation} returned ${response.status}`, response.status, getHttpErrorCode(response.status), {
      operation,
      service: 'crowdfunding',
      path,
      errorBody: text.length > 500 ? `${text.slice(0, 500)}…(truncated)` : text,
    });
  }
  if (options.noBody) return undefined as T;
  return response.json() as Promise<T>;
}

async function cfFetchAllPages<T>(req: Request, operation: string, basePath: string, pageSize = 500): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const page = await cfFetch<{ data: T[]; meta: { total: number; limit: number; offset: number } }>(
      req,
      operation,
      `${basePath}?limit=${pageSize}&offset=${offset}`
    );
    all.push(...page.data);
    if (all.length >= page.meta.total || page.data.length === 0) break;
    offset += page.data.length;
  }
  return all;
}

// cfFetchNullable calls the authenticated CF API but returns null on 404 instead of throwing.
// All other errors (401, 403, 5xx, network) are rethrown so the error handler
// can return an appropriate status rather than silently reporting "not found".
async function cfFetchNullable<T>(req: Request, operation: string, path: string): Promise<T | null> {
  const token = req.crowdfundingToken;
  if (!token) {
    throw new MicroserviceError(`No crowdfunding token available for ${operation}`, 401, 'CF_UNAUTHENTICATED', { operation, service: 'crowdfunding' });
  }

  const baseUrl = cfBaseUrl();
  if (!baseUrl) {
    throw new MicroserviceError(`CROWDFUNDING_API_BASE_URL is not configured — cannot call ${operation}`, 503, 'CF_MISCONFIGURED', {
      operation,
      service: 'crowdfunding',
    });
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throwCfNetworkError(operation, error);
  }

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new MicroserviceError(`CF API ${operation} returned ${response.status}`, response.status, getHttpErrorCode(response.status), {
      operation,
      service: 'crowdfunding',
      path,
      errorBody: text.length > 500 ? `${text.slice(0, 500)}…(truncated)` : text,
    });
  }
  return response.json() as Promise<T>;
}

export class CrowdfundingService {
  public async getMyInitiatives(req: Request, pageSize?: number, offset?: number): Promise<InitiativesResponse> {
    const startTime = logger.startOperation(req, 'cf_get_my_initiatives', { pageSize, offset });

    const limit = pageSize ?? DEFAULT_CROWDFUNDING_PAGE_SIZE;
    const off = offset ?? 0;
    const raw = await cfFetch<BackendCrowdfundingResponse>(req, 'getMyInitiatives', `/v1/me/initiatives?limit=${limit}&offset=${off}`);
    const data = raw.data.map(mapToInitiativeBase);

    logger.success(req, 'cf_get_my_initiatives', startTime, { count: data.length });
    return { data, total: raw.meta.total, pageSize: raw.meta.limit, offset: raw.meta.offset };
  }

  public async getInitiativesStats(req: Request): Promise<CrowdfundingInitiativesStats> {
    // Page through all initiatives so stats reflect the user's complete set, not just the first page.
    const PAGE_SIZE = 100;
    const allInitiatives: Awaited<ReturnType<typeof this.getMyInitiatives>>['data'] = [];
    let offset = 0;
    while (true) {
      const page = await this.getMyInitiatives(req, PAGE_SIZE, offset);
      allInitiatives.push(...page.data);
      if (allInitiatives.length >= page.total || page.data.length === 0) break;
      offset += PAGE_SIZE;
    }
    return {
      activeCount: allInitiatives.filter((i) => i.status === 'published').length,
      totalRaised: allInitiatives.reduce((sum, i) => sum + (i.fundingStatus?.amountRaisedCents ?? 0), 0) / 100,
      monthlyGain: 0,
      totalSponsors: allInitiatives.reduce((sum, i) => sum + (i.initiativeStats?.supporters ?? 0), 0),
    };
  }

  public async getInitiativeBySlug(req: Request, slug: string): Promise<InitiativeDetail | null> {
    const startTime = logger.startOperation(req, 'cf_get_initiative_by_slug', { slug });

    // /v1/me/initiatives — owner-scoped endpoint; requires a CF token (initiative owners only, not public access)
    const raw = await cfFetchNullable<BackendInitiative>(req, 'getInitiativeBySlug', `/v1/me/initiatives/${encodeURIComponent(slug)}`);
    if (!raw) {
      logger.warning(req, 'cf_get_initiative_by_slug', 'Initiative not found', { slug });
      return null;
    }

    logger.success(req, 'cf_get_initiative_by_slug', startTime);
    return mapToInitiativeDetail(raw);
  }

  public async getMyPaymentMethod(req: Request): Promise<PaymentMethod | null> {
    const startTime = logger.startOperation(req, 'cf_get_my_payment_method');

    const raw = await cfFetchNullable<PaymentMethodWire>(req, 'getMyPaymentMethod', '/v1/me/payment-account');
    if (!raw) return null;

    logger.success(req, 'cf_get_my_payment_method', startTime);
    return mapPaymentMethodWire(raw);
  }

  public async deleteMyPaymentMethod(req: Request): Promise<void> {
    const startTime = logger.startOperation(req, 'cf_delete_my_payment_method');
    await cfFetch<void>(req, 'deleteMyPaymentMethod', '/v1/me/payment-method', { method: 'DELETE', noBody: true });
    logger.success(req, 'cf_delete_my_payment_method', startTime);
  }

  public async saveMyPaymentMethod(req: Request, paymentMethodId: string): Promise<PaymentMethod> {
    const startTime = logger.startOperation(req, 'cf_save_my_payment_method');

    const raw = await cfFetch<PaymentMethodWire>(req, 'saveMyPaymentMethod', '/v1/me/payment-method', {
      method: 'POST',
      body: { payment_method_id: paymentMethodId },
    });

    logger.success(req, 'cf_save_my_payment_method', startTime);
    return mapPaymentMethodWire(raw);
  }

  public async getMyDonationStats(req: Request): Promise<DonationStats> {
    const startTime = logger.startOperation(req, 'cf_get_my_donation_stats');

    // Recurring donations are subscriptions in CF — fetch both endpoints in parallel.
    const [allDonations, allSubscriptions] = await Promise.all([
      cfFetchAllPages<{ amount_cents: number; initiative_id?: string }>(req, 'getMyDonationStats_donations', '/v1/me/donations'),
      cfFetchAllPages<{ status: string; amount_cents: number }>(req, 'getMyDonationStats_subscriptions', '/v1/me/subscriptions'),
    ]);

    const totalDonated = allDonations.reduce((sum, d) => sum + d.amount_cents, 0) / 100;
    // Filter to valid string IDs before counting — donations without initiative_id are excluded.
    const initiativesSupported = new Set(allDonations.map((d) => d.initiative_id).filter((id): id is string => typeof id === 'string')).size;
    // Recurring counts and amounts come from active subscriptions, not one-time donations.
    const activeSubscriptions = allSubscriptions.filter((s) => s.status === 'active');
    const activeRecurringCount = activeSubscriptions.length;
    const activeRecurringAmount = activeSubscriptions.reduce((sum, s) => sum + s.amount_cents, 0) / 100;

    logger.success(req, 'cf_get_my_donation_stats', startTime);
    return { totalDonated, activeRecurringCount, activeRecurringAmount, initiativesSupported };
  }

  public async getMyRecurringDonations(req: Request): Promise<RecurringDonationsResponse> {
    const startTime = logger.startOperation(req, 'cf_get_my_recurring_donations');

    const all = await cfFetchAllPages<BackendSubscription>(req, 'getMyRecurringDonations', '/v1/me/subscriptions');

    const canceled = all.filter((s) => s.status === 'canceled').length;
    logger.success(req, 'cf_get_my_recurring_donations', startTime, { total: all.length, canceled });
    return { data: all.map(mapSubscriptionToRecurringDonation), total: all.length, pageSize: all.length, offset: 0 };
  }

  public async getMyDonations(req: Request, pageSize?: number, offset?: number): Promise<MyDonationsResponse> {
    const startTime = logger.startOperation(req, 'cf_get_my_donations', { pageSize, offset });

    const limit = pageSize ?? DEFAULT_CROWDFUNDING_PAGE_SIZE;
    const off = offset ?? 0;
    const raw = await cfFetch<{ data: BackendDonation[]; meta: { total: number; limit: number; offset: number } }>(
      req,
      'getMyDonations',
      `/v1/me/donations?limit=${limit}&offset=${off}`
    );

    logger.success(req, 'cf_get_my_donations', startTime, { total: raw.meta.total });
    return { data: raw.data.map(mapCfDonationToMyDonation), total: raw.meta.total, pageSize: raw.meta.limit, offset: raw.meta.offset };
  }

  public async getRecurringDonationById(req: Request, subscriptionId: string): Promise<RecurringDonation | null> {
    const startTime = logger.startOperation(req, 'cf_get_recurring_donation_by_id', { subscriptionId });

    const raw = await cfFetchNullable<BackendSubscription>(req, 'getRecurringDonationById', `/v1/me/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!raw) {
      logger.warning(req, 'cf_get_recurring_donation_by_id', 'Subscription not found', { subscriptionId });
      return null;
    }

    logger.success(req, 'cf_get_recurring_donation_by_id', startTime, { subscriptionId });
    return mapSubscriptionToRecurringDonation(raw);
  }

  public async cancelSubscription(req: Request, subscriptionId: string): Promise<void> {
    const startTime = logger.startOperation(req, 'cf_cancel_subscription', { subscriptionId });
    await cfFetch<void>(req, 'cancelSubscription', `/v1/me/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE', noBody: true });
    logger.success(req, 'cf_cancel_subscription', startTime, { subscriptionId });
  }

  public async updateInitiative(req: Request, id: string, input: UpdateInitiativeInput): Promise<InitiativeDetail> {
    const startTime = logger.startOperation(req, 'cf_update_initiative', { id });

    const body: BackendUpdateInitiativeInput = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.description !== undefined) body.description = input.description;
    if (input.industry !== undefined) body.industry = input.industry;
    if (input.logoUrl !== undefined) body.logo_url = input.logoUrl;
    if (input.websiteUrl !== undefined) body.website_url = input.websiteUrl;
    if (input.status !== undefined) body.status = input.status;
    if (input.goals !== undefined) {
      body.goals = input.goals.map((g): BackendGoalInput => ({ name: g.name, amount_cents: g.amountCents }));
    }
    if (input.beneficiaries !== undefined) {
      body.beneficiaries = input.beneficiaries.map((b): BackendBeneficiaryInput => ({ name: b.name, email: b.email }));
    }
    if (input.sponsorshipTiers !== undefined) {
      body.sponsorship_tiers = input.sponsorshipTiers.map(
        (t): BackendSponsorshipTierInput => ({ name: t.name, enabled: t.enabled, goal_amount_cents: t.goalCents, benefits: t.benefits })
      );
    }
    if (input.donationMode !== undefined) body.donation_mode = input.donationMode;

    const raw = await cfFetch<BackendInitiative>(req, 'updateInitiative', `/v1/me/initiatives/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });

    logger.success(req, 'cf_update_initiative', startTime, { id });
    return mapToInitiativeDetail(raw);
  }

  public async getAnnouncements(req: Request, initiativeId: string): Promise<AnnouncementList> {
    const startTime = logger.startOperation(req, 'cf_get_announcements', { initiativeId });
    const data = await cfFetchAllPages<BackendAnnouncement>(req, 'getAnnouncements', `/v1/initiatives/${encodeURIComponent(initiativeId)}/announcements`);
    logger.success(req, 'cf_get_announcements', startTime, { count: data.length });
    return { data: data.map(mapAnnouncementWire), totalCount: data.length };
  }

  public async createAnnouncement(req: Request, initiativeId: string, input: CreateAnnouncementInput): Promise<Announcement> {
    const startTime = logger.startOperation(req, 'cf_create_announcement', { initiativeId });
    const raw = await cfFetch<BackendAnnouncement>(req, 'createAnnouncement', `/v1/me/initiatives/${encodeURIComponent(initiativeId)}/announcements`, {
      method: 'POST',
      body: { title: input.title, description: input.description },
    });
    logger.success(req, 'cf_create_announcement', startTime, { announcementId: raw.id });
    return mapAnnouncementWire(raw);
  }

  public async updateAnnouncement(req: Request, initiativeId: string, announcementId: string, input: UpdateAnnouncementInput): Promise<Announcement> {
    const startTime = logger.startOperation(req, 'cf_update_announcement', { initiativeId, announcementId });
    const raw = await cfFetch<BackendAnnouncement>(
      req,
      'updateAnnouncement',
      `/v1/me/initiatives/${encodeURIComponent(initiativeId)}/announcements/${encodeURIComponent(announcementId)}`,
      { method: 'PUT', body: { title: input.title, description: input.description } }
    );
    logger.success(req, 'cf_update_announcement', startTime, { announcementId });
    return mapAnnouncementWire(raw);
  }

  public async deleteAnnouncement(req: Request, initiativeId: string, announcementId: string): Promise<void> {
    const startTime = logger.startOperation(req, 'cf_delete_announcement', { initiativeId, announcementId });
    await cfFetch<void>(
      req,
      'deleteAnnouncement',
      `/v1/me/initiatives/${encodeURIComponent(initiativeId)}/announcements/${encodeURIComponent(announcementId)}`,
      {
        method: 'DELETE',
        noBody: true,
      }
    );
    logger.success(req, 'cf_delete_announcement', startTime, { announcementId });
  }

  public async getPresignedUrl(req: Request, contentType: string): Promise<PresignedURLResult> {
    const startTime = logger.startOperation(req, 'cf_get_presigned_url');

    const raw = await cfFetch<PresignedURLWire>(req, 'getPresignedUrl', '/v1/me/presigned-url', {
      method: 'POST',
      body: { content_type: contentType },
    });

    logger.success(req, 'cf_get_presigned_url', startTime);
    return {
      uploadUrl: raw.upload_url,
      destinationUrl: raw.destination_url,
      requiredHeaders: raw.required_headers,
    };
  }

  public async getInitiativeTransactions(
    req: Request,
    slug: string,
    type?: 'donations' | 'expenses',
    size?: number,
    from?: number,
    kind?: 'one-time' | 'recurring'
  ): Promise<CrowdfundingTransactionList | null> {
    const startTime = logger.startOperation(req, 'cf_get_initiative_transactions', { slug, type, size, from, kind });

    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (size != null) params.set('limit', String(size));
    if (from != null) params.set('offset', String(from));
    if (kind) params.set('kind', kind);
    const qs = params.toString();

    // /v1/me/initiatives — owner-scoped endpoint; requires a CF token (initiative owners only, not public access)
    const raw = await cfFetchNullable<BackendTransactionList>(
      req,
      'getInitiativeTransactions',
      `/v1/me/initiatives/${encodeURIComponent(slug)}/transactions${qs ? `?${qs}` : ''}`
    );
    if (!raw) {
      logger.warning(req, 'cf_get_initiative_transactions', 'Initiative not found', { slug });
      return null;
    }

    logger.success(req, 'cf_get_initiative_transactions', startTime, { total: raw.total_count });

    return {
      data: raw.data.map(mapToTransaction),
      totalCount: raw.total_count,
      from: raw.from,
      size: raw.size,
    };
  }

  public async getMyInitiativeTransactions(
    req: Request,
    slug: string,
    type?: 'donations' | 'expenses',
    size?: number,
    from?: number,
    subscriptionOnly?: boolean
  ): Promise<CrowdfundingTransactionList | null> {
    const startTime = logger.startOperation(req, 'cf_get_my_initiative_transactions', { slug, type, size, from, subscriptionOnly });

    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (size != null) params.set('limit', String(size));
    if (from != null) params.set('offset', String(from));
    if (subscriptionOnly) params.set('subscriptionOnly', 'true');
    const qs = params.toString();

    // /v1/me/initiatives/{slug}/my-transactions — donor-scoped endpoint; returns the
    // authenticated caller's own contributions to the (published) initiative, regardless
    // of who owns it. Unlike the owner-scoped /transactions endpoint, this works for any donor.
    const raw = await cfFetchNullable<BackendTransactionList>(
      req,
      'getMyInitiativeTransactions',
      `/v1/me/initiatives/${encodeURIComponent(slug)}/my-transactions${qs ? `?${qs}` : ''}`
    );
    if (!raw) {
      logger.warning(req, 'cf_get_my_initiative_transactions', 'Initiative not found', { slug });
      return null;
    }

    logger.success(req, 'cf_get_my_initiative_transactions', startTime, { total: raw.total_count });

    return {
      data: raw.data.map(mapToTransaction),
      totalCount: raw.total_count,
      from: raw.from,
      size: raw.size,
    };
  }
}
