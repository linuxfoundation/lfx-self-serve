// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SURVEY_RESPONSE_STATUS_SEVERITY } from '@lfx-one/shared/constants';
import { SurveyResponseStatus } from '@lfx-one/shared/enums';
import { TagSeverity } from '@lfx-one/shared/interfaces';

/**
 * Transforms survey response status to tag severity for consistent styling
 * @description Maps response status values to tag colors. Accepts the raw API
 * value (which may be null or uppercase like 'RESPONDED') and normalizes
 * before lookup to mirror the survey utility helpers. Null/undefined is
 * treated as NOT_RESPONDED so missing response_status renders the same
 * severity ('info') as an explicit 'not_responded' value.
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="survey.response_status | surveyResponseSeverity">{{ survey.response_status }}</lfx-tag>
 */
@Pipe({
  name: 'surveyResponseSeverity',
})
export class SurveyResponseSeverityPipe implements PipeTransform {
  public transform(status: string | null | undefined): TagSeverity {
    const normalized = status == null ? SurveyResponseStatus.NOT_RESPONDED : (status.toLowerCase() as SurveyResponseStatus);
    return SURVEY_RESPONSE_STATUS_SEVERITY[normalized] ?? 'secondary';
  }
}
