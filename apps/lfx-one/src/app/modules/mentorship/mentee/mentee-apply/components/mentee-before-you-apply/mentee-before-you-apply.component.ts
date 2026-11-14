// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ComplianceConfirmationComponent } from '@app/modules/mentorship/components/compliance-confirmation/compliance-confirmation.component';
import { TermsAcknowledgementComponent } from '@app/modules/mentorship/components/terms-acknowledgement/terms-acknowledgement.component';
import { MenteeEligibilityChecksComponent } from '@app/modules/mentorship/mentee/mentee-eligibility-checks/mentee-eligibility-checks.component';
import { MENTORSHIP_MENTEE_APPLY_BEFORE_INTRO, MENTORSHIP_MENTEE_APPLY_BEFORE_TITLE, MENTORSHIP_MENTEE_APPLY_PUBLICITY_NOTE } from '@lfx-one/shared/constants';
import { startWith } from 'rxjs';

/**
 * The five confirmations required before a mentee can submit an application.
 * The apply page owns Cancel and Submit and reads `remaining` to enable them.
 */
@Component({
  selector: 'lfx-mentorship-mentee-before-you-apply',
  imports: [ComplianceConfirmationComponent, MenteeEligibilityChecksComponent, TermsAcknowledgementComponent],
  templateUrl: './mentee-before-you-apply.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeBeforeYouApplyComponent {
  protected readonly title = MENTORSHIP_MENTEE_APPLY_BEFORE_TITLE;
  protected readonly intro = MENTORSHIP_MENTEE_APPLY_BEFORE_INTRO;
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
    const checks = Object.values(this.formSnapshot());
    return checks.length - checks.filter(Boolean).length;
  });
}
