// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMBINED_SURVEY_STATUS } from '@lfx-one/shared/constants';
import { UserSurvey } from '@lfx-one/shared/interfaces';
import { getCombinedSurveyStatus } from '@lfx-one/shared/utils';

@Pipe({
  name: 'surveyActionText',
})
export class SurveyActionTextPipe implements PipeTransform {
  public transform(survey: UserSurvey): string {
    return getCombinedSurveyStatus(survey) === COMBINED_SURVEY_STATUS.OPEN ? 'Take Survey' : 'View Survey';
  }
}
