// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CrowdfundingInitiativesStats,
  CrowdfundingTransactionList,
  DonationStats,
  InitiativeDetail,
  InitiativesResponse,
  MyDonationsResponse,
  PaymentMethod,
  RecurringDonationsResponse,
} from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import {
  BackendCrowdfundingResponse,
  BackendDonation,
  BackendInitiative,
  BackendSubscription,
  BackendTransactionList,
  PaymentMethodWire,
} from '../types/crowdfunding.types';
import { MicroserviceError } from '../errors';
import { getHttpErrorCode } from '../helpers/http-status.helper';
import {
  mapToInitiativeBase,
  mapToInitiativeDetail,
  mapCfDonationToMyDonation,
  mapSubscriptionToRecurringDonation,
  mapToTransaction,
  mapPaymentMethodWire,
} from '../utils/crowdfunding-mapper';
import { logger } from './logger.service';

const cfBaseUrl = (): string => (process.env['CROWDFUNDING_API_BASE_URL'] || '').replace(/\/+$/, '');

async function cfFetch<T>(req: Request, operation: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
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
  };
  if (options.body !== undefined) {
    (init as { body?: string }).body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new MicroserviceError(`CF API ${operation} returned ${response.status}`, response.status, getHttpErrorCode(response.status), {
      operation,
      service: 'crowdfunding',
      path,
      errorBody: text,
    });
  }
  return response.json() as Promise<T>;
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

  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new MicroserviceError(`CF API ${operation} returned ${response.status}`, response.status, getHttpErrorCode(response.status), {
      operation,
      service: 'crowdfunding',
      path,
      errorBody: text,
    });
  }
  return response.json() as Promise<T>;
}

// cfFetchPublic fetches a public CF endpoint (no authentication required).
// The request's crowdfunding token is forwarded when available, but its absence
// must not block the call. Returns null on 404; throws MicroserviceError otherwise.
async function cfFetchPublic<T>(req: Request, operation: string, path: string): Promise<T | null> {
  const baseUrl = cfBaseUrl();
  if (!baseUrl) {
    throw new MicroserviceError(`CROWDFUNDING_API_BASE_URL is not configured — cannot call ${operation}`, 503, 'CF_MISCONFIGURED', {
      operation,
      service: 'crowdfunding',
    });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (req.crowdfundingToken) {
    headers['Authorization'] = `Bearer ${req.crowdfundingToken}`;
  }
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new MicroserviceError(`CF API ${operation} returned ${response.status}`, response.status, getHttpErrorCode(response.status), {
      operation,
      service: 'crowdfunding',
      path,
      errorBody: text,
    });
  }
  return response.json() as Promise<T>;
}

export class CrowdfundingService {
  public async getMyInitiatives(req: Request): Promise<InitiativesResponse> {
    const startTime = logger.startOperation(req, 'cf_get_my_initiatives');

    const raw = await cfFetch<BackendCrowdfundingResponse>(req, 'getMyInitiatives', '/v1/me/initiatives');
    const data = raw.data.map(mapToInitiativeBase);

    logger.success(req, 'cf_get_my_initiatives', startTime, { count: data.length });
    return { data, total: raw.meta.total, pageSize: raw.meta.limit, offset: raw.meta.offset };
  }

  public async getInitiativesStats(req: Request): Promise<CrowdfundingInitiativesStats> {
    const { data } = await this.getMyInitiatives(req);
    return {
      activeCount: data.filter((i) => i.status === 'active').length,
      totalRaised: data.reduce((sum, i) => sum + (i.fundingStatus?.amountRaisedCents ?? 0), 0) / 100,
      monthlyGain: 0,
      totalSponsors: data.reduce((sum, i) => sum + (i.initiativeStats?.supporters ?? 0), 0),
    };
  }

