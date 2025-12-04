// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardSelectorOption } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-card-selector',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './card-selector.component.html',
})
export class CardSelectorComponent<T = string> {
  // Inputs
  public readonly options = input.required<CardSelectorOption<T>[]>();
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly label = input<string>('');
  public readonly required = input<boolean>(false);
  public readonly errorMessage = input<string>('Selection is required');
  public readonly testIdPrefix = input<string>('card-selector');
  public readonly gridColumns = input<number>(1);

  // Output
  public readonly selectionChange = output<T>();

  // Handle selection
  public onSelect(value: T): void {
    this.form().get(this.control())?.setValue(value);
    this.form().get(this.control())?.markAsTouched();
    this.selectionChange.emit(value);
  }
}
