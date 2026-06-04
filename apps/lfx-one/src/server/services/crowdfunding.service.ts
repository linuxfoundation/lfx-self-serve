// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  CrowdfundingInitiativesStats,
  CrowdfundingTransactionList,
  CrowdfundingTransaction,
  DonationStats,
  InitiativeDetail,
  InitiativesResponse,
  MyDonationsResponse,
  PaymentMethod,
  RecurringDonationsResponse,
  SetupIntent,
} from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { MOCK_DONATION_STATS, MOCK_INITIATIVES, MOCK_TRANSACTIONS } from '../mock-data/crowdfunding.mock';
import { BackendDonationListResponse, BackendSetupIntent, BackendSubscriptionListResponse, PaymentMethodWire } from '../types/crowdfunding.types';
import { mapCfDonationToMyDonation, mapPaymentMethodWire, mapSubscriptionToRecurringDonation, mapToInitiativeBase, mapToInitiativeDetail, mapToTransaction } from '../utils/crowdfunding-mapper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { exchangeRefreshTokenForAudience } from '../utils/refresh-token-exchange.util';
import { logger } from './logger.service';

export class CrowdfundingService {
  private async getToken(req: Request): Promise<string | null> {
    const audience = process.env['CROWDFUNDING_API_AUDIENCE'];
    if (!audience) return null;

    return exchangeRefreshTokenForAudience(req, {
      issuerBaseUrl: process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '',
      clientId: process.env['PCC_AUTH0_CLIENT_ID'] || '',
      clientSecret: process.env['PCC_AUTH0_CLIENT_SECRET'] || '',
      audience,
      sessionKey: 'crowdfundingToken',
    });
  }

  private getBaseUrl(): string | undefined {
    return process.env['CROWDFUNDING_API_BASE_URL'];
  }

  public async getMyInitiatives(req: Request, username: string): Promise<InitiativesResponse> {
    logger.debug(req, 'get_my_initiatives', 'Fetching crowdfunding initiatives for user', { username });

    const initiatives = MOCK_INITIATIVES.map(mapToInitiativeBase);

    logger.debug(req, 'get_my_initiatives', 'Returning initiatives', { count: initiatives.length });

    return {
      data: initiatives,
      total: initiatives.length,
      pageSize: initiatives.length,
      offset: 0,
    };
  }

  public async getInitiativesStats(req: Request, username: string): Promise<CrowdfundingInitiativesStats> {
    logger.debug(req, 'get_initiatives_stats', 'Computing initiatives stats for user', { username });

    const initiatives = MOCK_INITIATIVES.map(mapToInitiativeBase);

    const stats: CrowdfundingInitiativesStats = {
      activeCount: initiatives.filter((i) => i.status === 'active').length,
      totalRaised: initiatives.reduce((sum, i) => sum + (i.fundingStatus?.amountRaisedCents ?? 0), 0) / 100,
      monthlyGain: 0, // TODO: derive from real API once upstream exposes monthly gain
      totalSponsors: initiatives.reduce((sum, i) => sum + (i.initiativeStats?.supporters ?? 0), 0),
    };

    logger.debug(req, 'get_initiatives_stats', 'Returning initiatives stats', {
      activeCount: stats.activeCount,
      totalSponsors: stats.totalSponsors,
    });

    return stats;
  }

  public async getInitiativeBySlug(req: Request, username: string, slug: string): Promise<InitiativeDetail | null> {
    logger.debug(req, 'get_initiative_by_slug', 'Fetching initiative by slug', { username, slug });

    const initiative = MOCK_INITIATIVES.find((i) => i.slug === slug);

    if (!initiative) {
      logger.warning(req, 'get_initiative_by_slug', 'Initiative not found', { slug });
      return null;
    }

    return mapToInitiativeDetail(initiative);
  }

  public async getMyPaymentMethod(req: Request, username: string): Promise<PaymentMethod | null> {
    logger.debug(req, 'get_my_payment_method', 'Fetching payment method from CF API', { username });

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      logger.warning(req, 'get_my_payment_method', 'CROWDFUNDING_API_BASE_URL not set, returning null');
      return null;
    }

    const token = await this.getToken(req);
    if (!token) {
      logger.warning(req, 'get_my_payment_method', 'Could not obtain user token for crowdfunding API, returning null');
      return null;
    }

