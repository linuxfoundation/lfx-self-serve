// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  CrowdfundingTransaction,
  FinancialSummary,
  FundingGoal,
  InitiativeBase,
  InitiativeDetail,
  SponsorEntry,
  CrowdfundingInitiativeStatus,
  MyDonation,
  DonationHistoryItem,
  PaymentMethod,
  RecurringDonation,
  RecurringDonationStatus,
} from '@lfx-one/shared/interfaces';
import { FundType } from '@lfx-one/shared/enums';

import {
  BackendDonation,
  BackendGoal,
  BackendInitiative,
  BackendSponsor,
  BackendSubscription,
  BackendTransaction,
  PaymentMethodWire,
} from '../types/crowdfunding.types';

const VALID_INITIATIVE_STATUSES: CrowdfundingInitiativeStatus[] = ['submitted', 'pending', 'published', 'declined', 'hidden'];

function toValidInitiativeStatus(value: unknown): CrowdfundingInitiativeStatus {
  return VALID_INITIATIVE_STATUSES.includes(value as CrowdfundingInitiativeStatus) ? (value as CrowdfundingInitiativeStatus) : 'pending';
}

function toValidFundType(value: unknown): FundType {
  return Object.values(FundType).includes(value as FundType) ? (value as FundType) : FundType.GENERAL_FUND;
}

export function mapToInitiativeBase(b: BackendInitiative): InitiativeBase {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description ?? '',
    status: toValidInitiativeStatus(b.status),
    initiativeType: toValidFundType(b.initiative_type),
    color: b.color ?? '',
    createdOn: b.created_on,
    updatedOn: b.updated_on,
    industry: b.industry,
    logoUrl: b.logo_url,
    country: b.country,
    city: b.city,
    websiteUrl: b.website_url,
    applicationUrl: b.application_url,
    eventStartDate: b.event_start_date,
    eventEndDate: b.event_end_date,
    fundingStatus: b.financials
      ? {
          goalsTotalCents: b.financials.goals_total_cents,
          amountRaisedCents: b.financials.total_raised_cents,
        }
      : undefined,
    initiativeStats: b.financials ? { supporters: b.financials.supporters } : undefined,
  };
}

export function mapToInitiativeDetail(b: BackendInitiative): InitiativeDetail {
  return {
    ...mapToInitiativeBase(b),
    currentBalanceCents: b.financials?.available_balance_cents,
    sponsors: (b.sponsors ?? []).map(mapSponsor),
    fundingGoals: (b.goals ?? []).map(mapFundingGoal),
    financialSummary: b.financials ? mapFinancialSummary(b) : undefined,
    // Not yet available from the backend
    githubUrl: undefined,
    impactStats: undefined,
    projectHealthStats: undefined,
    projectHealthRating: undefined,
  };
}

function mapSponsor(s: BackendSponsor): SponsorEntry {
  return {
    id: s.id,
    name: s.name,
    avatarUrl: s.avatar_url,
    totalCents: s.total_cents,
  };
}

function mapFundingGoal(g: BackendGoal): FundingGoal {
  return {
    id: g.id,
    name: g.name,
    donatedCents: g.donated_cents ?? 0,
    spentCents: g.spent_cents ?? 0,
    goalCents: g.goal_amount_cents,
  };
}

function mapFinancialSummary(b: BackendInitiative): FinancialSummary {
  return {
    totalReceivedCents: b.financials!.total_raised_cents,
    totalExpensesCents: b.financials!.total_disbursed_cents ?? 0,
    balanceCents: b.financials!.available_balance_cents ?? 0,
  };
}

export function mapToTransaction(b: BackendTransaction): CrowdfundingTransaction {
  return {
    id: b.id,
    type: b.type,
    amountCents: b.amount_cents,
    date: b.date,
    category: b.category,
    donorName: b.donor_name,
    donorType: b.donor_type,
    donorLogoUrl: b.donor_logo_url,
    donorUsername: b.donor_username,
  };
}

// Maps a DonationHistoryItem to the MyDonation wire shape; initiativeId is a best-effort lookup.
export function mapDonationHistoryToMyDonation(item: DonationHistoryItem, initiativeId?: string): MyDonation {
  return {
    id: item.id,
    // donorName / donorLogoUrl omitted — require user-profile enrichment.
    donorType: 'member',
    amountCents: Math.round(item.amount * 100),
    date: new Date(item.date).getTime(),
    initiativeId,
    initiativeName: item.initiativeName,
  };
}

/** Maps a CF API CardDetails response (from GET /v1/me/payment-account) to the PaymentMethod shape. */
export function mapPaymentMethodWire(w: PaymentMethodWire): PaymentMethod {
  return {
    paymentMethodId: w.payment_method_id,
    brand: w.brand,
    lastFour: w.last_four,
    expiryMonth: w.expiry_month,
    expiryYear: w.expiry_year,
  };
}

/** Maps a CF API Donation (from GET /v1/me/donations) to the MyDonation wire shape. */
export function mapCfDonationToMyDonation(d: BackendDonation): MyDonation {
  return {
    id: d.id,
    donorType: 'member',
    amountCents: d.amount_cents,
    date: new Date(d.created_on).getTime(),
    initiativeId: d.initiative_id || undefined,
    initiativeName: d.initiative_name || undefined,
  };
}

const VALID_RECURRING_STATUSES: RecurringDonationStatus[] = ['active', 'paused'];

function toValidRecurringStatus(value: unknown): RecurringDonationStatus {
  return VALID_RECURRING_STATUSES.includes(value as RecurringDonationStatus) ? (value as RecurringDonationStatus) : 'active';
}

/** Maps a CF API Subscription (from GET /v1/me/subscriptions) to the RecurringDonation shape. */
export function mapSubscriptionToRecurringDonation(s: BackendSubscription): RecurringDonation {
  return {
    id: s.id,
    name: s.initiative_name,
    icon: s.initiative_logo_url ?? '',
    status: toValidRecurringStatus(s.status),
    amount: s.amount_cents / 100,
    billingDescription: s.interval,
    startDate: s.start_date,
    nextChargeDate: s.next_charge_date,
    pausedSince: s.paused_at,
  };
}
