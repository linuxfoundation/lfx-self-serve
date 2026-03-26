// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, input, InputSignal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { FeatureConfig } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-feature-toggle',
  imports: [ToggleComponent, NgClass],
  templateUrl: './feature-toggle.component.html',
})
export class FeatureToggleComponent {
  public readonly feature: InputSignal<FeatureConfig> = input.required<FeatureConfig>();
  public readonly form: InputSignal<FormGroup> = input.required<FormGroup>();
  public readonly comingSoon = input<boolean>(false);
}
