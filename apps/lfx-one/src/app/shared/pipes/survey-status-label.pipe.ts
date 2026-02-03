// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { Survey, SURVEY_STATUS_LABELS } from '@lfx-one/shared';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';

@Pipe({
  name: 'surveyStatusLabel',
})
export class SurveyStatusLabelPipe implements PipeTransform {
  public transform(survey: Pick<Survey, 'survey_status' | 'survey_cutoff_date'>): string {
    const displayStatus = getSurveyDisplayStatus(survey);
    return SURVEY_STATUS_LABELS[displayStatus] ?? displayStatus;
  }
}
