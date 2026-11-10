// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { BackendInitiative, BackendMyTransaction, BackendOrgDonation, BackendSubscription, BackendTransaction } from '../types/crowdfunding.types';
import {
  mapMyTransactionToMyDonation,
  mapOrgDonation,
  mapSubscriptionToRecurringDonation,
  mapToInitiativeBase,
  mapToInitiativeDetail,
  mapToTransaction,
} from './crowdfunding-mapper';

function backend(overrides: Partial<BackendInitiative> = {}): BackendInitiative {
  return {
    id: 'synthetic-initiative-1',
    initiative_type: 'general_fund',
    owner_id: 'synthetic-owner',
    name: 'Synthetic Initiative',
    slug: 'synthetic-initiative',
    status: 'published',
    created_on: '2026-01-01T00:00:00Z',
    updated_on: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('crowdfunding mapper creator (lfx-crowdfunding#452)', () => {
  it('maps the creator CF sends on the lens list and the manage read', () => {
    expect(mapToInitiativeBase(backend({ creator: 'Synthetic Owner' })).creator).toBe('Synthetic Owner');
    expect(mapToInitiativeDetail(backend({ creator: 'Synthetic Owner' })).creator).toBe('Synthetic Owner');
  });

  it('leaves the creator unset when CF omits it or sends it blank', () => {
    expect(mapToInitiativeBase(backend()).creator).toBeUndefined();
    expect(mapToInitiativeBase(backend({ creator: '' })).creator).toBeUndefined();
  });
});

describe('crowdfunding mapper donor anonymity (lfx-crowdfunding#466)', () => {
  const myTransaction = (overrides: Partial<BackendMyTransaction> = {}): BackendMyTransaction => ({
    id: 'synthetic-ledger-row-1',
    type: 'donation',
    amount_cents: 1000,
    date: '2026-10-01T00:00:00Z',
    recurring: false,
    initiative_name: 'Synthetic Fund',
    donor_name: 'Synthetic Donor',
    ...overrides,
  });

  it("passes the anonymous flag and the CF donation/subscription ids through on the caller's own rows", () => {
    const oneTime = mapMyTransactionToMyDonation(myTransaction({ anonymous: true, donation_id: 'synthetic-donation-1' }));
    expect(oneTime).toMatchObject({ anonymous: true, donationId: 'synthetic-donation-1', donorName: 'Synthetic Donor' });
    expect(oneTime.subscriptionId).toBeUndefined();

    const recurring = mapMyTransactionToMyDonation(myTransaction({ recurring: true, anonymous: false, subscription_id: 'synthetic-subscription-1' }));
    expect(recurring).toMatchObject({ anonymous: false, subscriptionId: 'synthetic-subscription-1' });
    expect(recurring.donationId).toBeUndefined();
  });

  it('reads a row CF could not match (no ids, no flag) as not anonymous and not toggleable', () => {
    const row = mapMyTransactionToMyDonation(myTransaction({ donation_id: '', subscription_id: '' }));
    expect(row.anonymous).toBe(false);
    expect(row.donationId).toBeUndefined();
    expect(row.subscriptionId).toBeUndefined();
  });

  it('maps the subscription flag, defaulting to shown', () => {
    const sub: BackendSubscription = {
      id: 'synthetic-subscription-1',
      initiative_id: 'synthetic-initiative-1',
      initiative_name: 'Synthetic Fund',
      status: 'active',
      amount_cents: 500,
      frequency: 'monthly',
      created_on: '2026-10-01T00:00:00Z',
    };
    expect(mapSubscriptionToRecurringDonation(sub).anonymous).toBe(false);
    expect(mapSubscriptionToRecurringDonation({ ...sub, anonymous: true }).anonymous).toBe(true);
  });

  it('keeps the Anonymous name and empty email CF sends on an Org lens row', () => {
    const row: BackendOrgDonation = {
      id: 'synthetic-org-donation-1',
      type: 'one_time',
      donor_name: 'Anonymous',
      donor_email: '',
      anonymous: true,
      amount_cents: 2500,
      status: 'succeeded',
      created_on: '2026-10-01T00:00:00Z',
    };
    expect(mapOrgDonation(row)).toMatchObject({ donorName: 'Anonymous', donorEmail: '', anonymous: true });
    expect(mapOrgDonation({ ...row, anonymous: undefined, donor_name: 'Synthetic Donor' }).anonymous).toBe(false);
  });

  it('strips the donor identity from an anonymous org row even if CF sends it', () => {
    const leaked: BackendOrgDonation = {
      id: 'o2',
      type: 'one_time',
      donor_name: 'Synthetic Donor',
      donor_email: 'donor@example.com',
      anonymous: true,
      amount_cents: 100,
      status: 'succeeded',
      created_on: '2026-10-01T00:00:00Z',
    };
    expect(mapOrgDonation(leaked)).toMatchObject({ donorName: 'Anonymous', donorEmail: '' });
    expect(mapOrgDonation({ ...leaked, anonymous: false })).toMatchObject({ donorName: 'Synthetic Donor', donorEmail: 'donor@example.com' });
  });

  it('drops the donor username from an anonymous transaction row even if CF sends it', () => {
    const tx: BackendTransaction = {
      id: 't2',
      type: 'donations',
      amount_cents: 100,
      date: '2026-10-01',
      donor_name: 'Anonymous',
      donor_username: 'synthetic-user',
      anonymous: true,
    };
    expect(mapToTransaction(tx).donorUsername).toBeUndefined();
    expect(mapToTransaction({ ...tx, anonymous: false }).donorUsername).toBe('synthetic-user');
  });

  it('passes the anonymous flag through on initiative transaction rows', () => {
    const tx: BackendTransaction = { id: 't1', type: 'donations', amount_cents: 100, date: '2026-10-01', donor_name: 'Anonymous', anonymous: true };
    expect(mapToTransaction(tx)).toMatchObject({ donorName: 'Anonymous', anonymous: true });
    expect(mapToTransaction({ ...tx, anonymous: undefined }).anonymous).toBe(false);
  });
});
