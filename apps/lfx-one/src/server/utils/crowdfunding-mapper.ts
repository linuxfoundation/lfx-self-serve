// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  Announcement,
  Beneficiary,
  CrowdfundingTransaction,
  FinancialSummary,
  FundingGoal,
  InitiativeBase,
  InitiativeDetail,
  SponsorEntry,
  CrowdfundingInitiativeStatus,
  MyDonation,
  PaymentMethod,
  RecurringDonation,
  RecurringDonationStatus,
  SponsorshipTier,
  SponsorshipDonationMode,
} from '@lfx-one/shared/interfaces';
import { FundType } from '@lfx-one/shared/enums';
import { CROWDFUNDING_INITIATIVE_STATUSES, SPONSORSHIP_TIER_NAMES, SPONSORSHIP_DONATION_MODES } from '@lfx-one/shared/constants';

import {
  BackendAnnouncement,
  BackendBeneficiary,
  BackendGoal,
  BackendInitiative,
  BackendMyTransaction,
  BackendSponsor,
  BackendSponsorshipTier,
  BackendSubscription,
  BackendTransaction,
  PaymentMethodWire,
} from '../types/crowdfunding.types';

function toValidInitiativeStatus(value: unknown): CrowdfundingInitiativeStatus {
  return CROWDFUNDING_INITIATIVE_STATUSES.includes(value as CrowdfundingInitiativeStatus) ? (value as CrowdfundingInitiativeStatus) : 'pending';
}

function toValidDonationMode(value: unknown): SponsorshipDonationMode | undefined {
  return SPONSORSHIP_DONATION_MODES.includes(value as SponsorshipDonationMode) ? (value as SponsorshipDonationMode) : undefined;
}

function mapSponsorshipTier(t: BackendSponsorshipTier): SponsorshipTier | undefined {
  if (!SPONSORSHIP_TIER_NAMES.includes(t.name as SponsorshipTier['name'])) return undefined;
  return { name: t.name as SponsorshipTier['name'], enabled: t.enabled, goalCents: t.minimum, benefits: t.benefits };
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
    beneficiaries: (b.beneficiaries ?? []).map(mapBeneficiary),
    sponsorshipTiers: b.sponsorship_tiers?.map(mapSponsorshipTier).filter((t): t is SponsorshipTier => t !== undefined),
    donationMode: toValidDonationMode(b.donation_mode),
    // Not yet available from the backend
    githubUrl: undefined,
    impactStats: undefined,
    projectHealthStats: undefined,
    projectHealthRating: undefined,
  };
}

function mapBeneficiary(b: BackendBeneficiary): Beneficiary {
  return { id: b.id, name: b.name, email: b.email };
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
    initiativeId: b.initiative_id,
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

/** Maps a CF API transaction (from GET /v1/me/transactions) to the MyDonation wire shape. */
export function mapMyTransactionToMyDonation(t: BackendMyTransaction): MyDonation {
  return {
    id: t.id,
    donorName: t.donor_name || undefined,
    donorLogoUrl: t.donor_logo_url || undefined,
    donorType: t.donor_type === 'organization' ? 'organization' : 'member',
    amountCents: t.amount_cents,
    date: new Date(t.date).getTime(),
    initiativeName: t.initiative_name || undefined,
    recurring: t.recurring,
  };
}

const VALID_RECURRING_STATUSES: RecurringDonationStatus[] = ['active', 'paused', 'canceled'];

function toValidRecurringStatus(value: unknown): RecurringDonationStatus {
  return VALID_RECURRING_STATUSES.includes(value as RecurringDonationStatus) ? (value as RecurringDonationStatus) : 'active';
}

export function mapAnnouncementWire(b: BackendAnnouncement): Announcement {
  return {
    id: b.id,
    initiativeId: b.initiative_id,
    createdBy: b.created_by,
    title: b.title,
    description: b.description,
    createdOn: b.created_on,
    updatedOn: b.updated_on,
  };
}

/** Maps a CF API Subscription (from GET /v1/me/subscriptions) to the RecurringDonation shape. */
export function mapSubscriptionToRecurringDonation(s: BackendSubscription): RecurringDonation {
  return {
    id: s.id,
    name: s.initiative_name ?? '',
    icon: s.initiative_logo_url ?? '',
    status: toValidRecurringStatus(s.status),
    amount: s.amount_cents / 100,
    billingDescription: s.frequency,
    startDate: s.created_on,
    nextChargeDate: s.next_charge_date,
    pausedSince: s.paused_at,
    initiativeSlug: s.initiative_slug ?? s.initiative_id,
    totalContributed: s.total_contributed_cents != null ? s.total_contributed_cents / 100 : 0,
    fundType: toValidFundType(s.initiative_fund_type),
    description: s.initiative_description,
    tags: s.initiative_tags,
    initiativeUrl: s.initiative_url,
  };
}
