// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { EMPTY_DONATION_STATS, EMPTY_MY_DONATIONS, EMPTY_RECURRING_DONATIONS } from '@lfx-one/shared/constants';
import { FundType } from '@lfx-one/shared/enums';
import { MyDonation, RecurringDonation } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MyDonationsComponent } from './my-donations.component';

const SUBSCRIPTION_ID = 'synthetic-subscription-1';

function row(overrides: Partial<MyDonation>): MyDonation {
  return {
    id: 'synthetic-row',
    donorType: 'member',
    amountCents: 1000,
    date: Date.UTC(2026, 9, 1),
    initiativeName: 'Synthetic Fund',
    recurring: false,
    anonymous: false,
    ...overrides,
  };
}

function subscription(): RecurringDonation {
  return {
    id: SUBSCRIPTION_ID,
    name: 'Synthetic Fund',
    icon: '',
    status: 'active',
    amount: 10,
    billingDescription: 'monthly',
    startDate: '2026-10-01',
    initiativeSlug: 'synthetic-fund',
    totalContributed: 20,
    fundType: FundType.GENERAL_FUND,
    anonymous: false,
  };
}

interface MyDonationsInternals {
  donationHistory(): MyDonation[];
  recurringDonations(): RecurringDonation[];
  onToggleDonationAnonymity(donation: MyDonation): void;
  onToggleRecurringAnonymity(donation: RecurringDonation): void;
}

describe('MyDonationsComponent donor anonymity (lfx-crowdfunding#466)', () => {
  let fixture: ComponentFixture<MyDonationsComponent>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let messages: { add: ReturnType<typeof vi.fn> };
  const rows = [
    row({ id: 'charge-1', recurring: true, subscriptionId: SUBSCRIPTION_ID }),
    row({ id: 'charge-2', recurring: true, subscriptionId: SUBSCRIPTION_ID }),
    row({ id: 'one-time', donationId: 'synthetic-donation-1' }),
  ];

  const component = (): MyDonationsInternals => fixture.componentInstance as unknown as MyDonationsInternals;

  beforeEach(async () => {
    service = {
      getMyPaymentMethod: vi.fn(() => of(null)),
      getMyDonationStats: vi.fn(() => of(EMPTY_DONATION_STATS)),
      getMyRecurringDonations: vi.fn(() => of({ ...EMPTY_RECURRING_DONATIONS, data: [subscription()], total: 1 })),
      getMyDonations: vi.fn(() => of({ ...EMPTY_MY_DONATIONS, data: rows, total: rows.length })),
      updateSubscriptionAnonymity: vi.fn((id: string, anonymous: boolean) => of({ id, anonymous })),
      updateDonationAnonymity: vi.fn((id: string, anonymous: boolean) => of({ id, anonymous })),
    };
    messages = { add: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [MyDonationsComponent],
      providers: [
        { provide: CrowdfundingService, useValue: service },
        { provide: MessageService, useValue: messages },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    })
      .overrideComponent(MyDonationsComponent, { set: { imports: [], template: '' } })
      .compileComponents();
    fixture = TestBed.createComponent(MyDonationsComponent);
    await fixture.whenStable();
  });

  it('hides the name on every charge of a subscription and on its recurring entry', () => {
    component().onToggleDonationAnonymity(component().donationHistory()[0]);

    expect(service['updateSubscriptionAnonymity']).toHaveBeenCalledWith(SUBSCRIPTION_ID, true);
    expect(
      component()
        .donationHistory()
        .map((d) => d.anonymous)
    ).toEqual([true, true, false]);
    expect(component().recurringDonations()[0].anonymous).toBe(true);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('changes a one-time donation by its CF donation id, leaving the subscription alone', () => {
    component().onToggleDonationAnonymity(component().donationHistory()[2]);

    expect(service['updateDonationAnonymity']).toHaveBeenCalledWith('synthetic-donation-1', true);
    expect(service['updateSubscriptionAnonymity']).not.toHaveBeenCalled();
    expect(
      component()
        .donationHistory()
        .map((d) => d.anonymous)
    ).toEqual([false, false, true]);
  });

  it('shows the name again from the recurring list', () => {
    component().onToggleRecurringAnonymity(component().recurringDonations()[0]);
    component().onToggleRecurringAnonymity(component().recurringDonations()[0]);

    expect(service['updateSubscriptionAnonymity']).toHaveBeenNthCalledWith(2, SUBSCRIPTION_ID, false);
    expect(component().recurringDonations()[0].anonymous).toBe(false);
  });

  it('keeps the setting and shows an error toast when the save fails', () => {
    service['updateDonationAnonymity'].mockReturnValueOnce(throwError(() => new Error('boom')));
    component().onToggleDonationAnonymity(component().donationHistory()[2]);

    expect(component().donationHistory()[2].anonymous).toBe(false);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
