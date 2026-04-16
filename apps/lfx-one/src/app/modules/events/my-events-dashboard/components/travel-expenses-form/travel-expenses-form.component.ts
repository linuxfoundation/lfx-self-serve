// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { TravelFundExpenses } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-travel-expenses-form',
  imports: [ReactiveFormsModule, InputTextComponent, MessageComponent, CurrencyPipe],
  templateUrl: './travel-expenses-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TravelExpensesFormComponent {
  private readonly fb = inject(NonNullableFormBuilder);

  public readonly formValidityChange = output<boolean>();
  public readonly formChange = output<TravelFundExpenses>();

  public readonly form = this.fb.group({
    airfareCost: ['0'],
    airfareNotes: [''],
    hotelCost: ['0'],
    hotelNotes: [''],
    groundTransportCost: ['0'],
    groundTransportNotes: [''],
  });

  private readonly formValues = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  public readonly estimatedTotal = computed(() => {
    const v = this.formValues();
    return (parseFloat(v.airfareCost ?? '0') || 0) + (parseFloat(v.hotelCost ?? '0') || 0) + (parseFloat(v.groundTransportCost ?? '0') || 0);
  });

  public constructor() {
    // No required fields — form is always valid
    this.formValidityChange.emit(true);

    this.form.statusChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formValidityChange.emit(this.form.valid);
    });

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formChange.emit(this.buildExpensesValue());
    });
  }

  private buildExpensesValue(): TravelFundExpenses {
    const raw = this.form.getRawValue();
    const airfareCost = parseFloat(raw.airfareCost) || 0;
    const hotelCost = parseFloat(raw.hotelCost) || 0;
    const groundTransportCost = parseFloat(raw.groundTransportCost) || 0;
    return {
      airfareCost,
      airfareNotes: raw.airfareNotes,
      hotelCost,
      hotelNotes: raw.hotelNotes,
      groundTransportCost,
      groundTransportNotes: raw.groundTransportNotes,
      estimatedTotal: airfareCost + hotelCost + groundTransportCost,
    };
  }
}
