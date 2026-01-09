// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { MyActivityTab } from '@lfx-one/shared/interfaces';

interface TabOption {
  label: string;
  value: MyActivityTab;
}

@Component({
  selector: 'lfx-activity-top-bar',
  imports: [ReactiveFormsModule, SelectButtonComponent],
  templateUrl: './activity-top-bar.component.html',
})
export class ActivityTopBarComponent {
  public tabForm = input.required<FormGroup>();
  public tabOptions = input.required<TabOption[]>();

  public readonly tabChange = output<MyActivityTab>();

  protected onTabChange(event: { value: MyActivityTab }): void {
    this.tabChange.emit(event.value);
  }
}
