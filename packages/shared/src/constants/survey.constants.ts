// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SurveyResponseStatus, SurveyStatus } from '../enums/survey.enum';
import type { TagSeverity } from '../interfaces/components.interface';
import type { CombinedSurveyStatus, SurveyEmailAudience, SurveyEmailDraft } from '../interfaces/survey.interface';

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
 * Combined survey status values
 * @description Symbol-friendly map of {@link CombinedSurveyStatus} string values
 * so call sites can avoid magic strings while staying type-narrow.
 */
export const COMBINED_SURVEY_STATUS = {
  OPEN: 'open',
  SUBMITTED: 'submitted',
  CLOSED: 'closed',
} as const satisfies Record<string, CombinedSurveyStatus>;

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
 * Delay before an "immediate" survey send_date to satisfy the upstream future-date requirement.
 */
export const SURVEY_IMMEDIATE_SEND_OFFSET_MS = 5 * 60 * 1000;

/**
 * Allowed origins for survey response links surfaced to members.
 */
export const SURVEY_LINK_ALLOWLIST: string[] = [
  'https://www.surveymonkey.com',
  'https://linuxfoundation.surveymonkey.com',
  'https://www.research.net',
  'https://linuxfoundation.research.net',
];

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
 * HTML that replaces the `{{SurveyButton}}` placeholder in the survey email body
 * @description Link button plus a copy-paste fallback; uses the user-facing `{{SurveyLink}}` form
 */
export const SURVEY_EMAIL_BUTTON_HTML =
  '<a href="{{SurveyLink}}" class="cta-button">Take Survey</a><br><div><p>Button not visible? Copy and paste the following link into your browser instead:</p></div>\n<div>{{SurveyLink}}</div>';

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
    label: 'Company',
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
 * Template-title keyword that selects the maintainer email draft
 * @description ITX templates carry no category field, so the audience is read from the title, as PCC does
 */
export const SURVEY_MAINTAINER_TEMPLATE_KEYWORD = 'maintainer';

/**
 * Default survey email drafts by audience
 * @description The wizard starts from `general` and swaps in the chosen template's draft, but only into
 * fields that still hold a default draft, so user edits are never overwritten. Copy mirrors PCC's
 * SURVEY_DEFAULT_SUBJECT/BODY and SURVEY_DEFAULT_MAINTAINER_SUBJECT/BODY (#5124).
 */
export const SURVEY_EMAIL_DRAFTS: Readonly<Record<SurveyEmailAudience, SurveyEmailDraft>> = {
  general: {
    subject: '{{FirstName}}, Your Voice Matters! - {{ProjectName}}, {{CommitteeType}}',
    body: `Thank you for being a valuable member of the {{CommitteeName}}. We respect your opinion as your feedback helps us get better every day.

Please share your experience by clicking the button below and completing a short survey. It will take under a minute.

{{SurveyButton}}

Thank you,
{{ExecutiveDirectorName}}`,
  },
  maintainer: {
    subject: '{{FirstName}}, Your Feedback as a {{ProjectName}} Maintainer Matters!',
    body: `Thank you for the dedication and hard work invested in maintaining {{ProjectName}}! As part of ongoing efforts to enhance the maintainer experience, {{ProjectName}} is working with The Linux Foundation LFX team to carry out a survey.

We'd appreciate it if you could take a few minutes to share your thoughts and opinions by clicking the button below. The survey is essential in driving meaningful improvements to {{ProjectName}}.

{{SurveyButton}}

For any questions or suggestions regarding the survey, feel free to reach out via email at lfxsurveys@linuxfoundation.org.

Thank you for being an integral part of the {{ProjectName}} community.
{{ExecutiveDirectorName}}`,
  },
};

/**
 * Page size for the per-recipient survey responses list.
 * The results drawer pages through every response so filters, rates and the CSV
 * cover all recipients; 200 is the BFF's per_page cap.
 */
export const SURVEY_RESPONSES_PAGE_SIZE = 200;

/**
 * Upper bound on response pages fetched for one survey (50 × 200 = 10,000 recipients),
 * so a looping upstream page token can never fetch forever.
 */
export const SURVEY_RESPONSES_MAX_PAGES = 50;

/**
 * Most recipients one reminder request may name. Each one is emailed, and the write rate
 * limiter counts requests, not recipients. Larger than any board or committee survey.
 */
export const SURVEY_REMINDER_MAX_RECIPIENTS = 1000;

/**
 * Error code for a reminder or resync refused before anything was sent, because the
 * BFF couldn't verify the caller's access or the recipients (an upstream read or access
 * check failed). The client can say nothing was sent and a retry is safe.
 */
export const SURVEY_FOLLOW_UP_PRECHECK_FAILED = 'SURVEY_FOLLOW_UP_PRECHECK_FAILED';

/**
 * Position of each invitation-email status in the funnel (higher = further along).
 * A row at a later stage counts toward every earlier stage. "Responded" is deliberately
 * absent: someone can answer through a copied personal link after their email bounced,
 * so a response is not evidence of delivery, opening or clicking.
 */
export const SURVEY_RESPONSE_FUNNEL_RANK: Readonly<Record<string, number>> = {
  delivered: 1,
  opened: 2,
  clicked: 3,
};

/**
 * Short TTL so the writerGuard probe and the manage-page edit fetch share one request; entries
 * evict on error and on delete. Mirrors MEETING_DETAIL_CACHE_TTL_MS.
 */
export const SURVEY_DETAIL_CACHE_TTL_MS = 10 * 1000;

/** Total upstream budget for optional committee-writer enrichment of an otherwise-readable survey list. */
export const SURVEY_COMMITTEE_ACCESS_TIMEOUT_MS = 5000;
