// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { startWith } from 'rxjs';
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

  private readonly formValues = this.initFormValues();
  public readonly estimatedTotal = this.initEstimatedTotal();

  public constructor() {
    this.form.valueChanges.pipe(startWith(null), takeUntilDestroyed()).subscribe(() => {
      this.formChange.emit(this.buildExpensesValue());
      this.formValidityChange.emit(this.estimatedTotal() > 0);
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

  private initFormValues() {
    return toSignal(this.form.valueChanges, { initialValue: this.form.value });
  }

  private initEstimatedTotal() {
    return computed(() => {
      const v = this.formValues();
      return (parseFloat(v.airfareCost ?? '0') || 0) + (parseFloat(v.hotelCost ?? '0') || 0) + (parseFloat(v.groundTransportCost ?? '0') || 0);
    });
  }
}
