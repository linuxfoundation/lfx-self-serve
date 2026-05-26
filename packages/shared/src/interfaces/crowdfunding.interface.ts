// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FundType } from '../enums/crowdfunding.enum';
import { OffsetPaginatedResponse } from './api.interface';
import { DonutRing } from './donut-chart.interface';

export interface InitiativeStats {
  supporters: number;
}

export interface FundingStatus {
  goalsTotalCents: number;
  annualSubscriptionAmountInCents?: number;
  annualSubscriptionRemainingAmountInCents?: number;
  amountRaisedCents?: number;
  totalSubscriptionCount?: number;
}

/** Core initiative fields as returned by the crowdfunding API. */
export interface InitiativeBase {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: CrowdfundingInitiativeStatus;
  initiativeType: FundType;
  color: string;
  createdOn: string;
  updatedOn: string;
  industry?: string;
  logoUrl?: string;
  country?: string;
  city?: string;
  websiteUrl?: string;
  applicationUrl?: string;
  eventStartDate?: string;
  eventEndDate?: string;
  initiativeStats?: InitiativeStats;
  fundingStatus?: FundingStatus;
}

export type InitiativesResponse = OffsetPaginatedResponse<InitiativeBase>;

// Initiative detail types — GET /api/crowdfunding/initiatives/:slug.

export interface SponsorEntry {
  id: string;
  name: string;
  avatarUrl?: string;
  totalCents: number;
}

/** A single crowdfunding transaction returned by GET /initiatives/:slug/transactions */
export interface CrowdfundingTransaction {
  id: string;
  type: 'donations' | 'expenses';
  amountCents: number;
  date: string;
  category?: string;
  donorName?: string;
  donorType?: 'organization' | 'individual';
  donorLogoUrl?: string;
  donorUsername?: string;
}

export interface CrowdfundingTransactionList {
  data: CrowdfundingTransaction[];
  totalCount: number;
  from: number;
  size: number;
}

/** A donation made by the authenticated user — returned by GET /api/crowdfunding/my-donations. */
export interface MyDonation {
  id: string;
  /** Omitted until user-profile enrichment is available. */
  donorName?: string;
  donorLogoUrl?: string;
  donorType: 'organization' | 'member';
  amountCents: number;
  /** Unix timestamp in milliseconds. */
  date: number;
  initiativeId?: string;
  initiativeName?: string;
}

export type MyDonationsResponse = OffsetPaginatedResponse<MyDonation>;

export interface FundingGoal {
  id: string;
  name: string;
  donatedCents: number;
  spentCents: number;
  goalCents: number;
}

export interface FundingGoalWithMeta extends FundingGoal {
  formattedGoal: string;
  formattedDonated: string;
  formattedSpent: string;
  rings: DonutRing[];
}

export interface FinancialSummary {
  totalReceivedCents: number;
  totalExpensesCents: number;
  balanceCents: number;
}

export interface DonationRecord {
  id: string;
  date: string;
  supporterName: string;
  supporterLogoUrl?: string;
  supporterType: 'organization' | 'member';
  donorCategory: 'Company' | 'Individual';
  amountCents: number;
}

export interface ExpenseRecord {
  id: string;
  date: string;
  category: string;
  description: string;
  amountCents: number;
}

export interface ImpactStat {
  value: string;
  label: string;
}

export interface ProjectHealthStat {
  icon: string;
  label: string;
  value: string;
}

/** Full initiative data returned by the GET /initiatives/:slug detail endpoint. */
export interface InitiativeDetail extends InitiativeBase {
  githubUrl?: string;
  currentBalanceCents?: number;
  sponsors?: SponsorEntry[];
  impactStats?: ImpactStat[];
  projectHealthStats?: ProjectHealthStat[];
  projectHealthRating?: string;
  fundingGoals?: FundingGoal[];
  financialSummary?: FinancialSummary;
}

export type CrowdfundingInitiativeStatus = 'active' | 'pending' | 'closed';

export interface CrowdfundingInitiative {
  id: string;
  name: string;
  description: string;
  icon: string;
  fundType: FundType;
  status: CrowdfundingInitiativeStatus;
  raised: number;
  goal: number | null;
  sponsorsCount: number;
  publicUrl?: string;
}

export interface CrowdfundingInitiativesStats {
  activeCount: number;
  totalRaised: number;
  monthlyGain: number;
  totalSponsors: number;
}

export interface AllocationItem {
  name: string;
  spent: number;
  total: number;
  pct: number;
}

export interface AllocItemWithMeta extends AllocationItem {
  donated: number;
  formattedTotal: string;
  formattedDonated: string;
  formattedSpent: string;
  rings: DonutRing[];
}

export interface DonationTransaction {
  who: string;
  org?: boolean;
  amount: number;
  date: string;
}

export interface CrowdfundingInitiativeDetail extends CrowdfundingInitiative {
  about: string;
  balance: number;
  monthlyDelta: number;
  tags: string[];
  alloc: AllocationItem[];
  donationsIn: DonationTransaction[];
  donationsOut: DonationTransaction[];
  matchLabel?: string;
  matchDesc?: string;
  matchPct?: number;
}

export interface DonationStats {
  totalDonated: number;
  initiativesSupported: number;
  activeRecurringAmount: number;
  activeRecurringCount: number;
}

export type RecurringDonationStatus = 'active' | 'paused';
export type DonationKind = 'one-time' | 'monthly';

export interface RecurringDonation {
  id: string;
  name: string;
  icon: string;
  status: RecurringDonationStatus;
  amount: number;
  billingDescription: string;
  startDate: string;
  nextChargeDate?: string;
  pausedSince?: string;
}

export type RecurringDonationsResponse = OffsetPaginatedResponse<RecurringDonation>;

export interface DonationHistoryItem {
  id: string;
  initiativeName: string;
  initiativeIcon: string;
  fundType: FundType;
  fundTypeIcon: string;
  date: string;
  kind: DonationKind;
  amount: number;
}

/** Matches CardDetails from the upstream crowdfunding payment API. */
export interface PaymentMethod {
  paymentMethodId: string;
  brand: string;
  lastFour: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface InitiativeMenuItem {
  label?: string;
  icon?: string;
  description?: string;
  danger?: boolean;
  command?: (event: unknown) => void;
}
