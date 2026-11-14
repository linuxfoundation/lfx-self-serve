// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommitteeCheckboxListComponent } from '@components/committee-checkbox-list/committee-checkbox-list.component';
import { SelectComponent } from '@components/select/select.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee, SurveyTemplatesState } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-survey-audience-type',
  imports: [ReactiveFormsModule, CommitteeCheckboxListComponent, SelectComponent, OpenIntercomDirective],
  templateUrl: './survey-audience-type.component.html',
})
export class SurveyAudienceTypeComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);
  public readonly committeeContext = input<Committee | null>(null);
  public readonly templatesState = input.required<SurveyTemplatesState>();

  // Outputs
  public readonly retryTemplates = output<void>();

  // Constants
  public readonly committeeLabel = COMMITTEE_LABEL;
}
