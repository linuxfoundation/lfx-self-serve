// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';

@Component({
  selector: 'lfx-calendar',
  standalone: true,
  imports: [DatePickerModule, ReactiveFormsModule],
  templateUrl: './calendar.component.html',
})
export class CalendarComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();

  // Essential properties for our use case
  public readonly label = input<string>('');
  public readonly placeholder = input<string>('');
  public readonly disabled = input<boolean>(false);
  public readonly required = input<boolean>(false);
  public readonly showIcon = input<boolean>(false);
  public readonly showButtonBar = input<boolean>(false);
  public readonly dateFormat = input<string>('mm/dd/yy');
  public readonly size = input<'small' | 'large'>('small');

  // Events
  public readonly onSelect = output<any>();

  protected handleSelect(event: any): void {
    this.onSelect.emit(event);
  }
}
