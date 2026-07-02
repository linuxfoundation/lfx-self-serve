// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMBINED_SURVEY_STATUS } from '../constants/survey.constants';
import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import type { CombinedSurveyStatus, NpsBand, SurveyDisplayStatusInput, SurveyResponseItem, SurveyStatusInput } from '../interfaces/survey.interface';

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

/** Returns the first non-empty trimmed string from the candidates, or null. */
function firstNonEmpty(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') {
      return c;
    }
  }
  return null;
}

/**
 * Resolve the timestamp that matches a response's delivery status.
 * @description The Responses table shows a status label with a timestamp beneath
 * it; SES exposes a distinct time per funnel stage, so the displayed time should
 * match the label (a "Clicked" row should show the click time, not the delivery
 * time). Falls back down the funnel — and finally to `created_at` — so a missing
 * SES field never blanks the cell. Unknown/Failed/Pending statuses fall back to
 * `created_at`.
 * @param item - The per-recipient survey response
 * @returns An RFC3339 timestamp string, or null when none is available
 */
export function getResponseDeliveryTimestamp(item: SurveyResponseItem): string | null {
  const status = item.response_status?.toLowerCase();

  switch (status) {
    case 'responded':
      return firstNonEmpty(item.response_datetime, item.ses_link_clicked_last_time, item.ses_email_opened_last_time, item.last_received_time, item.created_at);
    case 'clicked':
      return firstNonEmpty(item.ses_link_clicked_last_time, item.ses_email_opened_last_time, item.last_received_time, item.created_at);
    case 'opened':
      return firstNonEmpty(item.ses_email_opened_last_time, item.last_received_time, item.created_at);
    case 'delivered':
      return firstNonEmpty(item.last_received_time, item.created_at);
    default:
      return firstNonEmpty(item.created_at);
  }
}

/**
 * Classify an individual NPS score (0-10) into its band.
 * @description promoter = 9-10, passive = 7-8, detractor = 0-6. Returns null when
 * the score is absent or out of range so callers can render a neutral placeholder.
 * @param value - The individual NPS score
 * @returns The band, or null when there is no valid score
 */
export function getNpsBand(value: number | null | undefined): NpsBand | null {
  if (value === null || value === undefined || Number.isNaN(value) || value < 0 || value > 10) {
    return null;
  }
  if (value >= 9) return 'promoter';
  if (value >= 7) return 'passive';
  return 'detractor';
}

/**
 * Extract a recipient's free-text comment from their question answers.
 * @description NPS surveys typically pair the score with an open-ended follow-up;
 * this pulls the first free-text answer (a text without a choice_id, i.e. not a
 * multiple-choice label) so the Responses table can surface it in the Comment
 * column. Returns null when the recipient left no free-text answer.
 * @param item - The per-recipient survey response
 * @returns The comment text, or null when none exists
 */
export function getResponseComment(item: SurveyResponseItem): string | null {
  for (const qa of item.survey_monkey_question_answers ?? []) {
    for (const answer of qa.answers ?? []) {
      if (!answer.choice_id && typeof answer.text === 'string' && answer.text.trim() !== '') {
        return answer.text;
      }
    }
  }
  return null;
}
