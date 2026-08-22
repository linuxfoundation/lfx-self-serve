// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ArtifactVisibility, MeetingType, MeetingVisibility } from '../enums';
import type { AttachmentCategory, CardSelectorOption, MeetingComposerPreviewFeature, MeetingTypeConfig } from '../interfaces';
import { lfxColors } from './colors.constants';

/**
 * Service-account usernames/emails that own `created_by` on system-created meetings
 * (e.g. Zoom webhook events). These are not real people and must never be shown as
 * the meeting organizer — the organizer derivation skips them.
 */
export const MEETING_ORGANIZER_SKIP_IDENTIFIERS = ['zoom.webhooks', 'zoom.events'];

/**
 * Host-key visibility window — minutes before meeting start when the key becomes visible.
 * Mirrors PCC's showHostKey() logic. The Zoom host key is account-level and can change
 * leading up to a meeting, so exposing it too early risks showing a stale value.
 */
export const HOST_KEY_EARLY_MINUTES = 70;

/**
 * Host-key visibility window — minutes after meeting end when the key is no longer visible.
 * Mirrors PCC's showHostKey() logic.
 */
export const HOST_KEY_LATE_MINUTES = 40;

/**
 * Available meeting platforms and their configurations
 * @description Defines the supported platforms for hosting meetings
 */
export const MEETING_PLATFORMS = [
  {
    value: 'Zoom',
    label: 'Zoom',
    description: 'Video conferencing with recording and chat features',
    available: true,
    icon: 'fa-light fa-video',
    color: lfxColors.blue[500],
  },
  {
    value: 'Microsoft Teams',
    label: 'Microsoft Teams',
    description: 'Integrated collaboration with Office 365',
    available: false,
    icon: 'fa-light fa-desktop',
    color: lfxColors.gray[500],
  },
  {
    value: 'In-Person',
    label: 'In-Person',
    description: 'Physical meeting location',
    available: false,
    icon: 'fa-light fa-location-dot',
    color: lfxColors.gray[500],
  },
];

/**
 * Available meeting features that can be enabled/disabled, keyed by the form control they drive
 * @description Feature toggles for recording, transcripts, AI features, etc.
 */
export const MEETING_FEATURE_BY_KEY = {
  recording_enabled: {
    key: 'recording_enabled',
    icon: 'fa-light fa-video',
    title: 'Enable Recording',
    description: 'Record the meeting for those who cannot attend live',
    recommended: true,
    color: lfxColors.blue[500],
  },
  zoom_ai_enabled: {
    key: 'zoom_ai_enabled',
    icon: 'fa-light fa-microchip-ai',
    title: 'AI Meeting Summary',
    description: 'Generate key takeaways and action items automatically',
    recommended: true,
    color: lfxColors.emerald[500],
  },
  transcript_enabled: {
    key: 'transcript_enabled',
    icon: 'fa-light fa-file-lines',
    title: 'Generate Transcripts',
    description: 'Automatically create searchable text transcripts',
    recommended: false,
    color: lfxColors.violet[500],
  },
  youtube_upload_enabled: {
    key: 'youtube_upload_enabled',
    icon: 'fa-light fa-upload',
    title: 'YouTube Auto-upload',
    description: "Automatically publish recordings to your project's YouTube channel",
    recommended: false,
    color: lfxColors.red[500],
  },
};

/**
 * Artifact visibility control options
 * @description Defines who can access meeting artifacts (recordings, transcripts, AI summaries)
 */
export const ARTIFACT_VISIBILITY_OPTIONS = [
  { label: 'Meeting Hosts Only', value: ArtifactVisibility.MEETING_HOSTS },
  { label: 'Meeting Guests', value: ArtifactVisibility.MEETING_PARTICIPANTS },
  { label: 'Public', value: ArtifactVisibility.PUBLIC },
];

/**
 * Meeting visibility card-selector options
 * @description Controls who can find the meeting in calendars and listings (maps to the `visibility` API field)
 */
