// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import {
  MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL,
  MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL,
  MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeRegisterFieldErrors } from '@lfx-one/shared/interfaces';

/**
 * The three mentee eligibility checkboxes — age, work authorization, and no duplicate profile —
 * shared by the Become a Mentee form's Eligibility Requirements card and the Before You Apply card.
 *
 * Owns no state: each checkbox writes to the caller's form under its fixed control name.
 */
@Component({
  selector: 'lfx-mentorship-mentee-eligibility-checks',
  imports: [CheckboxComponent],
  templateUrl: './mentee-eligibility-checks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
})
export class MenteeEligibilityChecksComponent {
  public readonly form = input.required<FormGroup>();
  /** Prefixes each checkbox id, the text id it points at, and the test ids. */
  public readonly idPrefix = input.required<string>();
  public readonly errors = input<MentorshipMenteeRegisterFieldErrors>({});

  protected readonly ageLabel = MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL;
  protected readonly workAuthorizedLabel = MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL;
  protected readonly noDuplicateProfileLabel = MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL;
}
