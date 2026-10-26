// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { MENTORSHIP_MENTOR_COMPLIANCE_ITEMS, MENTORSHIP_MENTOR_COMPLIANCE_LEAD } from '@lfx-one/shared/constants';

/**
 * The compliance (OFAC/sanctions) checkbox shared by the Become a Mentor form, the Become a Mentee
 * form and the mentee's Before You Apply card. The certification is legal copy, so it lives in one
 * place; callers supply the surrounding card and heading.
 *
 * Owns no state: the checkbox writes to the caller's form under `control`.
 */
@Component({
  selector: 'lfx-mentorship-compliance-confirmation',
  imports: [CheckboxComponent],
  templateUrl: './compliance-confirmation.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
})
export class ComplianceConfirmationComponent {
  public readonly form = input.required<FormGroup>();
  /** Prefixes the checkbox id, the text id it points at, and the test ids. */
  public readonly idPrefix = input.required<string>();
  public readonly control = input('complianceAccepted');
  public readonly error = input<string | undefined>(undefined);

  protected readonly lead = MENTORSHIP_MENTOR_COMPLIANCE_LEAD;
  protected readonly items = MENTORSHIP_MENTOR_COMPLIANCE_ITEMS;
}
