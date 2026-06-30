// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter } from 'rxjs';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { DEFAULT_FUND_DISTRIBUTION } from '@lfx-one/shared/constants';
import { FundDistributionItem, InitiativeDetail } from '@lfx-one/shared/interfaces';

function formatCompactAmount(amount: number): string {
  if (amount === 0) return '$0';
  if (amount >= 1_000_000) {
    const val = amount / 1_000_000;
    return `$${val % 1 === 0 ? val : val.toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    const val = amount / 1_000;
    return `$${val % 1 === 0 ? val : val.toFixed(1)}K`;
  }
  return `$${Math.round(amount)}`;
}

@Component({
  selector: 'lfx-settings-funding-tab',
  imports: [ReactiveFormsModule, FormsModule, InputTextComponent, ToggleSwitchModule],
  templateUrl: './settings-funding-tab.component.html',
})
export class SettingsFundingTabComponent {
  public readonly visible = input.required<boolean>();
  public readonly initiative = input.required<InitiativeDetail>();

  public readonly form: FormGroup = new FormGroup({
    goal: new FormControl<number | null>(null, [Validators.min(0)]),
  });

  public readonly distributionItems = signal<FundDistributionItem[]>(DEFAULT_FUND_DISTRIBUTION.map((i) => ({ ...i })));

  public readonly totalAllocated = computed(() =>
    this.distributionItems()
      .filter((i) => i.enabled)
      .reduce((sum, i) => sum + i.percentage, 0)
  );

  protected readonly hasEnabledCategories = computed(() => this.distributionItems().some((i) => i.enabled));
  protected readonly remaining = computed(() => 100 - this.totalAllocated());

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly distributionAmounts = computed(() => {
    const goalValue = this.formValue().goal as number | null;
    return this.distributionItems().map((item) => {
      const amount = goalValue != null ? (item.percentage / 100) * goalValue : 0;
      return formatCompactAmount(amount);
    });
  });

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => {
        const init = this.initiative();
        this.form.patchValue({
          goal: init.fundingStatus?.goalsTotalCents != null ? init.fundingStatus.goalsTotalCents / 100 : null,
        });
        const goals = init.fundingGoals ?? [];
        const totalCents = init.fundingStatus?.goalsTotalCents ?? 0;
        this.distributionItems.set(
          DEFAULT_FUND_DISTRIBUTION.map((item) => {
            const match = goals.find((g) => g.name === item.label);
            if (match && totalCents > 0) {
              return { ...item, enabled: true, percentage: Math.round((match.goalCents / totalCents) * 100) };
            }
            return { ...item };
          })
        );
      });
  }

  protected toggleCategory(index: number, enabled: boolean): void {
    this.distributionItems.update((items) => items.map((item, i) => (i === index ? { ...item, enabled, percentage: 0 } : item)));
  }

  protected updatePercentage(index: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const pct = parseInt(raw, 10);
    this.distributionItems.update((items) =>
      items.map((item, i) => (i === index ? { ...item, percentage: isNaN(pct) ? 0 : Math.min(Math.max(0, pct), 100) } : item))
    );
  }
}
