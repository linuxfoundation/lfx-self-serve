// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMBINED_SURVEY_STATUS_SEVERITY } from '@lfx-one/shared';
import { TagSeverity, UserSurvey } from '@lfx-one/shared/interfaces';
import { getCombinedSurveyStatus } from '@lfx-one/shared/utils';

@Pipe({
  name: 'combinedSurveyStatusSeverity',
})
export class CombinedSurveyStatusSeverityPipe implements PipeTransform {
  public transform(survey: UserSurvey): TagSeverity {
    const status = getCombinedSurveyStatus(survey);
    return COMBINED_SURVEY_STATUS_SEVERITY[status];
  }
}
