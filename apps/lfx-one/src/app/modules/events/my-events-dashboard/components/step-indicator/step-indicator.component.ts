// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DialogStepState } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-step-indicator',
  templateUrl: './step-indicator.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepIndicatorComponent {
  public stepStates = input.required<DialogStepState[]>();
  public testIdPrefix = input.required<string>();
}