export const MEETING_VISIBILITY_OPTIONS: CardSelectorOption<MeetingVisibility>[] = [
  {
    label: 'Public',
    value: MeetingVisibility.PUBLIC,
    info: {
      icon: 'fa-light fa-globe',
      description: 'Listed on the public project calendar and discoverable in the app',
      color: lfxColors.emerald[500],
    },
  },
  {
    label: 'Private',
    value: MeetingVisibility.PRIVATE,
    info: {
      icon: 'fa-light fa-eye-slash',
      description: 'Hidden from the public calendar; only guests with the meeting link can find it',
      color: lfxColors.gray[500],
    },
  },
];

/**
 * Meeting join restriction card-selector options
 * @description Controls who can join the meeting (maps to the `restricted` API field)
 */
export const MEETING_JOIN_RESTRICTION_OPTIONS: CardSelectorOption<boolean>[] = [
  {
    label: 'Anyone with the link',
    value: false,
    info: {
      icon: 'fa-light fa-link',
      description: 'Anyone who has the meeting link can join',
      color: lfxColors.blue[500],
    },
  },
  {
    label: 'Invited guests only',
    value: true,
    info: {
      icon: 'fa-light fa-lock',
      description: 'Only invited guests can join',
      color: lfxColors.amber[500],
    },
  },
];

/**
 * Meeting type color mappings
 * @description Maps meeting types to their associated colors, icons, and styling for UI display
 */
export const MEETING_TYPE_CONFIGS: Record<string, MeetingTypeConfig> = {
  technical: {
    label: 'Technical',
    bgColor: 'bg-violet-100',
    textColor: 'text-violet-600',
    textColorAlt: 'text-violet-500',
    borderColor: 'border-violet-500',
    borderColorLight: 'border-violet-300',
    icon: 'fa-light fa-code',
    tagStyleClass: 'tag-meeting-technical',
  },
  maintainers: {
    label: 'Maintainers',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-600',
    textColorAlt: 'text-blue-500',
    borderColor: 'border-blue-500',
    borderColorLight: 'border-blue-300',
    icon: 'fa-light fa-gear',
    tagStyleClass: 'tag-meeting-maintainers',
  },
  board: {
    label: 'Board',
    bgColor: 'bg-red-100',
    textColor: 'text-red-600',
    textColorAlt: 'text-red-500',
    borderColor: 'border-red-500',
    borderColorLight: 'border-red-300',
    icon: 'fa-light fa-user-check',
    tagStyleClass: 'tag-meeting-board',
  },
  marketing: {
    label: 'Marketing',
    bgColor: 'bg-emerald-100',
    textColor: 'text-emerald-600',
    textColorAlt: 'text-emerald-500',
    borderColor: 'border-emerald-500',
    borderColorLight: 'border-emerald-300',
    icon: 'fa-light fa-chart-line-up',
    tagStyleClass: 'tag-meeting-marketing',
  },
  legal: {
    label: 'Legal',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-600',
    textColorAlt: 'text-amber-500',
    borderColor: 'border-amber-500',
    borderColorLight: 'border-amber-300',
    icon: 'fa-light fa-scale-balanced',
    tagStyleClass: 'tag-meeting-legal',
  },
  other: {
    label: 'Other',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-600',
    textColorAlt: 'text-gray-500',
    borderColor: 'border-gray-500',
    borderColorLight: 'border-gray-300',
    icon: 'fa-light fa-calendar-days',
    tagStyleClass: 'tag-meeting-other',
  },
};

/**
 * Selectable meeting types, in composer order.
 * @description Drives the Details & Access type dropdown. Label and icon come from
 * `MEETING_TYPE_CONFIGS` so the dropdown never disagrees with the tag rendered on meeting cards;
 * `MeetingType.NONE` is deliberately absent because it is not a user-selectable value.
 */
