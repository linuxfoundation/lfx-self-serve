// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { Survey, SURVEY_STATUS_LABELS, SurveyStatus } from '@lfx-one/shared';
import { getSurveyDisplayStatus } from '@lfx-one/shared/utils';

function formatScheduledSendTooltip(survey: Survey): string {
  if (!survey.survey_send_date) {
    return '';
  }
  const sendDate = new Date(survey.survey_send_date);
  if (Number.isNaN(sendDate.getTime())) {
    return '';
  }
  const formatted = sendDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `Sends on ${formatted}`;
}

@Pipe({
  name: 'scheduledSendTooltip',
  pure: true,
})
export class ScheduledSendTooltipPipe implements PipeTransform {
  public transform(survey: Survey): string {
    if (getSurveyDisplayStatus(survey) !== SurveyStatus.SCHEDULED) {
      return '';
    }
    return formatScheduledSendTooltip(survey);
  }
}

@Pipe({
  name: 'scheduledSendAriaLabel',
  pure: true,
})
export class ScheduledSendAriaLabelPipe implements PipeTransform {
  public transform(survey: Survey, openResponded: boolean): string | null {
    if (getSurveyDisplayStatus(survey) !== SurveyStatus.SCHEDULED) {
      return null;
    }
    const tooltip = formatScheduledSendTooltip(survey);
    if (!tooltip) {
      return null;
    }
    const statusLabel = openResponded ? 'Submitted' : (SURVEY_STATUS_LABELS[getSurveyDisplayStatus(survey)] ?? getSurveyDisplayStatus(survey));
    return `${statusLabel}. ${tooltip}`;
  }
}
