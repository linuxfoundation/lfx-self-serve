// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SURVEY_RESPONSE_STATUS_LABELS } from '@lfx-one/shared/constants';
import { SurveyResponseStatus } from '@lfx-one/shared/enums';

/**
 * Transforms a survey response status into a human-readable label.
 * Accepts the raw API value (possibly null or uppercase) and normalizes
 * before lookup to mirror the survey utility helpers. Null/undefined is
 * treated as NOT_RESPONDED so users without a recorded response see the
 * same label as those whose response_status is explicitly 'not_responded'.
 */
@Pipe({
  name: 'surveyResponseLabel',
})
export class SurveyResponseLabelPipe implements PipeTransform {
  public transform(status: string | null | undefined): string {
    const normalized = status == null ? SurveyResponseStatus.NOT_RESPONDED : (status.toLowerCase() as SurveyResponseStatus);
    return SURVEY_RESPONSE_STATUS_LABELS[normalized] ?? status ?? '';
  }
}