export const MEETING_TYPE_OPTIONS: CardSelectorOption<MeetingType>[] = [
  {
    label: MEETING_TYPE_CONFIGS[MeetingType.BOARD.toLowerCase()].label,
    value: MeetingType.BOARD,
    info: {
      icon: MEETING_TYPE_CONFIGS[MeetingType.BOARD.toLowerCase()].icon,
      description: 'Governance meetings for project direction, funding, and strategic decisions',
      color: lfxColors.red[500],
    },
  },
  {
    label: MEETING_TYPE_CONFIGS[MeetingType.MAINTAINERS.toLowerCase()].label,
    value: MeetingType.MAINTAINERS,
    info: {
      icon: MEETING_TYPE_CONFIGS[MeetingType.MAINTAINERS.toLowerCase()].icon,
      description: 'Regular sync meetings for core maintainers to discuss project health',
      color: lfxColors.blue[500],
    },
  },
  {
    label: MEETING_TYPE_CONFIGS[MeetingType.MARKETING.toLowerCase()].label,
    value: MeetingType.MARKETING,
    info: {
      icon: MEETING_TYPE_CONFIGS[MeetingType.MARKETING.toLowerCase()].icon,
      description: 'Community growth, outreach, and marketing strategy meetings',
      color: lfxColors.emerald[500],
    },
  },
  {
    label: MEETING_TYPE_CONFIGS[MeetingType.TECHNICAL.toLowerCase()].label,
    value: MeetingType.TECHNICAL,
    info: {
      icon: MEETING_TYPE_CONFIGS[MeetingType.TECHNICAL.toLowerCase()].icon,
      description: 'Technical discussions, architecture decisions, and development planning',
      color: lfxColors.violet[500],
    },
  },
  {
    label: MEETING_TYPE_CONFIGS[MeetingType.LEGAL.toLowerCase()].label,
    value: MeetingType.LEGAL,
    info: {
      icon: MEETING_TYPE_CONFIGS[MeetingType.LEGAL.toLowerCase()].icon,
      description: 'Legal compliance, licensing, and policy discussions',
      color: lfxColors.amber[500],
    },
  },
  {
    label: MEETING_TYPE_CONFIGS[MeetingType.OTHER.toLowerCase()].label,
    value: MeetingType.OTHER,
    info: {
      icon: MEETING_TYPE_CONFIGS[MeetingType.OTHER.toLowerCase()].icon,
      description: "General project meetings that don't fit other categories",
      color: lfxColors.gray[500],
    },
  },
];

/** Meeting types a maintainer may create. */
export const MAINTAINER_MEETING_TYPES: readonly MeetingType[] = [MeetingType.MAINTAINERS, MeetingType.TECHNICAL, MeetingType.OTHER];

/**
 * Default meeting type configuration
 * @description Fallback configuration for unrecognized meeting types
 */
export const DEFAULT_MEETING_TYPE_CONFIG: MeetingTypeConfig = {
  label: 'Meeting',
  bgColor: 'bg-gray-100',
  textColor: 'text-gray-400',
  textColorAlt: 'text-gray-400',
  borderColor: 'border-gray-400',
  borderColorLight: 'border-gray-300',
  icon: 'fa-light fa-calendar-days',
  tagStyleClass: 'tag-meeting-other',
};

// ============================================================================
// Meeting Form Configuration Constants
// ============================================================================

/**
 * Sections of the meeting composer, in rail order.
 * @description `required` marks the sections that must be valid before the meeting can be saved.
 */
export const MEETING_COMPOSER_SECTIONS = [
  { id: 'details-access', label: 'Details & Access', icon: 'fa-light fa-circle-info', required: true },
  { id: 'date-schedule', label: 'Date & Schedule', icon: 'fa-light fa-calendar-days', required: true },
  { id: 'platform-features', label: 'Platform & Features', icon: 'fa-light fa-video', required: false },
  { id: 'guests', label: 'Guests', icon: 'fa-light fa-users', required: false },
  { id: 'agenda-resources', label: 'Agenda & Resources', icon: 'fa-light fa-list-check', required: false },
] as const;

