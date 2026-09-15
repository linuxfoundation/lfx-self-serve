// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_MENTEE_DEMOGRAPHIC_CONSENT_LABEL,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_EMAIL,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_NOTE_PREFIX,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeDemographicRow } from '@lfx-one/shared/interfaces';

/**
 * Demographic questions on the Become a Mentee form — age, racial/ethnic identity,
 * gender, socioeconomic class, and education level. Every question is optional; the
 * consent checkbox affirms LFX's use of whatever answer is given rather than gating the
 * dropdown, so a mentee can pick an answer and still leave a question unconsented.
 *
 * Renders off `MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS` rather than five hand-written blocks,
 * so a new question is a data change here, not a template change.
 */
@Component({
  selector: 'lfx-mentorship-mentee-demographics-section',
  imports: [CheckboxComponent, SelectComponent],
  templateUrl: './mentee-demographics-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeDemographicsSectionComponent {
  public readonly form = input.required<FormGroup>();

  protected readonly title = MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE;
  protected readonly intro = MENTORSHIP_MENTEE_DEMOGRAPHICS_INTRO;
  protected readonly consentLabel = MENTORSHIP_MENTEE_DEMOGRAPHIC_CONSENT_LABEL;
  protected readonly removalNotePrefix = MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_NOTE_PREFIX;
  protected readonly removalEmail = MENTORSHIP_MENTEE_DEMOGRAPHICS_REMOVAL_EMAIL;
  protected readonly rows = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS;

  protected idFor(row: MentorshipMenteeDemographicRow): string {
    return `mentorship-mentee-demographic-${row.answerControl}`;
  }
}
