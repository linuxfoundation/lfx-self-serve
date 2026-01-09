// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SurveyResponseStatus, SurveyStatus } from '@lfx-one/shared';
import { UserSurvey } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'surveyActionText',
})
export class SurveyActionTextPipe implements PipeTransform {
  public transform(survey: UserSurvey): string {
    const canTakeSurvey = survey.survey_status === SurveyStatus.OPEN && survey.response_status === SurveyResponseStatus.NOT_RESPONDED;
    return canTakeSurvey ? 'Take Survey' : 'View Survey';
  }
}
