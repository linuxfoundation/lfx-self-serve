// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
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
  // Renders the row as a bordered card (tap-target phone layouts); `selected` drives its highlighted state.
  public readonly card = input<boolean>(false);
  public readonly selected = input<boolean>(false);

  protected readonly rowClass: Signal<string> = computed(() => {
    const classes: string[] = [];
    if (this.touchTarget()) classes.push('relative min-h-[44px]');
    if (this.card()) classes.push('rounded-lg border px-3 py-1', this.selected() ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white');
    return classes.join(' ');
  });

  // Events
  public readonly onChange = output<any>();

  // Event handlers
  public onRadioChange(event: any): void {
    this.onChange.emit(event);
  }
}
