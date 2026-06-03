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
} from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE } from '@lfx-one/shared/constants';
import { Request } from 'express';

import {
  MOCK_DONATION_HISTORY,
  MOCK_DONATION_STATS,
  MOCK_INITIATIVES,
  MOCK_PAYMENT_METHOD,
  MOCK_RECURRING_DONATIONS,
  MOCK_TRANSACTIONS,
} from '../mock-data/crowdfunding.mock';
import { mapDonationHistoryToMyDonation, mapToInitiativeBase, mapToInitiativeDetail, mapToTransaction } from '../utils/crowdfunding-mapper';
import { logger } from './logger.service';

export class CrowdfundingService {
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
    logger.debug(req, 'get_my_payment_method', 'Fetching payment method for user', { username });

    logger.debug(req, 'get_my_payment_method', 'Returning payment method', {
      paymentMethodId: MOCK_PAYMENT_METHOD.paymentMethodId,
      brand: MOCK_PAYMENT_METHOD.brand,
    });

    return MOCK_PAYMENT_METHOD;
  }

  // Mock for POST /api/crowdfunding/payment-method — replace with upstream proxy once the payment-method service is live.
  public async saveMyPaymentMethod(req: Request, username: string, paymentMethodId: string): Promise<PaymentMethod> {
    logger.debug(req, 'save_my_payment_method', 'Saving payment method for user', { username, paymentMethodId });

    // Mock: Visa test card — real impl will proxy to POST /v1/me/payment-method.
    const saved: PaymentMethod = {
      paymentMethodId,
      brand: 'visa',
      lastFour: '4242',
      expiryMonth: 12,
      expiryYear: 2028,
    };

    logger.debug(req, 'save_my_payment_method', 'Payment method saved', { paymentMethodId });

    return saved;
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
    logger.debug(req, 'get_my_recurring_donations', 'Fetching recurring donations for user', { username });

    const total = MOCK_RECURRING_DONATIONS.length;

    logger.debug(req, 'get_my_recurring_donations', 'Returning recurring donations', { total });

    return { data: MOCK_RECURRING_DONATIONS, total, pageSize: total, offset: 0 };
  }

  public async getMyDonations(req: Request, username: string, pageSize?: number, offset?: number): Promise<MyDonationsResponse> {
    logger.debug(req, 'get_my_donations', 'Fetching donation history for user', { username, pageSize, offset });

    const initiativeIdByName = new Map(MOCK_INITIATIVES.map((i) => [i.name, i.id]));
    const allItems = MOCK_DONATION_HISTORY.map((item) => mapDonationHistoryToMyDonation(item, initiativeIdByName.get(item.initiativeName)));

    const total = allItems.length;
    const resolvedOffset = offset ?? 0;
    const resolvedPageSize = pageSize ?? DEFAULT_CROWDFUNDING_PAGE_SIZE;
    const page = allItems.slice(resolvedOffset, resolvedOffset + resolvedPageSize);

    logger.debug(req, 'get_my_donations', 'Returning donation history', { total, page: page.length });

    return { data: page, total, pageSize: resolvedPageSize, offset: resolvedOffset };
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
