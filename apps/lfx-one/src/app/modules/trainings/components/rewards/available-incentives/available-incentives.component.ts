// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, Signal } from '@angular/core';
import { DecoratedAvailableIncentive, RewardPromotion } from '@lfx-one/shared/interfaces';
import { decorateAvailableIncentives } from '@lfx-one/shared/utils';

import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-available-incentives',
  imports: [ButtonComponent, DatePipe],
  templateUrl: './available-incentives.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvailableIncentivesComponent {
  // ─── Inputs ────────────────────────────────────────────────────────────────
  public readonly incentives = input.required<readonly RewardPromotion[]>();
  public readonly programStartDate = input<string | null>(null);
  public readonly redeemingUids = input<Record<string, boolean>>({});

  // ─── Outputs ───────────────────────────────────────────────────────────────
  public readonly copy = output<string>();
  public readonly claim = output<RewardPromotion>();

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly decoratedIncentives: Signal<DecoratedAvailableIncentive[]> = this.initDecoratedIncentives();

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onCopy(code: string): void {
    this.copy.emit(code);
  }

  protected onClaim(incentive: RewardPromotion): void {
    this.claim.emit(incentive);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initDecoratedIncentives(): Signal<DecoratedAvailableIncentive[]> {
    return computed(() => decorateAvailableIncentives(this.incentives(), this.programStartDate()));
  }
}
