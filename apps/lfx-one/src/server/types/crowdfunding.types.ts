// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

// Raw snake_case shapes from the upstream crowdfunding service — server-only.

export interface BackendGoal {
  id: string;
  name: string;
  goal_amount_cents: number;
  description?: string;
  donated_cents?: number;
  spent_cents?: number;
}

export interface BackendSponsor {
  id: string;
  name: string;
  avatar_url?: string;
  total_cents: number;
}

export interface BackendInitiative {
  id: string;
  initiative_type: string;
  owner_id: string;
  name: string;
  slug: string;
  status: string;
  industry?: string;
  description?: string;
  color?: string;
  logo_url?: string;
  website_url?: string;
  country?: string;
  city?: string;
  application_url?: string;
  event_start_date?: string;
  event_end_date?: string;
  created_on: string;
  updated_on: string;
  financials?: {
    total_raised_cents: number;
    supporters: number;
    goals_total_cents: number;
    total_disbursed_cents?: number;
    available_balance_cents?: number;
  };
  goals?: BackendGoal[];
  sponsors?: BackendSponsor[];
  balance?: {
    total_raised_cents: number;
    total_disbursed_cents: number;
    available_cents: number;
  };
}

export interface BackendCrowdfundingResponse {
  data: BackendInitiative[];
  meta: { total: number; limit: number; offset: number };
}

export interface BackendTransaction {
  id: string;
  type: 'donations' | 'expenses';
  amount_cents: number;
  date: string;
  category?: string;
  donor_name?: string;
  donor_type?: 'organization' | 'individual';
  donor_logo_url?: string;
  donor_username?: string;
}

/** Raw snake_case response from GET /v1/me/payment-account on the upstream crowdfunding service. */
export interface PaymentMethodWire {
  payment_method_id: string;
  last_four: string;
  brand: string;
  expiry_month: number;
  expiry_year: number;
}

export interface BackendTransactionList {
  data: BackendTransaction[];
  total_count: number;
  from: number;
  size: number;
}

/** Raw snake_case donation shape from GET /v1/me/donations on the upstream crowdfunding service. */
export interface BackendDonation {
  id: string;
  initiative_id?: string;
  initiative_name?: string;
  category?: string;
  amount_cents: number;
  po_number?: string;
  payment_method?: string;
  status?: string;
  created_on: string;
  updated_on: string;
}

export interface BackendDonationListResponse {
  data: BackendDonation[];
  meta: { total: number; limit: number; offset: number };
}

/** Raw snake_case subscription shape from GET /v1/me/subscriptions on the upstream crowdfunding service. */
export interface BackendSubscription {
  id: string;
  initiative_id: string;
  initiative_name: string;
  initiative_logo_url?: string;
  status: string;
  amount_cents: number;
  interval: string;
  start_date: string;
  next_charge_date?: string;
  paused_at?: string;
}

export interface BackendSubscriptionListResponse {
  data: BackendSubscription[];
  meta: { total: number; limit: number; offset: number };
}

export interface BackendGoalInput {
  name: string;
  amount_cents: number;
}

export interface BackendBeneficiaryInput {
  name?: string;
  email?: string;
}

/** Snake_case PATCH body sent to PATCH /v1/me/initiatives/{id} on the upstream crowdfunding service. */
export interface BackendUpdateInitiativeInput {
  name?: string;
  description?: string;
  industry?: string;
  logo_url?: string;
  website_url?: string;
  status?: string;
  goals?: BackendGoalInput[];
  beneficiaries?: BackendBeneficiaryInput[];
}

/** Raw snake_case presigned-URL response from POST /v1/me/presigned-url. */
export interface PresignedURLWire {
  upload_url: string;
  destination_url: string;
  required_headers: Record<string, string>;
}
