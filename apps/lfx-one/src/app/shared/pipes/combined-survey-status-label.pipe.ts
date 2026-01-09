// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMBINED_SURVEY_STATUS_LABELS } from '@lfx-one/shared';
import { UserSurvey } from '@lfx-one/shared/interfaces';
import { getCombinedSurveyStatus } from '@lfx-one/shared/utils';

@Pipe({
  name: 'combinedSurveyStatusLabel',
})
export class CombinedSurveyStatusLabelPipe implements PipeTransform {
  public transform(survey: UserSurvey): string {
    const status = getCombinedSurveyStatus(survey);
    return COMBINED_SURVEY_STATUS_LABELS[status];
  }
}
