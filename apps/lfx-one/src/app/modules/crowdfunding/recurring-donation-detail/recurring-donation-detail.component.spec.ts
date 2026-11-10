// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { FundType } from '@lfx-one/shared/enums';
import { CrowdfundingTransaction, RecurringDonation } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecurringDonationDetailComponent } from './recurring-donation-detail.component';

const SUBSCRIPTION_ID = 'synthetic-subscription-1';

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

function charge(id: string): CrowdfundingTransaction {
  return { id, type: 'donations', amountCents: 1000, date: '2026-10-01', anonymous: false };
}

interface DetailInternals {
  donation(): RecurringDonation | undefined;
  chargeHistory(): CrowdfundingTransaction[];
  onToggleAnonymity(): void;
  onLoadMore(): void;
}

describe('RecurringDonationDetailComponent donor anonymity (lfx-crowdfunding#466)', () => {
  let fixture: ComponentFixture<RecurringDonationDetailComponent>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let messages: { add: ReturnType<typeof vi.fn> };

  const component = (): DetailInternals => fixture.componentInstance as unknown as DetailInternals;

  beforeEach(async () => {
    service = {
      getRecurringDonationById: vi.fn(() => of(subscription())),
      // Two pages: one charge each, two in total.
      getMyInitiativeTransactions: vi.fn((_slug: string, params: { from: number }) => of({ data: [charge(`charge-${params.from}`)], totalCount: 2 })),
      updateSubscriptionAnonymity: vi.fn((id: string, anonymous: boolean) => of({ id, anonymous })),
    };
    messages = { add: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [RecurringDonationDetailComponent],
      providers: [
        { provide: CrowdfundingService, useValue: service },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: SUBSCRIPTION_ID })) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    })
      .overrideComponent(RecurringDonationDetailComponent, {
        set: {
          imports: [],
          template: '',
          providers: [
            { provide: ConfirmationService, useValue: { confirm: vi.fn() } },
            { provide: MessageService, useValue: messages },
          ],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(RecurringDonationDetailComponent);
    await fixture.whenStable();
  });

  it('hides the name and keeps the charge pages already loaded', async () => {
    component().onLoadMore();
    await fixture.whenStable();
    expect(
      component()
        .chargeHistory()
        .map((c) => c.id)
    ).toHaveLength(2);
    const calls = service['getMyInitiativeTransactions'].mock.calls.length;

    component().onToggleAnonymity();
    await fixture.whenStable();

    expect(service['updateSubscriptionAnonymity']).toHaveBeenCalledWith(SUBSCRIPTION_ID, true);
    expect(component().donation()?.anonymous).toBe(true);
    expect(component().chargeHistory()).toHaveLength(2);
    expect(service['getMyInitiativeTransactions'].mock.calls.length).toBe(calls);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('keeps the current setting and reports an error when saving fails', async () => {
    service['updateSubscriptionAnonymity'].mockReturnValue(throwError(() => new Error('boom')));

    component().onToggleAnonymity();
    await fixture.whenStable();

    expect(component().donation()?.anonymous).toBe(false);
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
