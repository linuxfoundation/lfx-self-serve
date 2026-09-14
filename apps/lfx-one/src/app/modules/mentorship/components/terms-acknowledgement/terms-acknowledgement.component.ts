// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { mentorshipPolicyHref } from '@lfx-one/shared/constants';

/**
 * The Terms and Conditions section shared by the mentorship forms — the enroll wizard and
 * the Become a Mentor form both close with it. The four policy links are legal copy, so
 * they live in one place rather than being retyped per form; only the lead-in paragraph
 * and the id prefix differ between callers.
 *
 * Owns no state: the checkbox writes to the caller's form under `control`.
 */
@Component({
  selector: 'lfx-mentorship-terms-acknowledgement',
  imports: [CheckboxComponent],
  templateUrl: './terms-acknowledgement.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsAcknowledgementComponent {
  public readonly form = input.required<FormGroup>();
  public readonly intro = input.required<string>();
  /** Prefixes the checkbox id, the label id it points at, and the test id. */
  public readonly idPrefix = input.required<string>();
  public readonly control = input('termsAccepted');
  public readonly error = input<string | undefined>(undefined);

  protected readonly platformUseHref = mentorshipPolicyHref('LFX Platform Use Agreement');
  protected readonly serviceTermsHref = mentorshipPolicyHref('Service-Specific Use Terms');
  protected readonly acceptableUseHref = mentorshipPolicyHref('Acceptable Use Policy');
  protected readonly privacyHref = mentorshipPolicyHref('Privacy Policy');
}
