// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { TermsAcknowledgementComponent } from '@app/modules/mentorship/components/terms-acknowledgement/terms-acknowledgement.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import {
  MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL,
  MENTORSHIP_MENTEE_APPLY_BEFORE_INTRO,
  MENTORSHIP_MENTEE_APPLY_BEFORE_TITLE,
  MENTORSHIP_MENTEE_APPLY_PUBLICITY_NOTE,
  MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL,
  MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL,
  MENTORSHIP_MENTOR_COMPLIANCE_ITEMS,
  MENTORSHIP_MENTOR_COMPLIANCE_LEAD,
} from '@lfx-one/shared/constants';
import { startWith } from 'rxjs';

/**
 * The five confirmations required before a mentee can submit an application.
 * The apply page owns Cancel and Submit and reads `remaining` to enable them.
 */
@Component({
  selector: 'lfx-mentorship-mentee-before-you-apply',
  imports: [CheckboxComponent, TermsAcknowledgementComponent],
  templateUrl: './mentee-before-you-apply.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeBeforeYouApplyComponent {
  protected readonly title = MENTORSHIP_MENTEE_APPLY_BEFORE_TITLE;
  protected readonly intro = MENTORSHIP_MENTEE_APPLY_BEFORE_INTRO;
  protected readonly ageLabel = MENTORSHIP_MENTEE_AGE_ELIGIBLE_LABEL;
  protected readonly workAuthorizedLabel = MENTORSHIP_MENTEE_WORK_AUTHORIZED_LABEL;
  protected readonly noDuplicateProfileLabel = MENTORSHIP_MENTEE_NO_DUPLICATE_PROFILE_LABEL;
  protected readonly complianceLead = MENTORSHIP_MENTOR_COMPLIANCE_LEAD;
  protected readonly complianceItems = MENTORSHIP_MENTOR_COMPLIANCE_ITEMS;
  protected readonly publicityNote = MENTORSHIP_MENTEE_APPLY_PUBLICITY_NOTE;

  protected readonly form = new FormGroup({
    ageEligible: new FormControl(false, { nonNullable: true }),
    workAuthorized: new FormControl(false, { nonNullable: true }),
    noDuplicateProfile: new FormControl(false, { nonNullable: true }),
    complianceAccepted: new FormControl(false, { nonNullable: true }),
    termsAccepted: new FormControl(false, { nonNullable: true }),
  });

  private readonly formSnapshot = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /** Unchecked confirmations. The apply page uses this to enable Submit. */
  readonly remaining = computed(() => {
    const value = this.formSnapshot();
    const checks = [value.ageEligible, value.workAuthorized, value.noDuplicateProfile, value.complianceAccepted, value.termsAccepted];
    return checks.length - checks.filter(Boolean).length;
  });
}
