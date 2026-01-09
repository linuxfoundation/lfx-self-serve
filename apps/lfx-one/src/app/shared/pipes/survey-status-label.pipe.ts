// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SURVEY_STATUS_LABELS, SurveyStatus } from '@lfx-one/shared';

@Pipe({
  name: 'surveyStatusLabel',
})
export class SurveyStatusLabelPipe implements PipeTransform {
  public transform(status: SurveyStatus): string {
    return SURVEY_STATUS_LABELS[status] ?? status;
  }
}
