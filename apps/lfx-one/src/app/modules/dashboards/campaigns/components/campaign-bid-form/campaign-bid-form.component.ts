// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, OnInit, output, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { CAMPAIGN_BID_OUTCOME_UNCONFIRMED, CAMPAIGN_BID_STRATEGY_NOTE } from '@lfx-one/shared/constants';
import type { CampaignBidChange, CampaignBidOutcome } from '@lfx-one/shared/interfaces';
import { campaignBidAmountValidator } from '@lfx-one/shared/validators';
import { touchedAnyErrorSignal, touchedErrorSignal, touchedInvalidSignal } from '@shared/utils/form-control-signals.util';

/**
 * The inline manual max CPC bid editor for one campaign row on the Optimize tab.
 *
 * The budget editor's sibling, split the same way: this component owns the form only, and the
 * parent owns the request, the row's ETag (shared with the toggle and the budget editor) and every
 * outcome.
 *
 * The bid is in the AD ACCOUNT's own currency and is emitted exactly as typed: no conversion, no
 * rounding, no currency symbol. Whether the campaign's bid strategy takes a manual bid is known only
 * upstream, so the editor says up front which campaigns it applies to, and renders upstream's 409
 * verbatim when the strategy refuses it.
 */
@Component({
  selector: 'lfx-campaign-bid-form',
  imports: [ReactiveFormsModule, ButtonComponent, InputNumberComponent],
  templateUrl: './campaign-bid-form.component.html',
  styleUrl: './campaign-bid-form.component.scss',
})
export class CampaignBidFormComponent implements OnInit {
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();
  /** A bid this session CONFIRMED, to prefill; `null` leaves the field empty (the index carries no bid). */
  public readonly initialBid = input<number | null>(null);
  /** A bid change for this row is in flight. */
  public readonly pending = input(false);
  /** Why submitting is not possible right now, or `''` — see `CampaignRow.bidBlockedReason`. */
  public readonly blockedReason = input('');
  /** The last failed outcome for this row, as the parent classified it. */
  public readonly outcome = input<CampaignBidOutcome | null>(null);

  public readonly submitBid = output<CampaignBidChange>();
  public readonly cancelEdit = output<void>();

  public readonly form = new FormGroup({
    bid: new FormControl<number | null>(null, [campaignBidAmountValidator()]),
  });

  protected readonly strategyNote = CAMPAIGN_BID_STRATEGY_NOTE;
  /** The BFF's own unconfirmed sentence already says what to do, so it is not repeated beneath itself. */
  protected readonly unconfirmedFallback = CAMPAIGN_BID_OUTCOME_UNCONFIRMED;

  protected readonly ids = computed(() => {
    const id = this.campaignId();
    return {
      amount: `campaign-bid-amount-${id}`,
      amountHint: `campaign-bid-amount-hint-${id}`,
      strategy: `campaign-bid-strategy-${id}`,
      amountError: `campaign-bid-amount-error-${id}`,
      outcome: `campaign-bid-outcome-${id}`,
    };
  });

  protected readonly bidNotPositive: Signal<boolean> = touchedErrorSignal(
    computed(() => this.form),
    'bid',
    'bidNotPositive'
  );
  protected readonly bidMissing: Signal<boolean> = touchedAnyErrorSignal(
    computed(() => this.form),
    'bid',
    ['bidRequired', 'bidNotNumber']
  );
  protected readonly bidInvalid: Signal<boolean> = touchedInvalidSignal(
    computed(() => this.form),
    'bid'
  );

  /** The bid field's validation message, or `''` when it has none to show. */
  protected readonly amountError: Signal<string> = this.initAmountError();
  /** `aria-describedby` for the bid: its hint, the strategy note, its error when shown, and the outcome. */
  protected readonly amountDescribedBy: Signal<string> = this.initAmountDescribedBy();
  /** The blocked reason, unless a `conflict` outcome already says the same thing. */
  protected readonly visibleBlockedReason = computed(() => (this.outcome()?.state === 'conflict' ? '' : this.blockedReason()));
  protected readonly submitLabel = computed(() => `Save bid for ${this.campaignName()}`);

  public ngOnInit(): void {
    // Inputs are not readable in a field initializer; the editor is created fresh on each opening.
    const initial = this.initialBid();
    if (initial !== null) {
      this.form.controls.bid.setValue(initial);
    }
  }

  protected submit(): void {
    if (this.pending() || this.blockedReason() !== '') {
      return;
    }
    this.form.markAllAsTouched();
    const { bid } = this.form.getRawValue();
    if (this.form.invalid || typeof bid !== 'number') {
      return;
    }
    this.submitBid.emit({ bid });
  }

  private initAmountError(): Signal<string> {
    return computed(() => {
      if (this.bidNotPositive()) {
        return 'Enter a bid greater than zero.';
      }
      if (this.bidMissing()) {
        return 'Enter the new bid as a number.';
      }
      return '';
    });
  }

  private initAmountDescribedBy(): Signal<string> {
    return computed(() => {
      const ids = this.ids();
      const describedBy = [ids.amountHint, ids.strategy];
      if (this.amountError() !== '') {
        describedBy.push(ids.amountError);
      }
      if (this.outcome() !== null) {
        describedBy.push(ids.outcome);
      }
      return describedBy.join(' ');
    });
  }
}
