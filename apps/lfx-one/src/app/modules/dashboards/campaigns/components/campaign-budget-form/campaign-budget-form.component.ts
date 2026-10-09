// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, OnInit, output, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED, CAMPAIGN_BUDGET_TYPE_OPTIONS } from '@lfx-one/shared/constants';
import type { CampaignBudgetChange, CampaignBudgetOutcome, CampaignBudgetType } from '@lfx-one/shared/interfaces';
import { campaignBudgetAmountValidator } from '@lfx-one/shared/validators';
import { touchedAnyErrorSignal, touchedErrorSignal, touchedInvalidSignal } from '@shared/utils/form-control-signals.util';

/**
 * The inline budget editor for one campaign row on the Optimize tab.
 *
 * Owns the form only. The parent owns the request, the row's ETag and every outcome, exactly as
 * it does for the pause/resume toggle, so the two writes on one row share one validator and one
 * conflict state. This component validates, emits the change, and renders whatever outcome the
 * parent hands back.
 *
 * The amount is in the AD ACCOUNT's own currency and is emitted exactly as typed: no conversion,
 * no rounding. The platforms' own minimums are not checked here; campaign-service names them in a
 * 400 the parent shows verbatim.
 */
@Component({
  selector: 'lfx-campaign-budget-form',
  imports: [ReactiveFormsModule, ButtonComponent, InputNumberComponent, RadioButtonComponent],
  templateUrl: './campaign-budget-form.component.html',
  styleUrl: './campaign-budget-form.component.scss',
})
export class CampaignBudgetFormComponent implements OnInit {
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();
  /**
   * The pacing the campaign is known to use, or `null` when this view does not know it.
   *
   * Pre-selects the pacing radio. Left unselected when unknown rather than defaulted to `daily`:
   * upstream refuses a pacing that differs from the campaign's own with 409, so a guessed default
   * would turn an omission into a refusal about a pacing the operator never chose.
   */
  public readonly knownBudgetType = input<CampaignBudgetType | null>(null);
  /**
   * The amount to prefill, or `null` to leave the field empty.
   *
   * Only ever a budget this session CONFIRMED: the campaign index carries no budget, so an empty
   * field is the honest default rather than a guessed figure. Prefilled, never submitted — the
   * operator still has to press Save.
   */
  public readonly initialBudget = input<number | null>(null);
  /** A budget change for this row is in flight. */
  public readonly pending = input(false);
  /** Why submitting is not possible right now, or `''` — see `CampaignRow.budgetBlockedReason`. */
  public readonly blockedReason = input('');
  /** The last failed outcome for this row, as the parent classified it. */
  public readonly outcome = input<CampaignBudgetOutcome | null>(null);

  public readonly submitBudget = output<CampaignBudgetChange>();
  public readonly cancelEdit = output<void>();

  public readonly form = new FormGroup({
    budget: new FormControl<number | null>(null, [campaignBudgetAmountValidator()]),
    budgetType: new FormControl<CampaignBudgetType | null>(null, [Validators.required]),
  });

  protected readonly budgetTypeOptions = CAMPAIGN_BUDGET_TYPE_OPTIONS;
  /** The BFF's own unconfirmed sentence already says what to do, so it is not repeated beneath itself. */
  protected readonly unconfirmedFallback = CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED;

  protected readonly ids = computed(() => {
    const id = this.campaignId();
    return {
      amount: `campaign-budget-amount-${id}`,
      amountHint: `campaign-budget-amount-hint-${id}`,
      amountError: `campaign-budget-amount-error-${id}`,
      typeLegend: `campaign-budget-type-legend-${id}`,
      typeHint: `campaign-budget-type-hint-${id}`,
      typeError: `campaign-budget-type-error-${id}`,
      typeName: `campaign-budget-type-${id}`,
      outcome: `campaign-budget-outcome-${id}`,
    };
  });

  protected readonly amountNotPositive: Signal<boolean> = touchedErrorSignal(
    computed(() => this.form),
    'budget',
    'budgetNotPositive'
  );
  protected readonly amountMissing: Signal<boolean> = touchedAnyErrorSignal(
    computed(() => this.form),
    'budget',
    ['budgetRequired', 'budgetNotNumber']
  );
  protected readonly amountInvalid: Signal<boolean> = touchedInvalidSignal(
    computed(() => this.form),
    'budget'
  );
  protected readonly budgetTypeMissing: Signal<boolean> = touchedErrorSignal(
    computed(() => this.form),
    'budgetType',
    'required'
  );

  /** The amount field's validation message, or `''` when it has none to show. */
  protected readonly amountError: Signal<string> = this.initAmountError();
  /** `aria-describedby` for the amount: its hint, its error when shown, and the row's outcome. */
  protected readonly amountDescribedBy: Signal<string> = this.initAmountDescribedBy();
  /** `aria-describedby` for the pacing group: its hint, plus its error once one is shown. */
  protected readonly typeDescribedBy: Signal<string> = this.initTypeDescribedBy();
  /**
   * The blocked reason, unless the outcome already says the same thing. A 412 on this form both
   * sets a `conflict` outcome and blocks the row, and stating the stale validator twice adds
   * nothing.
   */
  protected readonly visibleBlockedReason = computed(() => (this.outcome()?.state === 'conflict' ? '' : this.blockedReason()));
  protected readonly submitLabel = computed(() => `Save budget for ${this.campaignName()}`);

  public ngOnInit(): void {
    // Inputs are not readable in a field initializer, so the known pacing and amount are applied
    // here. The editor is created fresh each time it opens, so this runs once per opening.
    const known = this.knownBudgetType();
    if (known !== null) {
      this.form.controls.budgetType.setValue(known);
    }
    const initial = this.initialBudget();
    if (initial !== null) {
      this.form.controls.budget.setValue(initial);
    }
  }

  protected submit(): void {
    if (this.pending() || this.blockedReason() !== '') {
      return;
    }
    this.form.markAllAsTouched();
    const { budget, budgetType } = this.form.getRawValue();
    // Re-checked as types rather than trusting `form.valid` alone, so the emitted value is the
    // number as typed and a pacing that is actually one of the two the endpoint accepts.
    if (this.form.invalid || typeof budget !== 'number' || budgetType === null) {
      return;
    }
    this.submitBudget.emit({ budget, budgetType });
  }

  private initAmountError(): Signal<string> {
    return computed(() => {
      if (this.amountNotPositive()) {
        return 'Enter an amount greater than zero.';
      }
      if (this.amountMissing()) {
        return 'Enter the new budget as a number.';
      }
      return '';
    });
  }

  private initTypeDescribedBy(): Signal<string> {
    return computed(() => {
      const ids = this.ids();
      return this.budgetTypeMissing() ? `${ids.typeHint} ${ids.typeError}` : ids.typeHint;
    });
  }

  private initAmountDescribedBy(): Signal<string> {
    return computed(() => {
      const ids = this.ids();
      const describedBy = [ids.amountHint];
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
