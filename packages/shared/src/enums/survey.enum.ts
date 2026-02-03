// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Survey status options
 * @description Possible states for a survey
 */
export enum SurveyStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  SCHEDULED = 'scheduled',
  DRAFT = 'draft',
  SENT = 'sent',
}

/**
 * User's survey response status
 * @description Status of a user's participation in a survey
 */
export enum SurveyResponseStatus {
  RESPONDED = 'responded',
  NOT_RESPONDED = 'not_responded',
}
