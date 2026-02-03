// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import { TagSeverity } from '../interfaces/components.interface';

/**
 * Configurable labels for surveys displayed throughout the UI
 * @description This constant allows the user-facing labels to be changed
 * while keeping all code and file names consistent
 * @readonly
 * @example
 * // Use in templates to display the label
 * <h1>{{SURVEY_LABEL.plural}}</h1> // Displays "Surveys"
 * <span>{{SURVEY_LABEL.singular}} Name</span> // Displays "Survey Name"
 */
export const SURVEY_LABEL = {
  singular: 'Survey',
  plural: 'Surveys',
} as const;

/**
 * Survey status display labels
 * @description Human-readable labels for survey statuses
 */
export const SURVEY_STATUS_LABELS = {
  [SurveyStatus.OPEN]: 'Open',
  [SurveyStatus.CLOSED]: 'Closed',
  [SurveyStatus.SCHEDULED]: 'Scheduled',
  [SurveyStatus.DRAFT]: 'Draft',
  [SurveyStatus.SENT]: 'Open',
} as const;

/**
 * Survey status severity mappings
 * @description Maps survey statuses to tag severity levels for styling
 */
export const SURVEY_STATUS_SEVERITY: Record<SurveyStatus, TagSeverity> = {
  [SurveyStatus.OPEN]: 'info',
  [SurveyStatus.CLOSED]: 'secondary',
  [SurveyStatus.SCHEDULED]: 'warn',
  [SurveyStatus.DRAFT]: 'warn',
  [SurveyStatus.SENT]: 'info',
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

/**
 * Survey type display labels
 * @description Human-readable labels for survey types based on is_nps_survey flag
 */
export const SURVEY_TYPE_LABELS = {
  nps: 'NPS Survey',
  standard: 'Standard Survey',
} as const;

// ============================================================================
// Survey Manage Form Configuration Constants
// ============================================================================

/**
 * Step titles for the survey creation/edit stepper
 * @description Array of human-readable titles for each step in the survey form
 */
export const SURVEY_MANAGE_STEP_TITLES = ['Audience & Type', 'Timing & Reminders', 'Email Draft', 'Review & Confirm'] as const;

/**
 * Total number of steps in the survey wizard
 * @description Must match the length of SURVEY_MANAGE_STEP_TITLES array
 */
export const SURVEY_MANAGE_TOTAL_STEPS = SURVEY_MANAGE_STEP_TITLES.length;

/**
 * Survey form step indices
 * @description One-based step numbers for form navigation and validation
 * @readonly
 */
export const SURVEY_MANAGE_FORM_STEPS = {
  /** Step 1: Audience & Type (target audience, survey type) */
  AUDIENCE_TYPE: 1,
  /** Step 2: Timing & Reminders (cutoff date, reminder settings) */
  TIMING_REMINDERS: 2,
  /** Step 3: Email Draft (email subject, body content) */
  EMAIL_DRAFT: 3,
  /** Step 4: Review and confirm all settings */
  REVIEW: 4,
} as const;

/**
 * Survey type options for survey creation
 * @description Defines the type of survey to create
 */
export const SURVEY_TYPE_OPTIONS = [
  {
    label: 'NPS Survey',
    value: 'nps',
    description: 'Measure satisfaction with a Net Promoter Score question',
    icon: 'fa-light fa-chart-line',
  },
  {
    label: 'Standard Survey',
    value: 'standard',
    description: 'Custom survey with multiple question types',
    icon: 'fa-light fa-list-check',
  },
] as const;

/**
 * Survey audience options
 * @description Defines who will receive the survey
 * Values align with committee filters
 */
export const SURVEY_AUDIENCE_OPTIONS = [
  { label: 'All Members', value: 'all', description: 'Send to all members of the selected group' },
  { label: 'Voting Reps Only', value: 'voting_rep', description: 'Only voting representatives will receive the survey' },
  {
    label: 'Voting Reps and Alternates',
    value: 'voting_rep,alternate_voting_rep',
    description: 'Voting reps and their alternates will receive the survey',
  },
] as const;

/**
 * Survey reminder frequency options
 * @description Defines how often reminders are sent
 */
export const SURVEY_REMINDER_OPTIONS = [
  { label: 'No reminders', value: 'none', description: 'Do not send any reminder emails' },
  { label: 'Once (3 days before close)', value: 'once', description: 'Send a single reminder 3 days before the survey closes' },
  { label: 'Weekly', value: 'weekly', description: 'Send weekly reminders until the survey closes' },
  { label: 'Daily', value: 'daily', description: 'Send daily reminders until the survey closes' },
] as const;

/**
 * Survey distribution method options
 * @description Defines when the survey should be distributed
 */
export const SURVEY_DISTRIBUTION_OPTIONS = [
  { label: 'Immediate', value: 'immediate' },
  { label: 'Scheduled', value: 'scheduled' },
] as const;

/**
 * Survey reminder type options
 * @description Defines how reminders should be sent
 */
export const SURVEY_REMINDER_TYPE_OPTIONS = [
  { label: 'Automatic', value: 'automatic' },
  { label: 'Manual', value: 'manual' },
] as const;

/**
 * Survey automatic reminder frequency options
 * @description Frequency options for automatic reminders
 */
export const SURVEY_AUTO_REMINDER_FREQUENCY_OPTIONS = [
  { label: 'Every 3 days', value: '3' },
  { label: 'Every 7 days', value: '7' },
  { label: 'Every 14 days', value: '14' },
] as const;

/**
 * Send survey confirmation dialog configuration (immediate distribution)
 * @description Configuration for the confirmation dialog shown when sending a survey immediately
 */
export const SEND_SURVEY_CONFIRMATION = {
  header: 'Send Survey',
  message: 'Are you sure you want to send this survey? Once sent, emails will be delivered to all recipients.',
  acceptLabel: 'Yes, send survey',
  rejectLabel: 'Cancel',
} as const;

/**
 * Schedule survey confirmation dialog configuration
 * @description Configuration for the confirmation dialog shown when scheduling a survey
 */
export const SCHEDULE_SURVEY_CONFIRMATION = {
  header: 'Schedule Survey',
  message: 'Are you sure you want to schedule this survey? Emails will be delivered to all recipients on the scheduled date.',
  acceptLabel: 'Yes, schedule survey',
  rejectLabel: 'Cancel',
} as const;

/**
 * Sample data for email preview
 * @description Sample values used to preview email templates
 */
export const SURVEY_EMAIL_PREVIEW_SAMPLE_DATA: Record<string, string> = {
  '{{FirstName}}': 'John',
  '{{LastName}}': 'Doe',
  '{{EmailAddress}}': 'john.doe@example.com',
  '{{OrganizationName}}': 'Acme Corporation',
  '{{ProjectName}}': 'Cloud Native Computing Foundation',
  '{{CommitteeName}}': 'Technical Oversight Committee',
  '{{CommitteeType}}': 'Board',
  '{{MembershipTier}}': 'Platinum',
  '{{SurveyTemplate}}': 'Governing Board NPS Survey',
  '{{SurveyLink}}': 'https://survey.lfx.dev/abc123',
  '{{SurveyButton}}': '[Take Survey]',
  '{{CutoffDate}}': 'February 28, 2026',
  '{{Quarter}}': 'Q1',
  '{{Year}}': '2026',
  '{{ExecutiveDirectorName}}': 'Jane Smith',
  '{{SenderTitle}}': 'Executive Director',
  '{{SenderEmail}}': 'director@linuxfoundation.org',
} as const;

/**
 * Email template variable groups
 * @description Custom variables available for email personalization
 */
export const SURVEY_EMAIL_TEMPLATE_VARIABLES = {
  participant: {
    label: 'Participant',
    variables: ['{{FirstName}}', '{{LastName}}', '{{EmailAddress}}'],
  },
  organization: {
    label: 'Organization',
    variables: ['{{OrganizationName}}', '{{ProjectName}}', '{{CommitteeName}}', '{{CommitteeType}}', '{{MembershipTier}}'],
  },
  survey: {
    label: 'Survey',
    variables: ['{{SurveyTemplate}}', '{{SurveyLink}}', '{{SurveyButton}}', '{{CutoffDate}}', '{{Quarter}}', '{{Year}}'],
  },
  sender: {
    label: 'Sender',
    variables: ['{{ExecutiveDirectorName}}', '{{SenderTitle}}', '{{SenderEmail}}'],
  },
} as const;

/**
 * Survey template options (NPS surveys)
 * @description Available NPS survey templates for selection
 * TODO: Replace with API-driven templates in the future
 */
export const SURVEY_TEMPLATE_OPTIONS = [
  { label: 'Governing Board NPS Survey', value: 'governing-board-nps' },
  { label: 'Maintainer Survey', value: 'maintainer-survey' },
  { label: 'Foundation-Wide Survey', value: 'foundation-wide-survey' },
  { label: 'Committee Effectiveness Survey', value: 'committee-effectiveness-survey' },
  { label: 'Working Group Survey', value: 'working-group-survey' },
  { label: 'Event Feedback Survey', value: 'event-feedback-survey' },
  { label: 'Community Feedback Survey', value: 'community-feedback-survey' },
] as const;
