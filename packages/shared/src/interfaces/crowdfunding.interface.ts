// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FundType } from '../enums/crowdfunding.enum';
import type { CROWDFUNDING_INITIATIVE_STATUSES, SPONSORSHIP_TIER_NAMES, SPONSORSHIP_DONATION_MODES } from '../constants/crowdfunding.constants';
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

/** Core initiative fields as returned by the LFX One server (normalized from the upstream crowdfunding service). */
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
  initiativeId?: string;
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
  donorName?: string;
  donorLogoUrl?: string;
  donorType: 'organization' | 'member';
  amountCents: number;
  /** Unix timestamp in milliseconds. */
  date: number;
  initiativeId?: string;
  initiativeName?: string;
  /** True when this donation was charged by a recurring subscription rather than a one-time payment. */
  recurring: boolean;
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

  beneficiaries?: Beneficiary[];
  sponsorshipTiers?: SponsorshipTier[];
  donationMode?: SponsorshipDonationMode;
}

export type CrowdfundingInitiativeStatus = (typeof CROWDFUNDING_INITIATIVE_STATUSES)[number];

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

// TODO: wire up when the CF API exposes charge status on subscription transactions
export type ChargeStatus = 'paid' | 'failed' | 'pending';

// TODO: wire up when charge-status is available from the CF API
export interface ChargeHistoryItem {
  id: string;
  /** Display period, e.g. "May 2026". */
  period: string;
  status: ChargeStatus;
  /** ISO date string of when the charge occurred. */
  dateCharged: string;
  amountCents: number;
}

export interface DonationStats {
  totalDonated: number;
  initiativesSupported: number;
  activeRecurringAmount: number;
  activeRecurringCount: number;
}

export type RecurringDonationStatus = 'active' | 'paused' | 'canceled';

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
  /** Slug of the associated initiative — used to fetch charge history. */
  initiativeSlug: string;
  /** Total amount contributed to this initiative in dollars. */
  totalContributed: number;
  /** Fund type of the associated initiative. */
  fundType: FundType;
  /** Short description of the initiative. */
  description?: string;
  /** Topic tags for the initiative. */
  tags?: string[];
  /** Public URL for the initiative on the crowdfunding site. */
  initiativeUrl?: string;
}

export type RecurringDonationsResponse = OffsetPaginatedResponse<RecurringDonation>;

/** Matches CardDetails from the upstream crowdfunding payment API. */
export interface PaymentMethod {
  paymentMethodId: string;
  brand: string;
  lastFour: string;
  expiryMonth: number;
  expiryYear: number;
}

export interface TopicOption {
  value: string;
  label: string;
}

export interface UpdateGoalInput {
  name: string;
  amountCents: number;
}

export interface Beneficiary {
  id: string;
  name?: string;
  email?: string;
}

export interface UpdateBeneficiaryInput {
  name?: string;
  email?: string;
}

export type SponsorshipTierName = (typeof SPONSORSHIP_TIER_NAMES)[number];

/** A configurable sponsorship level a project can offer sponsors. */
export interface SponsorshipTier {
  name: SponsorshipTierName;
  enabled: boolean;
  goalCents?: number;
  benefits: string[];
}

/** Whether sponsors pick from fixed tiers or choose their own amount. */
export type SponsorshipDonationMode = (typeof SPONSORSHIP_DONATION_MODES)[number];

export interface UpdateInitiativeInput {
  name?: string;
  description?: string;
  industry?: string;
  logoUrl?: string;
  websiteUrl?: string;
  status?: CrowdfundingInitiativeStatus;
  goals?: UpdateGoalInput[];
  beneficiaries?: UpdateBeneficiaryInput[];
  sponsorshipTiers?: SponsorshipTier[];
  donationMode?: SponsorshipDonationMode;
}

export interface PresignedURLResult {
  uploadUrl: string;
  destinationUrl: string;
  requiredHeaders: Record<string, string>;
}

export interface Announcement {
  id: string;
  initiativeId: string;
  createdBy: string;
  title: string;
  description: string;
  createdOn: string;
  updatedOn: string;
}

export interface AnnouncementList {
  data: Announcement[];
  totalCount: number;
}

export interface CreateAnnouncementInput {
  title: string;
  description: string;
}

export interface UpdateAnnouncementInput {
  title: string;
  description: string;
}

export type FundCategory = 'development' | 'marketing' | 'meetups' | 'bug_bounty' | 'travel' | 'documentation';

export interface FundDistributionItem {
  category: FundCategory;
  label: string;
  description: string;
  enabled: boolean;
  percentage: number;
}

export interface InitiativeMenuItem {
  label?: string;
  icon?: string;
  description?: string;
  danger?: boolean;
  command?: (event: unknown) => void;
}

export type AllowedLogoMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