/**
 * Feature rows the composer preview lists, in display order.
 * @description Only the labels are the preview's own — shorter wording than the section's toggle
 * titles. Controls and icons come from {@link MEETING_FEATURE_BY_KEY}, so renaming a feature key
 * breaks the build here rather than silently dropping the row.
 */
export const MEETING_COMPOSER_PREVIEW_FEATURES: MeetingComposerPreviewFeature[] = (
  [
    { control: 'recording_enabled', label: 'Recording' },
    { control: 'zoom_ai_enabled', label: 'AI meeting summary' },
    { control: 'transcript_enabled', label: 'Transcript' },
    { control: 'youtube_upload_enabled', label: 'Auto-upload to YouTube' },
  ] as const
).map(({ control, label }) => ({ control, label, icon: MEETING_FEATURE_BY_KEY[control].icon }));

/**
 * Default meeting duration in minutes
 * @description Standard meeting length when no custom duration is specified
 */
export const DEFAULT_DURATION = 60;

/**
 * Minimum early join time in minutes
 * @description Earliest time guests can join before the scheduled start
 */
export const MIN_EARLY_JOIN_TIME = 10;

/**
 * Maximum early join time in minutes
 * @description Latest time guests can join before the scheduled start
 */
export const MAX_EARLY_JOIN_TIME = 60;

/**
 * YouTube API maximum video title length
 * @description The YouTube Data API rejects titles longer than 100 characters
 */
export const YOUTUBE_MAX_TITLE_LENGTH = 100;

/**
 * Characters consumed by the date suffix appended to the YouTube video title
 * @description The upload handler appends " - DD/MM/YYYY" (13 chars) to the meeting title
 */
export const YOUTUBE_TITLE_DATE_SUFFIX_LENGTH = 13;

/**
 * Maximum meeting title length when YouTube uploads are enabled
 * @description Derived from the YouTube API limit minus the auto-appended date suffix.
 * A title exceeding this limit will cause an invalidTitle error on upload.
 */
export const YOUTUBE_MAX_MEETING_TITLE_LENGTH = YOUTUBE_MAX_TITLE_LENGTH - YOUTUBE_TITLE_DATE_SUFFIX_LENGTH;

/**
 * Title length at which the composer's YouTube counter turns amber
 * @description Warns while the title is still valid, so the user can trim it before hitting the limit.
 */
export const YOUTUBE_MEETING_TITLE_WARNING_LENGTH = Math.floor(YOUTUBE_MAX_MEETING_TITLE_LENGTH * 0.9);

/**
 * Default early join time in minutes
 * @description Standard early join window for new meetings
 */
export const DEFAULT_EARLY_JOIN_TIME = 10;

/**
 * Minimum reminder email lead time in hours
 * @description Earliest the automatic reminder email can be sent before the meeting starts
 */
export const MIN_EMAIL_REMINDER_HOURS = 2;

/**
 * Maximum reminder email lead time in hours
 * @description Latest the automatic reminder email can be sent before the meeting starts
 */
export const MAX_EMAIL_REMINDER_HOURS = 24;

/**
 * Default reminder email lead time in hours
 * @description Standard reminder window for meetings when the reminder is first enabled
 */
export const DEFAULT_EMAIL_REMINDER_HOURS = 24;

/**
 * Default reminder email lead time minutes component
 * @description Minutes component of the reminder window; forced to 0 when hours is 24
 */
export const DEFAULT_EMAIL_REMINDER_MINUTES = 0;

/**
 * Maximum reminder email lead time in total minutes
 * @description Upstream ITX limit for auto_email_reminder_time (24 hours)
 */
export const MAX_EMAIL_REMINDER_TIME = 1440;

/**
 * Tooltip text for the send reminder email feature
 * @description Explains the automatic reminder email behavior and its 2-24 hour window
 */
export const EMAIL_REMINDER_TOOLTIP =
  'Automatically send a reminder email to all participants before the meeting starts. ' +
  'You can set the reminder time between 2 and 24 hours before the meeting. When set to 24 hours, minutes are automatically set to 0.';

