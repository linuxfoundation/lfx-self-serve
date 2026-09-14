// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MENTORSHIP_ENROLL_STEP_LABELS, MENTORSHIP_ENROLL_STEPS_ORDER } from '@lfx-one/shared/constants';
import { MentorshipEnrollStep } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mentorship-enroll-stepper',
  templateUrl: './enroll-stepper.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollStepperComponent {
  public readonly current = input.required<MentorshipEnrollStep>();

  protected readonly steps = MENTORSHIP_ENROLL_STEPS_ORDER;
  protected readonly labels = MENTORSHIP_ENROLL_STEP_LABELS;

  protected isComplete(step: MentorshipEnrollStep): boolean {
    return this.steps.indexOf(step) < this.steps.indexOf(this.current());
  }

  protected isCurrent(step: MentorshipEnrollStep): boolean {
    return step === this.current();
  }
}
