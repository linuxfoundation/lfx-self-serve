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
  BackendInitiative,
  BackendTransactionList,
  PaymentMethodWire,
} from '../types/crowdfunding.types';
import { mapToInitiativeBase, mapToInitiativeDetail, mapToTransaction } from '../utils/crowdfunding-mapper';
import { logger } from './logger.service';

const cfBaseUrl = (): string =>
  (process.env['CROWDFUNDING_API_BASE_URL'] || '').replace(/\/+$/, '');

async function cfFetch<T>(
  req: Request,
  operation: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = req.crowdfundingToken;
  if (!token) {
    throw new Error(`No crowdfunding token available for ${operation}`);
  }

  const baseUrl = cfBaseUrl();
  if (!baseUrl) {
    throw new Error(`CROWDFUNDING_API_BASE_URL is not configured — cannot call ${operation}`);
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
    throw new Error(`CF API ${operation} returned ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

// cfFetchNullable calls cfFetch but returns null on 404 instead of throwing.
// All other errors (401, 403, 5xx, network) are rethrown so the error handler
// can return an appropriate status rather than silently reporting "not found".
async function cfFetchNullable<T>(
  req: Request,
  operation: string,
  path: string,
): Promise<T | null> {
  const token = req.crowdfundingToken;
  if (!token) {
    throw new Error(`No crowdfunding token available for ${operation}`);
  }

  const baseUrl = cfBaseUrl();
  if (!baseUrl) {
    throw new Error(`CROWDFUNDING_API_BASE_URL is not configured — cannot call ${operation}`);
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
    throw new Error(`CF API ${operation} returned ${response.status}: ${text}`);
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

    // CF returns a bare initiative object for GET /v1/initiatives/{slug} (not a { data: [...] } array).
    const raw = await cfFetchNullable<BackendInitiative>(
      req,
      'getInitiativeBySlug',
      `/v1/initiatives/${encodeURIComponent(slug)}`,
    );

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
    return {
      paymentMethodId: raw.payment_method_id,
      lastFour: raw.last_four,
      brand: raw.brand,
      expiryMonth: raw.expiry_month,
      expiryYear: raw.expiry_year,
    };
  }

  public async saveMyPaymentMethod(req: Request, paymentMethodId: string): Promise<PaymentMethod> {
    const startTime = logger.startOperation(req, 'cf_save_my_payment_method');

    const raw = await cfFetch<PaymentMethodWire>(req, 'saveMyPaymentMethod', '/v1/me/payment-method', {
      method: 'POST',
      body: { payment_method_id: paymentMethodId },
    });

    logger.success(req, 'cf_save_my_payment_method', startTime);
    return {
      paymentMethodId: raw.payment_method_id,
      lastFour: raw.last_four,
      brand: raw.brand,
      expiryMonth: raw.expiry_month,
      expiryYear: raw.expiry_year,
    };
  }

  public async getMyDonationStats(req: Request): Promise<DonationStats> {
    const startTime = logger.startOperation(req, 'cf_get_my_donation_stats');

    const raw = await cfFetch<{ data: { status: string; amount_cents: number; initiative_id?: string }[]; meta: { total: number } }>(
      req,
      'getMyDonationStats',
      '/v1/me/donations?limit=500',
    );

    const totalDonated = raw.data.reduce((sum, d) => sum + d.amount_cents, 0) / 100;
    const activeRecurringCount = raw.data.filter((d) => d.status === 'active').length;
    const activeRecurringAmount = raw.data
      .filter((d) => d.status === 'active')
      .reduce((sum, d) => sum + d.amount_cents, 0) / 100;
    // Filter to valid string IDs before counting — donations without initiative_id are excluded.
    const initiativesSupported = new Set(raw.data.map((d) => d.initiative_id).filter((id): id is string => typeof id === 'string')).size;

    logger.success(req, 'cf_get_my_donation_stats', startTime);
    return { totalDonated, activeRecurringCount, activeRecurringAmount, initiativesSupported };
  }

  public async getMyRecurringDonations(req: Request): Promise<RecurringDonationsResponse> {
    const startTime = logger.startOperation(req, 'cf_get_my_recurring_donations');

    const raw = await cfFetch<{ data: RecurringDonationsResponse['data']; meta: { total: number; limit: number; offset: number } }>(
      req,
      'getMyRecurringDonations',
      '/v1/me/subscriptions',
    );

    logger.success(req, 'cf_get_my_recurring_donations', startTime, { total: raw.meta.total });
    return { data: raw.data, total: raw.meta.total, pageSize: raw.meta.limit, offset: raw.meta.offset };
  }

  public async getMyDonations(req: Request, pageSize?: number, offset?: number): Promise<MyDonationsResponse> {
    const startTime = logger.startOperation(req, 'cf_get_my_donations', { pageSize, offset });

    const limit = pageSize ?? DEFAULT_CROWDFUNDING_PAGE_SIZE;
    const off = offset ?? 0;
    const raw = await cfFetch<{ data: MyDonationsResponse['data']; meta: { total: number; limit: number; offset: number } }>(
      req,
      'getMyDonations',
      `/v1/me/donations?limit=${limit}&offset=${off}`,
    );

    logger.success(req, 'cf_get_my_donations', startTime, { total: raw.meta.total });
    return { data: raw.data, total: raw.meta.total, pageSize: raw.meta.limit, offset: raw.meta.offset };
  }

  public async getInitiativeTransactions(
    req: Request,
    slug: string,
    type?: 'donations' | 'expenses',
    size?: number,
    from?: number,
  ): Promise<CrowdfundingTransactionList | null> {
    const startTime = logger.startOperation(req, 'cf_get_initiative_transactions', { slug, type, size, from });

    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (size != null) params.set('limit', String(size));
    if (from != null) params.set('offset', String(from));
    const qs = params.toString();

    // GET /v1/initiatives/{slug}/transactions — public endpoint, accepts slug directly.
    const raw = await cfFetchNullable<BackendTransactionList>(
      req,
      'getInitiativeTransactions',
      `/v1/initiatives/${encodeURIComponent(slug)}/transactions${qs ? `?${qs}` : ''}`,
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
