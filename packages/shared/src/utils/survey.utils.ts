// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMBINED_SURVEY_STATUS, SURVEY_RESPONSE_FUNNEL_RANK } from '../constants/survey.constants';
import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import type {
  CombinedSurveyStatus,
  NpsBand,
  RenderedSurveyEmail,
  Survey,
  SurveyDisplayStatusInput,
  SurveyEmailRenderContext,
  SurveyEngagementRates,
  SurveyResponseItem,
  SurveyStatusInput,
} from '../interfaces/survey.interface';
import { escapeHtml } from './html-utils';

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

/**
 * Whether a recipient has submitted a response.
 * @param item - The per-recipient survey response
 */
export function hasSurveyResponse(item: SurveyResponseItem): boolean {
  return typeof item.response_datetime === 'string' && item.response_datetime.trim() !== '';
}

function percentOf(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/**
 * Aggregate delivery, open, click, response and comment counts across every response row.
 * @description A recipient counts for a stage when SES flagged it or when their delivery
 * status is that stage or later (a "Clicked" row was also opened and delivered). Delivery
 * rate is over all recipients; open and click rates are over delivered; comment rate is
 * over responded.
 * @param rows - Every per-recipient response row for the survey (all pages)
 * @returns Counts and whole-percentage rates
 */
export function getSurveyEngagementRates(rows: readonly SurveyResponseItem[]): SurveyEngagementRates {
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  let responded = 0;
  let commented = 0;

  for (const row of rows) {
    const rank = SURVEY_RESPONSE_FUNNEL_RANK[(row.response_status ?? '').toLowerCase()] ?? 0;
    const hasResponded = hasSurveyResponse(row);
    if (row.ses_delivery_successful === true || rank >= 1 || hasResponded) delivered++;
    if (row.ses_email_opened === true || rank >= 2) opened++;
    if (row.ses_link_clicked === true || rank >= 3) clicked++;
    if (hasResponded) {
      responded++;
      if (getResponseComment(row) !== null) commented++;
    }
  }

  return {
    recipients: rows.length,
    delivered,
    opened,
    clicked,
    responded,
    commented,
    deliveryRate: percentOf(delivered, rows.length),
    openRate: percentOf(opened, delivered),
    clickRate: percentOf(clicked, delivered),
    commentRate: percentOf(commented, responded),
  };
}

/** Formats a survey cutoff date as e.g. "November 30, 2026" (UTC), or '' when absent or invalid. */
function formatSurveyCutoffDate(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
}

/** Matches `{{.Name}}` (ITX/Go templates, used by board surveys) and `{{Name}}` (Self Serve's wizard). */
const SURVEY_EMAIL_PLACEHOLDER = /\{\{\s*\.?([A-Za-z]+)\s*\}\}/g;

/**
 * Render a survey's sent email as one recipient received it.
 * @description Replaces the template placeholders with the recipient's values. Values are
 * HTML-escaped in the body (quotes included, so a value inside an attribute stays inert);
 * the subject is plain text. Unknown placeholders are left as-is.
 * @param survey - Survey detail carrying `email_subject` / `email_body`
 * @param item - The recipient's response row
 * @param context - Project-level values the row does not carry
 * @returns The rendered subject and HTML body
 */
export function renderSurveyEmailForRecipient(survey: Survey, item: SurveyResponseItem, context: SurveyEmailRenderContext = {}): RenderedSurveyEmail {
  const committee = survey.committees?.find((c) => c.committee_uid === item.committee_uid);
  const surveyLink = item.survey_link || '#';
  const values: Record<string, string> = {
    FirstName: item.first_name ?? '',
    LastName: item.last_name ?? '',
    EmailAddress: item.email ?? '',
    ProjectName: item.project?.name || committee?.project_name || context.projectName || '',
    CommitteeName: committee?.committee_name ?? '',
    CommitteeType: survey.committee_category ?? '',
    OrganizationName: item.organization?.name ?? '',
    MembershipTier: item.membership_tier ?? '',
    SurveyLink: surveyLink,
    CutoffDate: formatSurveyCutoffDate(survey.survey_cutoff_date),
    ExecutiveDirectorName: context.executiveDirectorName ?? '',
    ProgramManagerName: context.programManagerName ?? '',
    ProjectLogo: context.projectLogo ?? '',
    TrackerAlertPartial: '',
  };

  const render = (template: string, escape: boolean): string =>
    template.replace(SURVEY_EMAIL_PLACEHOLDER, (match, name: string) => {
      // {{SurveyButton}} (Self Serve wizard) is markup, not a value: a link to the recipient's survey.
      if (name === 'SurveyButton') {
        return escape ? `<a href="${escapeHtml(surveyLink)}" target="_blank" rel="noopener noreferrer">Take the survey</a>` : 'Take the survey';
      }
      if (!(name in values)) return match;
      return escape ? escapeHtml(values[name]) : values[name];
    });

  return {
    subject: render(survey.email_subject ?? '', false),
    html: render(survey.email_body ?? '', true),
  };
}

/**
 * Build a `mailto:` link that opens a follow-up email to one recipient with their personal link.
 * @param survey - The survey being followed up
 * @param item - The recipient's response row
 * @returns The mailto URL, or null when the recipient has no email address
 */
export function buildSurveyFollowUpMailto(survey: Survey, item: SurveyResponseItem): string | null {
  if (!item.email) return null;

  const greeting = item.first_name ? `Hi ${item.first_name},` : 'Hi,';
  const cutoff = formatSurveyCutoffDate(survey.survey_cutoff_date);
  const deadline = cutoff ? ` by ${cutoff}` : '';
  const linkLine = item.survey_link ? `\n\nYour personal survey link:\n${item.survey_link}` : '';
  const body = `${greeting}\n\nA quick reminder to share your feedback in the "${survey.survey_title}" survey${deadline}.${linkLine}\n\nThank you!`;

  return `mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(`Reminder: ${survey.survey_title}`)}&body=${encodeURIComponent(body)}`;
}

/**
 * Build CSV rows (header first) for a survey's responses. Personal survey links are deliberately excluded.
 * @param survey - The survey, used for committee labels
 * @param rows - Every per-recipient response row
 * @returns Rows ready for `downloadCsv`
 */
export function buildSurveyResponsesCsvRows(survey: Survey, rows: readonly SurveyResponseItem[]): (string | number)[][] {
  const header = ['Name', 'Email', 'Organization', 'Committee', 'Role', 'Delivery Status', 'Delivered', 'Opened', 'Clicked', 'Responded At', 'NPS', 'Comment'];
  const yesNo = (value: boolean | undefined): string => (value ? 'Yes' : 'No');

  const body = rows.map((row) => {
    const committee = survey.committees?.find((c) => c.committee_uid === row.committee_uid);
    const responded = hasSurveyResponse(row);
    return [
      `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.username || '',
      row.email ?? '',
      row.organization?.name ?? '',
      [committee?.project_name, committee?.committee_name].filter(Boolean).join(' | '),
      row.role ?? '',
      row.response_status ?? '',
      yesNo(row.ses_delivery_successful),
      yesNo(row.ses_email_opened),
      yesNo(row.ses_link_clicked),
      responded ? (row.response_datetime ?? '') : '',
      responded && typeof row.nps_value === 'number' ? row.nps_value : '',
      getResponseComment(row) ?? '',
    ];
  });

  return [header, ...body];
}