/**
 * Zoom API codes for weekdays (Monday through Friday)
 * @description String format used by Zoom API: '2,3,4,5,6' where 1=Sunday, 2=Monday, etc.
 */
export const WEEKDAY_CODES = '2,3,4,5,6';

/**
 * Time rounding interval in minutes
 * @description Meeting start times are rounded to the nearest 15-minute interval
 * @example 2:37 PM becomes 2:45 PM, 3:50 PM becomes 4:00 PM
 */
export const TIME_ROUNDING_MINUTES = 15;

/**
 * Default meeting platform
 * @description Primary platform used for hosting meetings
 */
export const DEFAULT_MEETING_TOOL = 'Zoom';

/**
 * Default artifact visibility level
 * @description Who can access meeting artifacts (recordings, transcripts, AI summaries) by default
 */
export const DEFAULT_ARTIFACT_VISIBILITY = 'meeting_participants';

/**
 * Default repeat interval for recurring meetings
 * @description How often recurring meetings repeat (1 = every occurrence)
 */
export const DEFAULT_REPEAT_INTERVAL = 1;

// ============================================================================
// Time Calculation Constants
// ============================================================================

/**
 * Number of hours in a day
 * @description Standard 24-hour day
 */
export const HOURS_IN_DAY = 24;

/**
 * Number of minutes in an hour
 * @description Standard 60-minute hour
 */
export const MINUTES_IN_HOUR = 60;

/**
 * Number of seconds in a minute
 * @description Standard 60-second minute
 */
export const SECONDS_IN_MINUTE = 60;

/**
 * Number of milliseconds in a second
 * @description Standard 1000ms = 1 second
 */
export const MS_IN_SECOND = 1000;

/**
 * Number of days in a week
 * @description Standard 7-day week
 */
export const DAYS_IN_WEEK = 7;

/**
 * Number of milliseconds in one day
 * @description Calculated as: 24 hours × 60 minutes × 60 seconds × 1000 milliseconds = 86,400,000 ms
 * @example Used for date arithmetic: `new Date(date.getTime() + MS_IN_DAY)` adds one day
 */
export const MS_IN_DAY = HOURS_IN_DAY * MINUTES_IN_HOUR * SECONDS_IN_MINUTE * MS_IN_SECOND;

// ============================================================================
// Form Validation and Navigation Constants
// ============================================================================

/**
 * Meeting form step indices
 * @description Zero-based step numbers for form navigation and validation
 * @readonly
 */
export const MEETING_FORM_STEPS = {
  /** Step 0: Select meeting type and basic settings */
  MEETING_TYPE: 0,
  /** Step 1: Configure meeting details (title, time, duration, etc.) */
  MEETING_DETAILS: 1,
  /** Step 2: Choose platform and enable features */
  PLATFORM_FEATURES: 2,
  /** Step 3: Add resources and review summary */
  RESOURCES_SUMMARY: 3,
  /** Step 4: Manage meeting guests and send invitations */
  MANAGE_GUESTS: 4,
};

/**
 * Recurrence type string mappings
 * @description Maps recurrence types to their string identifiers used in forms and API
 * @readonly
 */
export const RECURRENCE_MAPPINGS = {
  /** No recurrence - single meeting */
  NONE: 'none',
  /** Repeats every day */
  DAILY: 'daily',
  /** Repeats every week on the same day */
  WEEKLY: 'weekly',
  /** Repeats Monday through Friday only */
  WEEKDAYS: 'weekdays',
  /** Repeats monthly on the nth occurrence of the weekday */
  MONTHLY_NTH: 'monthly_nth',
  /** Repeats monthly on the last occurrence of the weekday */
  MONTHLY_LAST: 'monthly_last',
};

// ============================================================================
// Custom Recurrence Pattern Options
// ============================================================================

/**
 * Pattern type options for custom recurrence
 * @description Available recurrence patterns (daily, weekly, monthly)
 */
