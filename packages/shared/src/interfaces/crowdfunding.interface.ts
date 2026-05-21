// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FundType } from '../enums/crowdfunding.enum';

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

export interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expiry: string;
}
