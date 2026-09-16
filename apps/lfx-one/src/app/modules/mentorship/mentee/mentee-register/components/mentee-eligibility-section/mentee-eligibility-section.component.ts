// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import {
  MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL,
  MENTORSHIP_MENTEE_ELIGIBILITY_INTRO,
  MENTORSHIP_MENTEE_ELIGIBILITY_TITLE,
  MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL,
  MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeRegisterFieldErrors } from '@lfx-one/shared/interfaces';

/**
 * Eligibility Requirements card on the Become a Mentee form: three required checkboxes —
 * age, work authorization, and no duplicate profile. Compliance Confirmation (the OFAC/
 * sanctions certification) and Terms and Conditions are their own top-level cards on the
 * register page, matching the mentor form's layout, rather than nested in here.
 */
@Component({
  selector: 'lfx-mentorship-mentee-eligibility-section',
  imports: [CheckboxComponent],
  templateUrl: './mentee-eligibility-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeEligibilitySectionComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipMenteeRegisterFieldErrors>({});

  protected readonly title = MENTORSHIP_MENTEE_ELIGIBILITY_TITLE;
  protected readonly intro = MENTORSHIP_MENTEE_ELIGIBILITY_INTRO;
  protected readonly ageLabel = MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL;
  protected readonly workAuthorizedLabel = MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL;
  protected readonly noDuplicateProfileLabel = MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL;
}