export const RECURRENCE_PATTERN_TYPE_OPTIONS = [
  { label: 'Days', value: 'daily' },
  { label: 'Weeks', value: 'weekly' },
  { label: 'Months', value: 'monthly' },
];

/**
 * End condition options for custom recurrence
 * @description How the recurring meetings should end
 */
export const RECURRENCE_END_TYPE_OPTIONS = [
  { label: 'Never', value: 'never' },
  { label: 'On date', value: 'date' },
  { label: 'After number of occurrences', value: 'occurrences' },
];

/**
 * Monthly recurrence type options
 * @description Whether to repeat by day of month or day of week
 */
export const RECURRENCE_MONTHLY_TYPE_OPTIONS = [
  { label: 'Day of month', value: 'dayOfMonth' },
  { label: 'Day of week', value: 'dayOfWeek' },
];

/**
 * Days of the week for recurrence selection
 * @description Complete list of weekdays with display labels and values
 */
export const RECURRENCE_DAYS_OF_WEEK = [
  { label: 'Sun', value: 0, fullLabel: 'Sunday' },
  { label: 'Mon', value: 1, fullLabel: 'Monday' },
  { label: 'Tue', value: 2, fullLabel: 'Tuesday' },
  { label: 'Wed', value: 3, fullLabel: 'Wednesday' },
  { label: 'Thu', value: 4, fullLabel: 'Thursday' },
  { label: 'Fri', value: 5, fullLabel: 'Friday' },
  { label: 'Sat', value: 6, fullLabel: 'Saturday' },
];

/**
 * Weekly ordinals for monthly recurrence patterns
 * @description Which occurrence of the weekday in the month (1st, 2nd, 3rd, 4th, last)
 */
export const RECURRENCE_WEEKLY_ORDINALS = [
  { label: '1st', value: 1 },
  { label: '2nd', value: 2 },
  { label: '3rd', value: 3 },
  { label: '4th', value: 4 },
  { label: 'Last', value: -1 },
];

// ============================================================================
// Feature Toggle Configurations
// ============================================================================

/**
 * Recurring meeting feature configuration
 * @description Feature toggle config for recurring meeting option
 */
export const RECURRING_MEETING_FEATURE = {
  key: 'isRecurring',
  icon: 'fa-light fa-repeat',
  title: 'Recurring Meeting',
  description: 'This meeting repeats on a schedule',
  recommended: false,
  color: lfxColors.blue[500],
};

/**
 * Send reminder email feature configuration
 * @description Feature toggle config for the automatic participant reminder email
 */
export const EMAIL_REMINDER_FEATURE = {
  key: 'auto_email_reminder_enabled',
  icon: 'fa-light fa-bell',
  title: 'Send reminder email to participants',
  description: 'Automatically send a reminder email to all participants before the meeting starts',
  recommended: false,
  color: lfxColors.amber[500],
};

/**
 * Restricted meeting feature configuration
 * @description Feature toggle config for restricted meeting access
 */
export const RESTRICTED_MEETING_FEATURE = {
  key: 'restricted',
  icon: 'fa-light fa-shield',
  title: 'Restricted Meeting',
  description: 'Restrict access to invited guests only',
  recommended: false,
  color: lfxColors.red[500],
};

/**
 * Show meeting attendees feature configuration
 * @description Feature toggle config for showing meeting attendees
 */
export const SHOW_MEETING_ATTENDEES_FEATURE = {
  key: 'show_meeting_attendees',
  icon: 'fa-light fa-users',
  title: 'Show Members on Meeting Details Page',
  description: 'Allow members to see who were invited to this meeting and who will be attending',
  recommended: false,
  color: lfxColors.blue[500],
};

// ============================================================================
// Meeting Duration Options
// ============================================================================

/** Character limit for the meeting agenda (`description`) */
export const MEETING_AGENDA_MAX_LENGTH = 2000;

/** Agenda length at which the character counter turns amber */
export const MEETING_AGENDA_WARNING_LENGTH = 1800;

