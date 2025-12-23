// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ArtifactVisibility } from '../enums';
import { TagSeverity } from '../interfaces';
import { lfxColors } from './colors.constants';

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
 * Available meeting features that can be enabled/disabled
 * @description Feature toggles for recording, transcripts, AI features, etc.
 */
export const MEETING_FEATURES = [
  {
    key: 'recording_enabled',
    icon: 'fa-light fa-video',
    title: 'Enable Recording',
    description: 'Record the meeting for those who cannot attend live',
    recommended: true,
    color: lfxColors.blue[500],
  },
  {
    key: 'zoom_ai_enabled',
    icon: 'fa-light fa-microchip-ai',
    title: 'AI Meeting Summary',
    description: 'Generate key takeaways and action items automatically',
    recommended: true,
    color: lfxColors.emerald[500],
  },
  {
    key: 'transcript_enabled',
    icon: 'fa-light fa-file-lines',
    title: 'Generate Transcripts',
    description: 'Automatically create searchable text transcripts',
    recommended: false,
    color: lfxColors.violet[500],
  },
  {
    key: 'youtube_upload_enabled',
    icon: 'fa-light fa-upload',
    title: 'YouTube Auto-upload',
    description: "Automatically publish recordings to your project's YouTube channel",
    recommended: false,
    color: lfxColors.red[500],
  },
  {
    key: 'visibility',
    icon: 'fa-light fa-calendar-check',
    title: 'Show in Public Calendar',
    description: 'Make this meeting visible in the public project calendar',
    recommended: true,
    color: lfxColors.amber[500],
    trueValue: 'public',
    falseValue: 'private',
  },
];

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
 * Meeting type color configuration
 * @description Defines colors, icons, and styling for meeting type badges and borders
 */
export interface MeetingTypeConfig {
  /** Display label for the meeting type */
  label: string;
  /** Background color class (e.g., bg-purple-100) */
  bgColor: string;
  /** Text color class - 600 shade (e.g., text-purple-600) */
  textColor: string;
  /** Text color class - 500 shade (e.g., text-purple-500) for alternate styling */
  textColorAlt: string;
  /** Border color class - 500 shade (e.g., border-purple-500) */
  borderColor: string;
  /** Border color class - 300 shade (e.g., border-purple-300) for lighter borders */
  borderColorLight: string;
  /** Font Awesome icon class */
  icon: string;
}

/**
 * Meeting type badge interface
 * @description Structure for meeting type badge display
 */
export interface MeetingTypeBadge {
  label: string;
  className: string;
  severity?: TagSeverity;
  icon?: string;
}

/**
 * Meeting type color mappings
 * @description Maps meeting types to their associated colors, icons, and styling for UI display
 */
export const MEETING_TYPE_CONFIGS: Record<string, MeetingTypeConfig> = {
  technical: {
    label: 'Technical',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-600',
    textColorAlt: 'text-purple-500',
    borderColor: 'border-purple-500',
    borderColorLight: 'border-purple-300',
    icon: 'fa-light fa-code',
  },
  maintainers: {
    label: 'Maintainers',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-600',
    textColorAlt: 'text-blue-500',
    borderColor: 'border-blue-500',
    borderColorLight: 'border-blue-300',
    icon: 'fa-light fa-gear',
  },
  board: {
    label: 'Board',
    bgColor: 'bg-red-100',
    textColor: 'text-red-600',
    textColorAlt: 'text-red-500',
    borderColor: 'border-red-500',
    borderColorLight: 'border-red-300',
    icon: 'fa-light fa-user-check',
  },
  marketing: {
    label: 'Marketing',
    bgColor: 'bg-green-100',
    textColor: 'text-green-600',
    textColorAlt: 'text-green-500',
    borderColor: 'border-green-500',
    borderColorLight: 'border-green-300',
    icon: 'fa-light fa-chart-line-up',
  },
  legal: {
    label: 'Legal',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-600',
    textColorAlt: 'text-amber-500',
    borderColor: 'border-amber-500',
    borderColorLight: 'border-amber-300',
    icon: 'fa-light fa-scale-balanced',
  },
  other: {
    label: 'Other',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-600',
    textColorAlt: 'text-gray-500',
    borderColor: 'border-gray-500',
    borderColorLight: 'border-gray-300',
    icon: 'fa-light fa-calendar-days',
  },
};

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
};

// ============================================================================
// Meeting Form Configuration Constants
// ============================================================================

/**
 * Step titles for the meeting creation/edit stepper
 * @description Array of human-readable titles for each step in the meeting form
 */
export const MEETING_STEP_TITLES = ['Meeting Type', 'Meeting Details', 'Platform & Features', 'Resources & Summary', 'Manage Guests'];

/**
 * Total number of steps in the meeting form
 * @description Must match the length of MEETING_STEP_TITLES array
 * @example 5 steps: Meeting Type → Details → Platform → Resources → Guests
 */
export const TOTAL_STEPS = MEETING_STEP_TITLES.length;

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
 * Default early join time in minutes
 * @description Standard early join window for new meetings
 */
export const DEFAULT_EARLY_JOIN_TIME = 10;

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
 * Default meeting type when none is selected
 * @description Fallback value for meeting type field
 */
export const DEFAULT_MEETING_TYPE = 'None';

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

/**
 * Scroll offset in pixels for stepper navigation
 * @description Distance to offset when auto-scrolling to stepper component
 */
export const STEPPER_SCROLL_OFFSET = 50;

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

/**
 * Meeting duration options for dropdown
 * @description Standard duration options with custom option
 */
export const MEETING_DURATION_OPTIONS = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '60 minutes', value: 60 },
  { label: '90 minutes', value: 90 },
  { label: '120 minutes', value: 120 },
  { label: 'Custom...', value: 'custom' },
];

// ============================================================================
// Template Re-exports
// ============================================================================

/**
 * Pre-defined meeting templates
 * @description Re-exported from meeting-templates/index.ts for convenient access
 */
export { MEETING_TEMPLATES } from './meeting-templates';
