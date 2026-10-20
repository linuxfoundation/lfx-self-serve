// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, OnInit, output, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { CAMPAIGN_BIDDING_RULES } from '@lfx-one/shared/constants';
import type { CampaignBiddingControlView, CampaignBiddingDraft, CampaignBiddingPlatformRule, CampaignBiddingStrategy } from '@lfx-one/shared/interfaces';

/**
 * One platform's Bidding choice in the create flow (#3299): Automatic (the default) or Manual with a
 * max cost-per-click bid.
 *
 * Owns the form only. The implementation tab owns the choice, validates it against the rest of the
 * platform's config (objective, budget) with the shared `campaignBiddingError`, and passes the
 * result back in as `view` — so the error shown here is the same one that blocks the create.
 */
@Component({
  selector: 'lfx-campaign-bidding-control',
  imports: [ReactiveFormsModule, InputNumberComponent, RadioButtonComponent],
  templateUrl: './campaign-bidding-control.component.html',
  styleUrl: './campaign-bidding-control.component.scss',
})
export class CampaignBiddingControlComponent implements OnInit {
  public readonly view = input.required<CampaignBiddingControlView>();

  public readonly biddingChange = output<CampaignBiddingDraft>();

  public readonly form = new FormGroup({
    strategy: new FormControl<CampaignBiddingStrategy>('automatic', { nonNullable: true }),
    bidAmount: new FormControl<number | null>(null),
  });

  protected readonly rule: Signal<CampaignBiddingPlatformRule> = computed(() => CAMPAIGN_BIDDING_RULES[this.view().platform]);
  protected readonly amountLabel: Signal<string> = computed(() => (this.rule().currency === 'USD' ? 'Max CPC bid (USD)' : 'Max CPC bid (ad account currency)'));
  protected readonly isManual: Signal<boolean> = computed(() => this.view().value.strategy === 'manual');
  protected readonly ids = computed(() => {
    const prefix = `campaign-bidding-${this.view().platform}`;
    return {
      name: `${prefix}-strategy`,
      automatic: `${prefix}-automatic`,
      manual: `${prefix}-manual`,
      amount: `${prefix}-amount`,
      currency: `${prefix}-currency`,
      limit: `${prefix}-limit`,
      error: `${prefix}-error`,
    };
  });
  /** What the always-mounted live region says: the bid error while Manual has one, otherwise nothing. */
  protected readonly liveMessage: Signal<string> = computed(() => (this.isManual() ? (this.view().error ?? '') : ''));
  /** `aria-describedby` for the bid: the currency hint and the limits, plus the error when there is one. */
  protected readonly amountDescribedBy: Signal<string> = this.initAmountDescribedBy();

  public constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const { strategy, bidAmount } = this.form.getRawValue();
      this.biddingChange.emit({ strategy, bidAmount: typeof bidAmount === 'number' && Number.isFinite(bidAmount) ? bidAmount : null });
    });
  }

  public ngOnInit(): void {
    // Inputs are not readable in a field initializer. Seeded without emitting: restoring the
    // parent's own value must not echo it back as an edit.
    const { strategy, bidAmount } = this.view().value;
    this.form.setValue({ strategy, bidAmount }, { emitEvent: false });
  }

  private initAmountDescribedBy(): Signal<string> {
    return computed(() => {
      const ids = this.ids();
      const describedBy = [ids.currency, ids.limit];
      if (this.view().error !== null) {
        describedBy.push(ids.error);
      }
      return describedBy.join(' ');
    });
  }
}