/** Lower bound for the custom meeting duration, in minutes */
export const MIN_CUSTOM_DURATION = 5;

/** Upper bound for the custom meeting duration, in minutes */
export const MAX_CUSTOM_DURATION = 480;

/**
 * Duration chips for the meeting composer's Date & Schedule section
 * @description `custom` reveals the `customDuration` control; `MeetingComposerFormService` owns that
 * control's `MIN_CUSTOM_DURATION` / `MAX_CUSTOM_DURATION` validators.
 */
export const MEETING_DURATION_CHIP_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '90 min', value: 90 },
  { label: '2 hours', value: 120 },
  { label: 'Custom', value: 'custom' },
];

/**
 * Early-join chips for the meeting composer's Date & Schedule section
 * @description Every value sits inside [MIN_EARLY_JOIN_TIME, MAX_EARLY_JOIN_TIME], so picking a chip
 * can never put the control in an invalid state.
 */
export const EARLY_JOIN_CHIP_OPTIONS = [
  { label: '10 min', value: 10 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
];

/**
 * Tooltip text explaining the early-join window
 */
export const EARLY_JOIN_TOOLTIP = 'Allow guests to join the meeting early. Useful for informal networking before the official start time.';

// ============================================================================
// Template Re-exports
// ============================================================================

/**
 * Pre-defined meeting templates
 * @description Re-exported from meeting-templates/index.ts for convenient access
 */
export { MEETING_TEMPLATES } from './meeting-templates';

// ============================================================================
// Latest Past Meetings Fast-Path
// ============================================================================

/**
 * Over-fetch size for the "latest past meetings" fast-path (Me-lens dashboard card).
 * @description The `v1_past_meeting` index includes meetings as soon as they START (not when
 * they END), so rows at the top of `sort=name_desc` may be in-progress. The aggregator
 * over-fetches this many rows, drops ongoing meetings by filtering on each meeting's
 * effective end time (`scheduled_end_time` when present, otherwise start time + duration),
 * then slices down to `LATEST_PAST_MEETINGS_RETURN_LIMIT`. The buffer (FETCH - RETURN) bounds
 * the number of concurrently-ongoing meetings we tolerate near the head of the sort — if
 * more than that many are ongoing for a single user, we return fewer than the limit rather
 * than paginating full history.
 */
export const LATEST_PAST_MEETINGS_FETCH_SIZE = 10;

/**
 * Maximum rows returned by the "latest past meetings" fast-path after the ongoing-meeting
 * filter. Five is the row count surfaced by the dashboard Last Meeting / past-meetings card.
 */
export const LATEST_PAST_MEETINGS_RETURN_LIMIT = 5;

/**
 * Max concurrent per-meeting recording fetches for dashboard "Recordings Available" counts.
 */
export const MEETING_RECORDING_COUNT_FETCH_CONCURRENCY = 8;

/** Session cache TTL for past-meeting recording fetches; balances dedupe vs post-processing staleness. */
export const PAST_MEETING_RECORDING_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// Past Meeting Sort Values
// ============================================================================

/**
 * Query-service `sort` values for the `v1_past_meeting` resource type.
 * @description The meeting-service indexer populates `sort_name` with the meeting's RFC3339 UTC
 * `start_time` (not the literal meeting title), so `NAME_DESC` sorts most-recent-first.
 */
export const PAST_MEETING_SORT = {
  NAME_DESC: 'name_desc',
  NAME_ASC: 'name_asc',
  UPDATED_DESC: 'updated_desc',
  UPDATED_ASC: 'updated_asc',
} as const;

/**
 * The `AttachmentCategory` (`meeting-attachment.interface.ts`) value CommitteeActivityService's
 * notes_added leg treats as a note. A single source of truth for both the upstream `filters_all`
 * term-clause value and the client-side re-filter comparison — see fetchNotesAddedEvents's own
 * comment for why both need to agree on the exact same string (LFXV2-3077).
 */
export const NOTES_ATTACHMENT_CATEGORY: AttachmentCategory = 'Notes';
