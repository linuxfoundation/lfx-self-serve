// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { PaymentMethod } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-payment-method-card',
  imports: [],
  templateUrl: './payment-method-card.component.html',
  styleUrl: './payment-method-card.component.scss',
})
export class PaymentMethodCardComponent {
  public readonly method = input.required<PaymentMethod>();
  public readonly remove = output<void>();

  protected readonly formattedExpiry: Signal<string> = this.initFormattedExpiry();

  private initFormattedExpiry(): Signal<string> {
    return computed(() => {
      const { expiryMonth, expiryYear } = this.method();
      const month = String(expiryMonth).padStart(2, '0');
      const year = String(expiryYear).slice(-2);
      return `${month}/${year}`;
    });
  }
}
