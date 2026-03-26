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

/**
 * Committee reference within a survey entity
 * @description Committee data with response metrics and NPS scores
 */
export interface SurveyCommittee {
  /** Committee ID */
  committee_id: string;
  /** Committee UID */
  committee_uid: string;
  /** Committee display name */
  committee_name: string;
  /** Project ID */
  project_id: string;
  /** Project UID */
  project_uid: string;
  /** Project display name */
  project_name: string;
  /** Total recipients for this committee */
  total_recipients: number;
  /** Total responses from this committee */
  total_responses: number;
  /** NPS score value */
  nps_value: number;
  /** Number of detractors */
  num_detractors: number;
  /** Number of passives */
  num_passives: number;
  /** Number of promoters */
  num_promoters: number;
}

/**
 * Survey dashboard entity
 * @description Represents a survey in the dashboard/list view from the query service
 */
export interface Survey {
  /** Unique survey identifier */
  uid: string;
  /** Display title of the survey */
  survey_title: string;
  /** Current status of the survey */
  survey_status: string;
  /** Survey deadline/cutoff date */
  survey_cutoff_date: string;
  /** Whether this is an NPS survey */
  is_nps_survey: boolean;
  /** Whether this is a project-level survey */
  is_project_survey: boolean;
  /** Associated committees */
  committees: SurveyCommittee[];
  /** Committee category */
  committee_category: string;
  /** Total responses received */
  total_responses: number;
  /** Total recipients */
  total_recipients: number;
  /** Creation timestamp */
  created_at: string;
  /** Last modification timestamp */
  last_modified_at: string;
  /** Name of the creator */
  creator_name: string;
  /** Response collection status (e.g., 'closed' when responses are no longer accepted) */
  response_status?: string;
  /** Top-level NPS score from detail API (-100 to +100) */
  nps_value?: number;
  /** Number of promoters from detail API */
  num_promoters?: number;
  /** Number of passives from detail API */
  num_passives?: number;
  /** Number of detractors from detail API */
  num_detractors?: number;
}

/**
 * NPS breakdown data
 * @description Breakdown of NPS responses into promoters, passives, and detractors
 */
export interface NpsBreakdown {
  /** Number of promoters (score 9-10) */
  promoters: number;
  /** Number of passives (score 7-8) */
  passives: number;
  /** Number of detractors (score 0-6) */
  detractors: number;
  /** Number of non-responses */
  nonResponses: number;
}

/**
 * Survey comment from a participant
 * @description Represents an individual comment submitted with a survey response
 */
export interface SurveyComment {
  /** Unique comment identifier */
  id: string;
  /** Comment text content */
  comment: string;
  /** Timestamp when comment was submitted */
  submitted_at: string;
}

/**
 * Survey participation statistics
 * @description Statistics about survey participation and response rates
 */
export interface SurveyParticipationStats {
  /** Total number of eligible participants */
  eligibleParticipants: number;
  /** Total number of responses received */
  totalResponses: number;
  /** Participation rate as a percentage (0-100) */
  participationRate: number;
}

/**
 * Detailed survey results for the results drawer
 * @description Extended survey data including NPS results and comments for display in results drawer
 */
export interface SurveyResultsDetail extends Survey {
  /** NPS score (-100 to +100) - only for NPS surveys */
  nps_score?: number;
  /** NPS response breakdown - only for NPS surveys */
  nps_breakdown?: NpsBreakdown;
  /** Additional comments from participants */
  additional_comments?: SurveyComment[];
}

/**
 * NPS Gauge size options
 * @description Available size presets for the NPS gauge component
 */
export type NpsGaugeSize = 'small' | 'medium' | 'large';

// ============================================================================
// Survey API Request Interfaces
// ============================================================================

/**
 * Request body for creating a survey
 * @description Aligns with LFX v2 survey service API contract
 * @see https://github.com/linuxfoundation/lfx-v2-survey-service
 */
