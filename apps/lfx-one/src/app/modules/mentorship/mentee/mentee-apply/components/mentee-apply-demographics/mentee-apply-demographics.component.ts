// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL,
  MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EMPTY,
  MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_INTRO,
  MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_OPTIONAL,
  MENTORSHIP_MENTEE_APPLY_DEMOGRAPHIC_FIELDS,
  MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE,
  MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeDemographics } from '@lfx-one/shared/interfaces';

/**
 * Read-only demographics summary on the mentee apply page. Answers stay off the
 * mentor-facing profile card: this block is the only place they are shown, and
 * only to the mentee reviewing their own application.
 */
@Component({
  selector: 'lfx-mentorship-mentee-apply-demographics',
  imports: [ButtonComponent],
  templateUrl: './mentee-apply-demographics.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeApplyDemographicsComponent {
  public readonly demographics = input<MentorshipMenteeDemographics | undefined>(undefined);
  public readonly editClick = output<void>();

  protected readonly title = MENTORSHIP_MENTEE_DEMOGRAPHICS_TITLE;
  protected readonly optionalLabel = MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_OPTIONAL;
  protected readonly intro = MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_INTRO;
  protected readonly editLabel = MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EDIT_LABEL;
  protected readonly emptyLabel = MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EMPTY;

  protected readonly fields = computed(() => {
    const answers = this.demographics() ?? {};
    return MENTORSHIP_MENTEE_APPLY_DEMOGRAPHIC_FIELDS.map((field) => {
      const value = demographicAnswerLabel(field.answerControl, answers[field.answerControl]);
      return { answerControl: field.answerControl, label: field.label, value, provided: value !== this.emptyLabel };
    });
  });

  protected onEdit(): void {
    this.editClick.emit();
  }
}

/** Option text from the register-form catalog. Missing, blank, opted-out, and unknown tokens all read as not provided. */
function demographicAnswerLabel(
  answerControl: (typeof MENTORSHIP_MENTEE_APPLY_DEMOGRAPHIC_FIELDS)[number]['answerControl'],
  value: string | undefined
): string {
  const token = value?.trim() ?? '';
  if (!token || token === 'preferNotToSay') return MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EMPTY;
  const row = MENTORSHIP_MENTEE_DEMOGRAPHIC_ROWS.find((item) => item.answerControl === answerControl);
  return row?.options.find((option) => option.value === token)?.text ?? MENTORSHIP_MENTEE_APPLY_DEMOGRAPHICS_EMPTY;
}
