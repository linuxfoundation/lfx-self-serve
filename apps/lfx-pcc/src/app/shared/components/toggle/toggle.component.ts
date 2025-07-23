// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

@Component({
  selector: 'lfx-toggle',
  standalone: true,
  imports: [ToggleSwitchModule, ReactiveFormsModule],
  templateUrl: './toggle.component.html',
})
export class ToggleComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();
  public label = input<string>();
  public id = input<string>();
  public readonly = input<boolean>(false);
  public styleClass = input<string>();
  public trueValue = input<any>(true);
  public falseValue = input<any>(false);
  public dataTest = input<string>();
}