    const effectiveUsername = getEffectiveUsername(req);

    const response = await fetch(`${baseUrl}/v1/me/payment-account`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(effectiveUsername ? { 'X-Username': effectiveUsername } : {}),
      },
    });

    if (response.status === 404) {
      logger.debug(req, 'get_my_payment_method', 'No payment method on file for user', { username });
      return null;
    }

    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      logger.warning(req, 'get_my_payment_method', 'CF API returned non-OK status', { status: response.status, responseBody });
      return null;
    }

    const wire = (await response.json()) as PaymentMethodWire;
    return mapPaymentMethodWire(wire);
  }

  public async saveMyPaymentMethod(req: Request, username: string, paymentMethodId: string): Promise<PaymentMethod | null> {
    logger.debug(req, 'save_my_payment_method', 'Saving payment method for user', { username, paymentMethodId });

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      logger.warning(req, 'save_my_payment_method', 'CROWDFUNDING_API_BASE_URL not set, returning null');
      return null;
    }

    const token = await this.getToken(req);
    if (!token) {
      logger.warning(req, 'save_my_payment_method', 'Could not obtain user token for crowdfunding API, returning null');
      return null;
    }

    const effectiveUsername = getEffectiveUsername(req);

    const response = await fetch(`${baseUrl}/v1/me/payment-method`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(effectiveUsername ? { 'X-Username': effectiveUsername } : {}),
      },
      body: JSON.stringify({ payment_method_id: paymentMethodId }),
    });

    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      logger.warning(req, 'save_my_payment_method', 'CF API returned non-OK status', { status: response.status, responseBody });
      return null;
    }

    const wire = (await response.json()) as PaymentMethodWire;
    return mapPaymentMethodWire(wire);
  }

  public async deleteMyPaymentMethod(req: Request, username: string): Promise<void> {
    logger.debug(req, 'delete_my_payment_method', 'Deleting payment method for user', { username });

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      logger.warning(req, 'delete_my_payment_method', 'CROWDFUNDING_API_BASE_URL not set');
      return;
    }

    const token = await this.getToken(req);
    if (!token) {
      logger.warning(req, 'delete_my_payment_method', 'Could not obtain user token for crowdfunding API');
      return;
    }

    const effectiveUsername = getEffectiveUsername(req);

    const response = await fetch(`${baseUrl}/v1/me/payment-method`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(effectiveUsername ? { 'X-Username': effectiveUsername } : {}),
      },
    });

    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      logger.warning(req, 'delete_my_payment_method', 'CF API returned non-OK status', { status: response.status, responseBody });
    }
  }

  public async createSetupIntent(req: Request, username: string): Promise<SetupIntent | null> {
    logger.debug(req, 'create_setup_intent', 'Creating setup intent for user', { username });

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      logger.warning(req, 'create_setup_intent', 'CROWDFUNDING_API_BASE_URL not set, returning null');
      return null;
    }

    const token = await this.getToken(req);
    if (!token) {
      logger.warning(req, 'create_setup_intent', 'Could not obtain user token for crowdfunding API, returning null');
      return null;
    }

    const effectiveUsername = getEffectiveUsername(req);

    const response = await fetch(`${baseUrl}/v1/me/setup-intent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(effectiveUsername ? { 'X-Username': effectiveUsername } : {}),
      },
    });

    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      logger.warning(req, 'create_setup_intent', 'CF API returned non-OK status', { status: response.status, responseBody });
      return null;
    }

    const wire = (await response.json()) as BackendSetupIntent;
    return { clientSecret: wire.client_secret };
  }

  public async getMyDonationStats(req: Request, username: string): Promise<DonationStats> {
    logger.debug(req, 'get_my_donation_stats', 'Fetching donation stats for user', { username });

    logger.debug(req, 'get_my_donation_stats', 'Returning donation stats', {
      totalDonated: MOCK_DONATION_STATS.totalDonated,
      activeRecurringCount: MOCK_DONATION_STATS.activeRecurringCount,
    });

    return MOCK_DONATION_STATS;
  }

  public async getMyRecurringDonations(req: Request, username: string): Promise<RecurringDonationsResponse> {
    logger.debug(req, 'get_my_recurring_donations', 'Fetching subscriptions from CF API', { username });

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      logger.warning(req, 'get_my_recurring_donations', 'CROWDFUNDING_API_BASE_URL not set, returning empty');
      return { data: [], total: 0, pageSize: 0, offset: 0 };
    }

    const token = await this.getToken(req);
    if (!token) {
      logger.warning(req, 'get_my_recurring_donations', 'Could not obtain user token for crowdfunding API, returning empty');
      return { data: [], total: 0, pageSize: 0, offset: 0 };
    }

    const effectiveUsername = getEffectiveUsername(req);

    const response = await fetch(`${baseUrl}/v1/me/subscriptions`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(effectiveUsername ? { 'X-Username': effectiveUsername } : {}),
      },
    });

    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      logger.warning(req, 'get_my_recurring_donations', 'CF API returned non-OK status', { status: response.status, responseBody });
      return { data: [], total: 0, pageSize: 0, offset: 0 };
    }

    const body = (await response.json()) as BackendSubscriptionListResponse;
    const data = body.data.map(mapSubscriptionToRecurringDonation);

    logger.debug(req, 'get_my_recurring_donations', 'Returning subscriptions', { total: body.meta.total, page: data.length });

    return { data, total: body.meta.total, pageSize: body.meta.limit, offset: body.meta.offset };
  }

  public async getMyDonations(req: Request, username: string, pageSize?: number, offset?: number): Promise<MyDonationsResponse> {
    const resolvedPageSize = pageSize ?? DEFAULT_CROWDFUNDING_PAGE_SIZE;
    const resolvedOffset = offset ?? 0;

    logger.debug(req, 'get_my_donations', 'Fetching donation history from CF API', { username, pageSize: resolvedPageSize, offset: resolvedOffset });

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      logger.warning(req, 'get_my_donations', 'CROWDFUNDING_API_BASE_URL not set, returning empty');
      return { data: [], total: 0, pageSize: resolvedPageSize, offset: resolvedOffset };
    }

    const token = await this.getToken(req);
    if (!token) {
      logger.warning(req, 'get_my_donations', 'Could not obtain user token for crowdfunding API, returning empty');
      return { data: [], total: 0, pageSize: resolvedPageSize, offset: resolvedOffset };
    }

    const effectiveUsername = getEffectiveUsername(req);

    const url = new URL(`${baseUrl}/v1/me/donations`);
    url.searchParams.set('limit', String(resolvedPageSize));
    url.searchParams.set('offset', String(resolvedOffset));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(effectiveUsername ? { 'X-Username': effectiveUsername } : {}),
      },
    });

    if (!response.ok) {
      logger.warning(req, 'get_my_donations', 'CF API returned non-OK status', { status: response.status });
      return { data: [], total: 0, pageSize: resolvedPageSize, offset: resolvedOffset };
    }

    const body = (await response.json()) as BackendDonationListResponse;
    const data = body.data.map(mapCfDonationToMyDonation);

    logger.debug(req, 'get_my_donations', 'Returning donation history', { total: body.meta.total, page: data.length });

    return { data, total: body.meta.total, pageSize: resolvedPageSize, offset: resolvedOffset };
  }

  public async getInitiativeTransactions(
    req: Request,
    username: string,
    slug: string,
    type?: CrowdfundingTransaction['type'],
    size?: number,
    from?: number
  ): Promise<CrowdfundingTransactionList | null> {
    logger.debug(req, 'get_initiative_transactions', 'Fetching transactions for initiative', { username, slug, type, size, from });

    const allTransactions = MOCK_TRANSACTIONS[slug];

    if (allTransactions === undefined) {
      logger.warning(req, 'get_initiative_transactions', 'Initiative not found', { slug });
      return null;
    }

    const filtered = type ? allTransactions.filter((t) => t.type === type) : allTransactions;
    const pageSize = size ?? DEFAULT_CROWDFUNDING_PAGE_SIZE;
    const offset = from ?? 0;
    const page = filtered.slice(offset, offset + pageSize);

    logger.debug(req, 'get_initiative_transactions', 'Returning transactions', { total: filtered.length, page: page.length });

    return {
      data: page.map(mapToTransaction),
      totalCount: filtered.length,
      from: offset,
      size: pageSize,
    };
  }
}
