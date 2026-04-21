// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import { DecoratedCoupon, RewardPromotion } from '@lfx-one/shared/interfaces';
import { decorateCoupons } from '@lfx-one/shared/utils';

import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-my-coupons',
  imports: [ButtonComponent, DatePipe],
  templateUrl: './my-coupons.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyCouponsComponent {
  // ─── Inputs ────────────────────────────────────────────────────────────────
  public readonly coupons = input.required<readonly RewardPromotion[]>();
  public readonly rewardPoints = input.required<number>();
  public readonly programStartDate = input<string | null>(null);
  public readonly redeemingUids = input<Record<string, boolean>>({});

  // ─── Outputs ───────────────────────────────────────────────────────────────
  public readonly copy = output<string>();
  public readonly redeem = output<RewardPromotion>();

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly decoratedCoupons: Signal<DecoratedCoupon[]> = this.initDecoratedCoupons();

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onRedeem(coupon: RewardPromotion): void {
    this.redeem.emit(coupon);
  }

  protected onCopy(code: string): void {
    this.copy.emit(code);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initDecoratedCoupons(): Signal<DecoratedCoupon[]> {
    return computed(() => decorateCoupons(this.coupons(), this.rewardPoints(), this.programStartDate()));
  }
}
