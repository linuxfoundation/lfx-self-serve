// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import { CommitteeReference } from './committee.interface';

/**
 * User's survey participation
 * @description Represents a user's participation in a survey - aligns with lfx-pcc IndividualSurveyResponse
 */
export interface UserSurvey {
  /** Unique survey identifier */
  survey_id: string;
  /** Display title of the survey */
  survey_title: string;
  /** Current status of the survey */
  survey_status: SurveyStatus;
  /** Associated committees with allowed voting statuses */
  committees: CommitteeReference[];
  /** Survey deadline/cutoff date */
  survey_cutoff_date: string;
  /** User's response status */
  response_status: SurveyResponseStatus;
  /** Timestamp when user submitted their response (null if not responded) */
  response_datetime: string | null;
}
