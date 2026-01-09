// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { SURVEY_RESPONSE_STATUS_LABELS, SurveyResponseStatus } from '@lfx-one/shared';

@Pipe({
  name: 'surveyResponseLabel',
})
export class SurveyResponseLabelPipe implements PipeTransform {
  public transform(status: SurveyResponseStatus): string {
    return SURVEY_RESPONSE_STATUS_LABELS[status] ?? status;
  }
}
