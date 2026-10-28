// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RadioButtonModule } from 'primeng/radiobutton';

@Component({
  selector: 'lfx-radio-button',
  imports: [RadioButtonModule, ReactiveFormsModule],
  templateUrl: './radio-button.component.html',
})
export class RadioButtonComponent {
  public readonly form = input<FormGroup>();
  public readonly control = input<string>();
  public readonly name = input.required<string>();
  public readonly value = input.required<any>();
  public readonly label = input<string>('');
  public readonly inputId = input<string>();
  // Grows the row to a 44px tap target and makes the whole label area selectable (touch surfaces).
  public readonly touchTarget = input<boolean>(false);

  // Events
  public readonly onChange = output<any>();

  // Event handlers
  public onRadioChange(event: any): void {
    this.onChange.emit(event);
  }
}
