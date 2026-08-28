// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { RewardPromotion, RewardsSummaryResponse } from '@lfx-one/shared/interfaces';
import { RewardsService } from '@shared/services/rewards.service';
import { UserService } from '@shared/services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RewardsComponent } from './rewards.component';

const LFID_CLAIM = 'https://sso.linuxfoundation.org/claims/username';

const pointsCoupon: RewardPromotion = {
  id: 'tux-500',
  uid: 'tux-500',
  category: 'Training',
  title: 'Tux coupon',
  discountLabel: '50% OFF',
  redeemPoints: 500,
  eligible: true,
  redeemed: false,
  coupon: '',
  expiresAt: '',
  relativeExpiryInterval: 0,
  eligibilityComment: '',
  logo: '',
};

function rewardsSummary(points: number, coupons: RewardPromotion[] = []): RewardsSummaryResponse {
  return {
    availability: { profile: 'available', promotions: 'available' },
    readOnly: false,
    points,
    nextRewardPoints: 1_000,
    pointsToNextReward: 1_000 - points,
    progressPercentage: Math.round((points / 1_000) * 100),
    programStartDate: null,
    programExpiryDate: null,
    groupedPromotions: {
      Event: { earned: [], redeemable: [] },
      Training: { earned: [], redeemable: [] },
      Certification: { earned: [], redeemable: [] },
    },
    availableIncentives: [],
    coupons,
  };
}

describe('RewardsComponent subject transitions', () => {
  let fixture: ComponentFixture<RewardsComponent>;
  const user = signal<Record<string, string> | null>({ [LFID_CLAIM]: 'first-user' });
  const impersonating = signal(false);
  const viewerUsername = computed(() => user()?.['username'] || user()?.[LFID_CLAIM] || null);
  const getSummary = vi.fn();
  let confirmationService: ConfirmationService;

  beforeEach(async () => {
    user.set({ [LFID_CLAIM]: 'first-user' });
    impersonating.set(false);
    getSummary.mockReset();

    await TestBed.configureTestingModule({
      imports: [RewardsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: Clipboard, useValue: { copy: vi.fn() } },
        MessageService,
        ConfirmationService,
        { provide: RewardsService, useValue: { getSummary, redeemPromotion: vi.fn() } },
        { provide: UserService, useValue: { user, impersonating, viewerUsername } },
      ],
    }).compileComponents();
    confirmationService = TestBed.inject(ConfirmationService);
    vi.spyOn(confirmationService, 'confirm');
  });

  it('clears the prior summary and loads the next canonical LFID subject', async () => {
    const firstSummary = new Subject<RewardsSummaryResponse>();
    const secondSummary = new Subject<RewardsSummaryResponse>();
    getSummary.mockReturnValueOnce(firstSummary).mockReturnValueOnce(secondSummary);

    fixture = TestBed.createComponent(RewardsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    firstSummary.next(rewardsSummary(100));
    fixture.detectChanges();
    expect(fixture.componentInstance.summary()?.points).toBe(100);

    user.set({ [LFID_CLAIM]: 'second-user' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getSummary).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.summary()).toBeNull();

    secondSummary.next(rewardsSummary(900));
    fixture.detectChanges();
    expect(fixture.componentInstance.summary()?.points).toBe(900);
  });

  it('does not open redemption confirmation when reward points are insufficient', () => {
    getSummary.mockReturnValue(of(rewardsSummary(499, [pointsCoupon])));
    fixture = TestBed.createComponent(RewardsComponent);
    fixture.detectChanges();

    fixture.componentInstance.onRedeemCoupon(pointsCoupon);

    expect(confirmationService.confirm).not.toHaveBeenCalled();
  });
});
