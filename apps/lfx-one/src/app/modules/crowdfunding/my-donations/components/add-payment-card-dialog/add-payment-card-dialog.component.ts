// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextModule } from 'primeng/inputtext';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

// Raw <input> elements are intentional here: the masking logic (onCardNumberInput/onExpiryInput)
// requires (input) event binding and inputmode/maxlength attributes that lfx-input-text does not
// expose. These will be replaced by Stripe Elements once the payment API integration lands.

@Component({
  selector: 'lfx-add-payment-card-dialog',
  imports: [ReactiveFormsModule, InputTextModule, ButtonComponent],
  templateUrl: './add-payment-card-dialog.component.html',
  styleUrl: './add-payment-card-dialog.component.scss',
})
export class AddPaymentCardDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly form = new FormGroup({
    cardNumber: new FormControl('', [Validators.required, Validators.pattern(/^(\d{4} ){3}\d{4}$/)]),
    expiry: new FormControl('', [Validators.required, Validators.pattern(/^(0[1-9]|1[0-2])\/\d{2}$/)]),
    cvc: new FormControl('', [Validators.required, Validators.pattern(/^\d{3,4}$/)]),
  });

  protected onCardNumberInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 16);
    const formatted = digits.match(/.{1,4}/g)?.join(' ') ?? '';
    this.form.controls.cardNumber.setValue(formatted, { emitEvent: false });
    input.value = formatted;
  }

  protected onExpiryInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    const formatted = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    this.form.controls.expiry.setValue(formatted, { emitEvent: false });
    input.value = formatted;
  }

  protected onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close({ added: true });
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
