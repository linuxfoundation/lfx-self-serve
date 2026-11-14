// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import {
  COUNTRIES,
  MENTORSHIP_MENTEE_COUNTRY_INTRO,
  MENTORSHIP_MENTEE_COUNTRY_LABEL,
  MENTORSHIP_MENTEE_COUNTRY_PLACEHOLDER,
  MENTORSHIP_MENTEE_COUNTRY_TITLE,
} from '@lfx-one/shared/constants';

/**
 * Country card on the Become a Mentee form: one required, filterable dropdown bound to the form's
 * `country` control. The value is the ISO 3166-1 alpha-2 code, stored upstream as `address.country`,
 * which the HR acceptance notice reads for stipend verification. The error comes from the register
 * rules (`getMentorshipMenteeCountryError`) via the parent, so it stays hidden until a submit attempt.
 */
@Component({
  selector: 'lfx-mentorship-mentee-country-section',
  imports: [SelectComponent],
  templateUrl: './mentee-country-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeCountrySectionComponent {
  public readonly form = input.required<FormGroup>();
  public readonly error = input<string | undefined>(undefined);

  protected readonly title = MENTORSHIP_MENTEE_COUNTRY_TITLE;
  protected readonly intro = MENTORSHIP_MENTEE_COUNTRY_INTRO;
  protected readonly label = MENTORSHIP_MENTEE_COUNTRY_LABEL;
  protected readonly placeholder = MENTORSHIP_MENTEE_COUNTRY_PLACEHOLDER;
  protected readonly countryOptions = [...COUNTRIES];
}
