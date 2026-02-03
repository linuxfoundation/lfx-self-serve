// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { Survey, SURVEY_STATUS_SEVERITY, TagSeverity } from '@lfx-one/shared';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';

/**
 * Transforms survey to tag severity for consistent styling
 * @description Computes display status from survey_status and survey_cutoff_date, then maps to appropriate tag colors
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="survey | surveyStatusSeverity">{{ survey | surveyStatusLabel }}</lfx-tag>
 */
@Pipe({
  name: 'surveyStatusSeverity',
})
export class SurveyStatusSeverityPipe implements PipeTransform {
  public transform(survey: Pick<Survey, 'survey_status' | 'survey_cutoff_date'>): TagSeverity {
    const displayStatus = getSurveyDisplayStatus(survey);
    return SURVEY_STATUS_SEVERITY[displayStatus] ?? 'secondary';
  }
}
