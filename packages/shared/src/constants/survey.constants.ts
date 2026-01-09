// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import { TagSeverity } from '../interfaces/components.interface';

/**
 * Survey status display labels
 * @description Human-readable labels for survey statuses
 */
export const SURVEY_STATUS_LABELS = {
  [SurveyStatus.OPEN]: 'Open',
  [SurveyStatus.CLOSED]: 'Closed',
  [SurveyStatus.SCHEDULED]: 'Scheduled',
} as const;

/**
 * Survey status severity mappings
 * @description Maps survey statuses to tag severity levels for styling
 */
export const SURVEY_STATUS_SEVERITY: Record<SurveyStatus, TagSeverity> = {
  [SurveyStatus.OPEN]: 'info',
  [SurveyStatus.CLOSED]: 'secondary',
  [SurveyStatus.SCHEDULED]: 'warn',
} as const;

/**
 * Survey response status display labels
 * @description Human-readable labels for survey response statuses
 */
export const SURVEY_RESPONSE_STATUS_LABELS = {
  [SurveyResponseStatus.RESPONDED]: 'Responded',
  [SurveyResponseStatus.NOT_RESPONDED]: 'Not Responded',
} as const;

/**
 * Survey response status severity mappings
 * @description Maps survey response statuses to tag severity levels for styling
 */
export const SURVEY_RESPONSE_STATUS_SEVERITY: Record<SurveyResponseStatus, TagSeverity> = {
  [SurveyResponseStatus.RESPONDED]: 'success',
  [SurveyResponseStatus.NOT_RESPONDED]: 'info',
} as const;

/**
 * Combined survey status display labels
 * @description Human-readable labels for combined survey statuses (survey status + response status)
 */
export const COMBINED_SURVEY_STATUS_LABELS = {
  open: 'Open',
  submitted: 'Submitted',
  closed: 'Closed',
} as const;

/**
 * Combined survey status severity mappings
 * @description Maps combined survey statuses to tag severity levels for styling
 */
export const COMBINED_SURVEY_STATUS_SEVERITY: Record<string, TagSeverity> = {
  open: 'info',
  submitted: 'success',
  closed: 'secondary',
} as const;
