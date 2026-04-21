// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import { Survey, UserSurvey } from '../interfaces/survey.interface';

/**
 * Combined survey status type
 * @description Represents the combined state of survey status and response status
 */
export type CombinedSurveyStatus = 'open' | 'submitted' | 'closed';

/**
 * Get the combined status for a survey
 * @description Derives a single status from survey_status and response_status
 * - 'open' = survey is OPEN and user has NOT_RESPONDED
 * - 'submitted' = survey is OPEN and user has RESPONDED
 * - 'closed' = survey is CLOSED (or any other status)
 * @param survey - The user survey to get status for
 * @returns The combined survey status
 */
export function getCombinedSurveyStatus(survey: UserSurvey): CombinedSurveyStatus {
  if (survey.survey_status === SurveyStatus.CLOSED) {
    return 'closed';
  }

  if (survey.survey_status === SurveyStatus.OPEN) {
    return survey.response_status === SurveyResponseStatus.RESPONDED ? 'submitted' : 'open';
  }

  return 'closed';
}

/**
 * Get the computed display status for a survey
 * @description Derives the display status from survey_status and survey_cutoff_date
 * - 'sent' + current date < cutoff date → 'open'
 * - 'scheduled' → 'scheduled'
 * - 'sent' + current date >= cutoff date → 'closed'
 * - 'draft' → 'draft'
 * - 'open' → 'open'
 * - 'closed' → 'closed'
 * @param survey - The survey to compute status for
 * @returns The computed display status as SurveyStatus
 */
export function getSurveyDisplayStatus(survey: Pick<Survey, 'survey_status' | 'survey_cutoff_date' | 'response_status'>): SurveyStatus {
  // Normalize to lowercase so API values like 'OPEN', 'CLOSED' match enum values
  const status = (survey.survey_status as string).toLowerCase() as SurveyStatus;

  // Explicit response_status from the API takes precedence
  if (survey.response_status === 'closed') {
    return SurveyStatus.CLOSED;
  }

  if (status === SurveyStatus.SENT) {
    const cutoffDate = survey.survey_cutoff_date ? new Date(survey.survey_cutoff_date) : null;
    const now = new Date();

    if (cutoffDate && now >= cutoffDate) {
      return SurveyStatus.CLOSED;
    }
    return SurveyStatus.OPEN;
  }

  if (status === SurveyStatus.SCHEDULED) {
    return SurveyStatus.SCHEDULED;
  }

  if (status === SurveyStatus.DRAFT) {
    return SurveyStatus.DRAFT;
  }

  if (status === SurveyStatus.OPEN) {
    return SurveyStatus.OPEN;
  }

  if (status === SurveyStatus.CLOSED) {
    return SurveyStatus.CLOSED;
  }

  return status as SurveyStatus;
}
