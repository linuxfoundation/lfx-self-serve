// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RadioButtonModule } from 'primeng/radiobutton';

@Component({
  selector: 'lfx-radio-button',
  standalone: true,
  imports: [CommonModule, RadioButtonModule, ReactiveFormsModule],
  templateUrl: './radio-button.component.html',
})
export class RadioButtonComponent {
  public readonly form = input<FormGroup>();
  public readonly control = input<string>();
  public readonly name = input.required<string>();
  public readonly value = input.required<any>();
  public readonly label = input<string>('');
  public readonly inputId = input<string>();

  // Events
  public readonly onChange = output<any>();

  // Event handlers
  public onRadioChange(event: any): void {
    this.onChange.emit(event);
  }
}
