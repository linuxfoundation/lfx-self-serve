// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SurveyResponseStatus, SurveyStatus } from '@lfx-one/shared';
import { UserSurvey } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'canTakeSurvey',
})
export class CanTakeSurveyPipe implements PipeTransform {
  public transform(survey: UserSurvey): boolean {
    return survey.survey_status === SurveyStatus.OPEN && survey.response_status === SurveyResponseStatus.NOT_RESPONDED;
  }
}
