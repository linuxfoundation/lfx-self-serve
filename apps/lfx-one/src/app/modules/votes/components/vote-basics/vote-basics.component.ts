// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { Committee } from '@lfx-one/shared/interfaces';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { CommitteeSelectorComponent } from '@components/committee-selector/committee-selector.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COMMITTEE_LABEL, VOTE_ALLOW_ABSTAIN_OPTIONS, VOTE_ELIGIBLE_PARTICIPANTS, VOTE_LABEL } from '@lfx-one/shared/constants';
import { buildTimezoneOptions } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-vote-basics',
  imports: [
    ReactiveFormsModule,
    InputTextComponent,
    TextareaComponent,
    SelectComponent,
    CalendarComponent,
    TimePickerComponent,
    CommitteeSelectorComponent,
    LowerCasePipe,
  ],
  templateUrl: './vote-basics.component.html',
})
export class VoteBasicsComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);
  public readonly committeeContext = input<Committee | null>(null);

  // Constants
  public readonly committeeLabel = COMMITTEE_LABEL;
  public readonly voteLabel = VOTE_LABEL;
  public readonly eligibleParticipantsOptions = [...VOTE_ELIGIBLE_PARTICIPANTS];
  public readonly allowAbstainOptions = [...VOTE_ALLOW_ABSTAIN_OPTIONS];
  // Cosmetic floor only — the group-level voteDeadlineValidator does the real zone-aware future check.
  public readonly minDate = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  })();
  public readonly timezoneOptions: Signal<{ label: string; value: string }[]> = this.initTimezoneOptions();

  // Offset labels must reflect the picked deadline date — static catalog offsets lie across DST boundaries.
  private initTimezoneOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      this.formValue()();
      const closeDate = (this.form().get('close_date')?.value as Date | null) ?? new Date();
      return buildTimezoneOptions(closeDate);
    });
  }
}
