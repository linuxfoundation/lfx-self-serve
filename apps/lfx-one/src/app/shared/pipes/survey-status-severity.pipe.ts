// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SurveyStatus, SURVEY_STATUS_SEVERITY, TagSeverity } from '@lfx-one/shared';

/**
 * Transforms survey status to tag severity for consistent styling
 * @description Maps SurveyStatus enum values to appropriate tag colors
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="survey.survey_status | surveyStatusSeverity">{{ survey.survey_status }}</lfx-tag>
 */
@Pipe({
  name: 'surveyStatusSeverity',
})
export class SurveyStatusSeverityPipe implements PipeTransform {
  public transform(status: SurveyStatus): TagSeverity {
    return SURVEY_STATUS_SEVERITY[status] ?? 'secondary';
  }
}