  public async getInitiativeBySlug(req: Request, slug: string): Promise<InitiativeDetail | null> {
    const startTime = logger.startOperation(req, 'cf_get_initiative_by_slug', { slug });

    // GET /v1/initiatives/{slug} — public CF endpoint (no auth required); token forwarded if present.
    const raw = await cfFetchPublic<BackendInitiative>(req, 'getInitiativeBySlug', `/v1/me/initiatives/${encodeURIComponent(slug)}`);
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

    const token = req.crowdfundingToken;
    if (!token) {
      throw new MicroserviceError('No crowdfunding token available for deleteMyPaymentMethod', 401, 'CF_UNAUTHENTICATED', {
        operation: 'deleteMyPaymentMethod',
        service: 'crowdfunding',
      });
    }

    const baseUrl = cfBaseUrl();
    if (!baseUrl) {
      throw new MicroserviceError('CROWDFUNDING_API_BASE_URL is not configured — cannot call deleteMyPaymentMethod', 503, 'CF_MISCONFIGURED', {
        operation: 'deleteMyPaymentMethod',
        service: 'crowdfunding',
      });
    }

    const response = await fetch(`${baseUrl}/v1/me/payment-method`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new MicroserviceError(`CF API deleteMyPaymentMethod returned ${response.status}`, response.status, getHttpErrorCode(response.status), {
        operation: 'deleteMyPaymentMethod',
        service: 'crowdfunding',
        path: '/v1/me/payment-method',
        errorBody: text,
      });
    }

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
    const [donationsRaw, subscriptionsRaw] = await Promise.all([
      cfFetch<{ data: { amount_cents: number; initiative_id?: string }[]; meta: { total: number } }>(
        req,
        'getMyDonationStats_donations',
        '/v1/me/donations?limit=500'
      ),
      cfFetch<{ data: { status: string; amount_cents: number }[]; meta: { total: number } }>(
        req,
        'getMyDonationStats_subscriptions',
        '/v1/me/subscriptions?limit=500'
      ),
    ]);

    const totalDonated = donationsRaw.data.reduce((sum, d) => sum + d.amount_cents, 0) / 100;
    // Filter to valid string IDs before counting — donations without initiative_id are excluded.
    const initiativesSupported = new Set(donationsRaw.data.map((d) => d.initiative_id).filter((id): id is string => typeof id === 'string')).size;
    // Recurring counts and amounts come from active subscriptions, not one-time donations.
    const activeSubscriptions = subscriptionsRaw.data.filter((s) => s.status === 'active');
    const activeRecurringCount = activeSubscriptions.length;
    const activeRecurringAmount = activeSubscriptions.reduce((sum, s) => sum + s.amount_cents, 0) / 100;

    logger.success(req, 'cf_get_my_donation_stats', startTime);
    return { totalDonated, activeRecurringCount, activeRecurringAmount, initiativesSupported };
  }

  public async getMyRecurringDonations(req: Request): Promise<RecurringDonationsResponse> {
    const startTime = logger.startOperation(req, 'cf_get_my_recurring_donations');

    const raw = await cfFetch<{ data: BackendSubscription[]; meta: { total: number; limit: number; offset: number } }>(
      req,
      'getMyRecurringDonations',
      '/v1/me/subscriptions'
    );

    logger.success(req, 'cf_get_my_recurring_donations', startTime, { total: raw.meta.total });
    return { data: raw.data.map(mapSubscriptionToRecurringDonation), total: raw.meta.total, pageSize: raw.meta.limit, offset: raw.meta.offset };
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

  public async cancelSubscription(req: Request, subscriptionId: string): Promise<void> {
    const startTime = logger.startOperation(req, 'cf_cancel_subscription', { subscriptionId });

    const token = req.crowdfundingToken;
    if (!token) {
      throw new MicroserviceError('No crowdfunding token available for cancelSubscription', 401, 'CF_UNAUTHENTICATED', {
        operation: 'cancelSubscription',
        service: 'crowdfunding',
      });
    }

    const baseUrl = cfBaseUrl();
    if (!baseUrl) {
      throw new MicroserviceError('CROWDFUNDING_API_BASE_URL is not configured — cannot call cancelSubscription', 503, 'CF_MISCONFIGURED', {
        operation: 'cancelSubscription',
        service: 'crowdfunding',
      });
    }

    const response = await fetch(`${baseUrl}/v1/me/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new MicroserviceError(`CF API cancelSubscription returned ${response.status}`, response.status, getHttpErrorCode(response.status), {
        operation: 'cancelSubscription',
        service: 'crowdfunding',
        path: `/v1/me/subscriptions/${subscriptionId}`,
        errorBody: text,
      });
    }

    logger.success(req, 'cf_cancel_subscription', startTime, { subscriptionId });
  }

  public async getInitiativeTransactions(
    req: Request,
    slug: string,
    type?: 'donations' | 'expenses',
    size?: number,
    from?: number
  ): Promise<CrowdfundingTransactionList | null> {
    const startTime = logger.startOperation(req, 'cf_get_initiative_transactions', { slug, type, size, from });

    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (size != null) params.set('limit', String(size));
    if (from != null) params.set('offset', String(from));
    const qs = params.toString();

    // GET /v1/initiatives/{slug}/transactions — public CF endpoint (no auth required); token forwarded if present.
    const raw = await cfFetchPublic<BackendTransactionList>(
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
}
