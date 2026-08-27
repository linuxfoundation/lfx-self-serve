// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RewardPromotion } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { ButtonComponent } from '@components/button/button.component';

import { MyCouponsComponent } from './my-coupons.component';

const zeroPointCoupon: RewardPromotion = {
  id: 'free-training',
  uid: 'free-training',
  category: 'Training',
  title: 'Free training coupon',
  discountLabel: '100% OFF',
  redeemPoints: 0,
  eligible: true,
  redeemed: false,
  coupon: '',
  expiresAt: '',
  relativeExpiryInterval: 0,
  eligibilityComment: '',
  logo: '',
};

describe('MyCouponsComponent', () => {
  let fixture: ComponentFixture<MyCouponsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyCouponsComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MyCouponsComponent);
  });

  it('enables an eligible zero-point coupon when reward points are unavailable', async () => {
    fixture.componentRef.setInput('coupons', [zeroPointCoupon]);
    fixture.componentRef.setInput('rewardPoints', null);
    fixture.componentRef.setInput('availability', 'available');
    fixture.detectChanges();
    await fixture.whenStable();

    const redeemButton = fixture.debugElement.query((element) => element.componentInstance instanceof ButtonComponent).componentInstance as ButtonComponent;

    expect(redeemButton.disabled()).toBe(false);
  });
});
