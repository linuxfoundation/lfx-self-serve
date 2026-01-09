// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';

@Component({
  selector: 'lfx-select-button',
  imports: [SelectButtonModule, ReactiveFormsModule],
  templateUrl: './select-button.component.html',
})
export class SelectButtonComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();

  // Core properties
  public readonly options = input<any[]>([]);
  public readonly optionLabel = input<string>('label');
  public readonly optionValue = input<string>('value');

  public readonly size = input<'small' | 'large'>('small');
  public readonly unselectable = input<boolean>(false);
  public readonly required = input<boolean>(false);
  public readonly class = input<string>('');
  public readonly styleClass = input<string>('');

  // Events
  public readonly onChange = output<any>();

  // Event handlers
  protected handleChange(event: any): void {
    this.onChange.emit(event);
  }
}
