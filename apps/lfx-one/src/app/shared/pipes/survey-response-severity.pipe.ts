// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SurveyResponseStatus, SURVEY_RESPONSE_STATUS_SEVERITY, TagSeverity } from '@lfx-one/shared';

/**
 * Transforms survey response status to tag severity for consistent styling
 * @description Maps SurveyResponseStatus enum values to appropriate tag colors
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="survey.response_status | surveyResponseSeverity">{{ survey.response_status }}</lfx-tag>
 */
@Pipe({
  name: 'surveyResponseSeverity',
})
export class SurveyResponseSeverityPipe implements PipeTransform {
  public transform(status: SurveyResponseStatus): TagSeverity {
    return SURVEY_RESPONSE_STATUS_SEVERITY[status] ?? 'secondary';
  }
}