export interface CreateSurveyRequest {
  /** SurveyMonkey template ID (required) */
  survey_monkey_id: string;
  /** Survey title (required) */
  survey_title: string;
  /** Whether to send immediately (required) */
  send_immediately: boolean;
  /** Scheduled send date in ISO 8601 format (required when send_immediately is false) */
  survey_send_date: string;
  /** Survey cutoff/close date in ISO 8601 format (required) */
  survey_cutoff_date: string;
  /** Reminder frequency in days (required) */
  survey_reminder_rate_days: number;
  /** Email subject line (required) */
  email_subject: string;
  /** HTML email body (required) */
  email_body: string;
  /** Plain text email body (required) */
  email_body_text: string;
  /** V2 committee UID (required) */
  committee_uid: string;
  /** Whether committee voting members are eligible (required) */
  committee_voting_enabled: boolean;
  /** Whether this is a project-level survey (false for committee-level surveys) */
  is_project_survey?: boolean;
  /** Stage filter for survey audience (optional) */
  stage_filter?: string;
  /** Username of the creator (enriched server-side from OIDC session) */
  creator_username?: string;
  /** Display name of the creator (enriched server-side from OIDC session) */
  creator_name?: string;
  /** Auth0 user ID of the creator (enriched server-side from OIDC session) */
  creator_id?: string;
}

// ============================================================================
// Survey Manage Form Interfaces
// ============================================================================

/**
 * Survey manage mode
 * @description Determines if we're creating or editing a survey
 */
export type SurveyManageMode = 'create' | 'edit';

/**
 * Survey type for survey creation
 * @description Determines the type of survey being created
 */
export type SurveyType = 'nps' | 'standard';

/**
 * Survey reminder frequency
 * @description How often to send reminder emails
 */
export type SurveyReminderFrequency = 'none' | 'once' | 'weekly' | 'daily';

/**
 * Survey distribution method
 * @description When the survey should be distributed
 */
export type SurveyDistributionMethod = 'immediate' | 'scheduled';

/**
 * Survey reminder type
 * @description How reminders should be sent
 */
export type SurveyReminderType = 'automatic' | 'manual';

/**
 * Survey form data structure
 * @description Represents the form data for creating/editing a survey
 */
export interface SurveyFormData {
  // Step 1: Audience & Type
  /** Title of the survey */
  title: string;
  /** Selected committees/groups */
  committees: CommitteeReference[];
  /** Target audience filter (who receives the survey) */
  audience: string;
  /** Selected survey template */
  surveyTemplate: string;

  // Step 2: Timing & Reminders
  /** Distribution method (immediate or scheduled) */
  distributionMethod: SurveyDistributionMethod;
  /** Scheduled date (only when distributionMethod is 'scheduled') */
  scheduledDate: Date | null;
  /** Survey cutoff/close date */
  cutoffDate: Date | null;
  /** Reminder type (automatic or manual) */
  reminderType: SurveyReminderType;
  /** Reminder frequency setting (only when reminderType is 'automatic') */
  reminderFrequency: SurveyReminderFrequency;

  // Step 3: Email Draft
  /** Email subject line */
  emailSubject: string;
  /** Email body content */
  emailBody: string;
}

/**
 * Survey review form values
 * @description Raw form values extracted for the review step display
 */
export interface SurveyReviewFormValue {
  /** Selected survey template */
  surveyTemplate: string;
  /** Selected committees/groups */
  committees: CommitteeReference[];
  /** Distribution method (immediate or scheduled) */
  distributionMethod: SurveyDistributionMethod;
  /** Scheduled date (only when distributionMethod is 'scheduled') */
  scheduledDate: Date | null;
  /** Survey cutoff/close date */
  cutoffDate: Date | null;
  /** Reminder type (automatic or manual) */
  reminderType: SurveyReminderType;
  /** Reminder frequency value as string */
  reminderFrequency: string;
  /** Email subject line */
  emailSubject: string;
  /** Email body content */
  emailBody: string;
}

/**
 * Survey review data for display
 * @description Formatted data for the review step
 */
export interface SurveyReviewData {
  /** Display title */
  title: string;
  /** Committee/group name */
  committeeName: string;
  /** Audience description */
  audienceLabel: string;
  /** Survey type label */
  surveyTypeLabel: string;
  /** Formatted close date */
  closeDateFormatted: string;
  /** Reminder frequency label */
  reminderLabel: string;
  /** Email subject */
  emailSubject: string;
  /** Email body preview */
  emailBodyPreview: string;
}
