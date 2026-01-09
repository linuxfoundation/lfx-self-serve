// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import { UserSurvey } from '../interfaces/survey.interface';

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
