// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { MyActivityTab, TabOption } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-activity-top-bar',
  imports: [ReactiveFormsModule, SelectButtonComponent],
  templateUrl: './activity-top-bar.component.html',
})
export class ActivityTopBarComponent {
  // === Inputs ===
  public readonly tabForm = input.required<FormGroup>();
  public readonly tabOptions = input.required<TabOption<MyActivityTab>[]>();

  // === Outputs ===
  public readonly tabChange = output<MyActivityTab>();

  // === Protected Methods ===
  protected onTabChange(event: { value: MyActivityTab }): void {
    this.tabChange.emit(event.value);
  }
}
