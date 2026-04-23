// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMBINED_SURVEY_STATUS, type CombinedSurveyStatus } from '../constants/survey.constants';
import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import type { SurveyDisplayStatusInput, SurveyStatusInput } from '../interfaces/survey.interface';

/**
 * Sentinel value the API uses on `response_status` to signal that responses
 * are no longer accepted, regardless of `survey_status`/`survey_cutoff_date`.
 * Named with the `_SENTINEL` suffix to disambiguate from `SurveyStatus.CLOSED`
 * and `COMBINED_SURVEY_STATUS.CLOSED`, which share the same string literal but
 * live in different namespaces.
 */
const RESPONSE_STATUS_CLOSED_SENTINEL = 'closed';

// `SurveyStatus` is a string enum, so `Object.values` yields only its string
// members. If it ever gains a non-string member, narrow the cast accordingly.
const SURVEY_STATUS_VALUES = new Set<string>(Object.values(SurveyStatus));

/**
 * Resolve the effective survey status
 * @description Normalizes the raw API status to lowercase and collapses 'sent'
 * into 'open' or 'closed' based on the cutoff date so callers can compare
 * against {@link SurveyStatus} enum values without worrying about API casing
 * or the SENT/cutoff combination. Unknown raw statuses (typos, future enum
 * values) are conservatively treated as CLOSED, and an invalid/unparseable
 * cutoff date is treated as already past.
 * @param survey - Survey-shaped value with status and cutoff date
 * @returns The effective survey status
 */
export function getEffectiveSurveyStatus(survey: SurveyStatusInput): SurveyStatus {
  const raw = survey.survey_status?.toLowerCase();
  const status = raw && SURVEY_STATUS_VALUES.has(raw) ? (raw as SurveyStatus) : null;

  if (status === null) {
    return SurveyStatus.CLOSED;
  }

  if (status !== SurveyStatus.SENT) {
    return status;
  }

  const cutoffDate = survey.survey_cutoff_date ? new Date(survey.survey_cutoff_date) : null;

  // Treat invalid/missing cutoffs as already past so a SENT survey doesn't
  // appear actionable indefinitely if data is malformed.
  if (cutoffDate === null || Number.isNaN(cutoffDate.getTime())) {
    return SurveyStatus.CLOSED;
  }

  return new Date() >= cutoffDate ? SurveyStatus.CLOSED : SurveyStatus.OPEN;
}

/**
 * Get the combined status for a survey
 * @description Derives a single status from survey_status, survey_cutoff_date and response_status
 * - 'open' = survey is effectively OPEN (incl. SENT with future cutoff) and the user has not yet responded
 * - 'submitted' = survey is effectively OPEN and `response_status` is 'responded' (case-insensitive)
 * - 'closed' = survey is CLOSED, SENT past its cutoff, the API's `response_status` closed sentinel,
 *   or any other non-actionable status
 * Anything other than the literal 'responded' (including null/undefined or other API casings)
 * is treated as not-yet-responded so missing data still surfaces actionable surveys.
 * Uses {@link getSurveyDisplayStatus} so the API's `response_status === 'closed'` sentinel is
 * honored and an effectively-closed survey can never be classified as 'open' or 'submitted'.
 * @param survey - The user survey to get status for
 * @returns The combined survey status
 */
export function getCombinedSurveyStatus(survey: SurveyDisplayStatusInput): CombinedSurveyStatus {
  const displayStatus = getSurveyDisplayStatus(survey);

  if (displayStatus !== SurveyStatus.OPEN) {
    return COMBINED_SURVEY_STATUS.CLOSED;
  }

  // Normalize response_status casing to absorb any uppercase API values, mirroring
  // how getEffectiveSurveyStatus normalizes survey_status.
  const responseStatus = survey.response_status?.toLowerCase();
  return responseStatus === SurveyResponseStatus.RESPONDED ? COMBINED_SURVEY_STATUS.SUBMITTED : COMBINED_SURVEY_STATUS.OPEN;
}

/**
 * Get the computed display status for a survey
 * @description Builds on {@link getEffectiveSurveyStatus} with one extra rule:
 * if the API explicitly sets `response_status` to the closed sentinel, the
 * survey is treated as CLOSED regardless of its raw status or cutoff date.
 * The check is case-insensitive to mirror {@link getEffectiveSurveyStatus}.
 * @param survey - The survey to compute status for
 * @returns The computed display status as SurveyStatus
 */
export function getSurveyDisplayStatus(survey: SurveyDisplayStatusInput): SurveyStatus {
  if (survey.response_status?.toLowerCase() === RESPONSE_STATUS_CLOSED_SENTINEL) {
    return SurveyStatus.CLOSED;
  }

  return getEffectiveSurveyStatus(survey);
}
