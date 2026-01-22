// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, input, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { CommitteeSelectorComponent } from '@components/committee-selector/committee-selector.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COMMITTEE_LABEL, VOTE_ELIGIBLE_PARTICIPANTS, VOTE_LABEL } from '@lfx-one/shared/constants';

@Component({
  selector: 'lfx-vote-basics',
  imports: [ReactiveFormsModule, InputTextComponent, TextareaComponent, SelectComponent, CalendarComponent, CommitteeSelectorComponent, LowerCasePipe],
  templateUrl: './vote-basics.component.html',
})
export class VoteBasicsComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);

  // Constants
  public readonly committeeLabel = COMMITTEE_LABEL;
  public readonly voteLabel = VOTE_LABEL;
  public readonly eligibleParticipantsOptions = [...VOTE_ELIGIBLE_PARTICIPANTS];
  public readonly minDate = new Date();
}
