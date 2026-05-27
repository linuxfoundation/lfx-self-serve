// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FundType } from '../enums/crowdfunding.enum';
import {
  CrowdfundingInitiativesStats,
  CrowdfundingTransaction,
  CrowdfundingTransactionList,
  DonationStats,
  InitiativesResponse,
  MyDonationsResponse,
  RecurringDonationsResponse,
} from '../interfaces/crowdfunding.interface';

export const CROWDFUNDING_FUND_TYPE_LABELS: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'General Fund',
  [FundType.SECURITY_AUDIT]: 'Security Audit',
  [FundType.MENTORSHIP]: 'Mentorship',
  [FundType.EVENT]: 'Event',
};

export const CROWDFUNDING_FUND_TYPE_ICONS: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'fa-light fa-piggy-bank',
  [FundType.SECURITY_AUDIT]: 'fa-light fa-shield-halved',
  [FundType.MENTORSHIP]: 'fa-light fa-user-group',
  [FundType.EVENT]: 'fa-light fa-calendar',
};

export const CROWDFUNDING_FUND_TYPE_COLOR_CLASSES: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'text-violet-600',
  [FundType.SECURITY_AUDIT]: 'text-amber-600',
  [FundType.MENTORSHIP]: 'text-emerald-600',
  [FundType.EVENT]: 'text-blue-600',
};

export const CROWDFUNDING_FUND_TYPE_AVATAR_CLASSES: Record<FundType, string> = {
  [FundType.GENERAL_FUND]: 'rounded-xl bg-violet-100 !text-violet-700',
  [FundType.SECURITY_AUDIT]: 'rounded-xl bg-amber-100 !text-amber-700',
  [FundType.MENTORSHIP]: 'rounded-xl bg-emerald-100 !text-emerald-700',
  [FundType.EVENT]: 'rounded-xl bg-blue-100 !text-blue-700',
};

export const CROWDFUNDING_DONOR_AVATAR_PALETTE: string[] = [
  'bg-blue-100 !text-blue-700',
  'bg-violet-100 !text-violet-700',
  'bg-emerald-100 !text-emerald-700',
  'bg-amber-100 !text-amber-700',
];

export const DEFAULT_CROWDFUNDING_PAGE_SIZE = 10;
export const EMPTY_INITIATIVES_RESPONSE: InitiativesResponse = { data: [], total: 0, pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset: 0 };
export const EMPTY_CROWDFUNDING_STATS: CrowdfundingInitiativesStats = { activeCount: 0, totalRaised: 0, monthlyGain: 0, totalSponsors: 0 };

export const EMPTY_TRANSACTION_LIST: CrowdfundingTransactionList = { data: [], totalCount: 0, from: 0, size: 0 };
export const EMPTY_TRANSACTION_STATE: { items: CrowdfundingTransaction[]; totalCount: number } = { items: [], totalCount: 0 };
export const EMPTY_MY_DONATIONS: MyDonationsResponse = { data: [], total: 0, pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset: 0 };
export const EMPTY_RECURRING_DONATIONS: RecurringDonationsResponse = { data: [], total: 0, pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset: 0 };
export const EMPTY_DONATION_STATS: DonationStats = { totalDonated: 0, initiativesSupported: 0, activeRecurringAmount: 0, activeRecurringCount: 0 };
