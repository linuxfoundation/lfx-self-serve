// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ArtifactVisibility } from '../enums';

/**
 * Available meeting platforms and their configurations
 * @description Defines the supported platforms for hosting meetings
 */
export const MEETING_PLATFORMS = [
  {
    value: 'zoom',
    label: 'Zoom',
    description: 'Video conferencing with recording and chat features',
    available: true,
    icon: 'fa-light fa-video',
    color: '#0094FF',
  },
  {
    value: 'teams',
    label: 'Microsoft Teams',
    description: 'Integrated collaboration with Office 365',
    available: false,
    icon: 'fa-light fa-desktop',
    color: '#6b7280',
  },
  {
    value: 'in-person',
    label: 'In-Person',
    description: 'Physical meeting location',
    available: false,
    icon: 'fa-light fa-location-dot',
    color: '#6b7280',
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
    color: '#3b82f6', // blue - matches bg-blue-50 text-blue-700
  },
  {
    key: 'transcript_enabled',
    icon: 'fa-light fa-file-lines',
    title: 'Generate Transcripts',
    description: 'Automatically create searchable text transcripts',
    recommended: false,
    color: '#8b5cf6', // purple - matches bg-purple-50 text-purple-700
  },
  {
    key: 'youtube_upload_enabled',
    icon: 'fa-light fa-upload',
    title: 'YouTube Auto-upload',
    description: "Automatically publish recordings to your project's YouTube channel",
    recommended: false,
    color: '#dc2626', // red - matches bg-red-50 text-red-700
  },
  {
    key: 'zoom_ai_enabled',
    icon: 'fa-light fa-microchip-ai',
    title: 'AI Meeting Summary',
    description: 'Generate key takeaways and action items automatically',
    recommended: true,
    color: '#16a34a', // green - matches bg-green-50 text-green-700
  },
  {
    key: 'visibility',
    icon: 'fa-light fa-calendar-check',
    title: 'Show in Public Calendar',
    description: 'Make this meeting visible in the public project calendar',
    recommended: true,
    color: '#ea580c', // orange - unique color for calendar visibility
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
  { label: 'Meeting Participants', value: ArtifactVisibility.MEETING_PARTICIPANTS },
  { label: 'Public', value: ArtifactVisibility.PUBLIC },
];

// ============================================================================
// Meeting Form Configuration Constants
// ============================================================================

/**
 * Step titles for the meeting creation/edit stepper
 * @description Array of human-readable titles for each step in the meeting form
 */
export const MEETING_STEP_TITLES = ['Meeting Type', 'Meeting Details', 'Platform & Features', 'Resources & Summary'];

/**
 * Total number of steps in the meeting form
 * @description Must match the length of MEETING_STEP_TITLES array
 * @example 4 steps: Meeting Type → Details → Platform → Resources
 */
export const TOTAL_STEPS = 4;

/**
 * Default meeting duration in minutes
 * @description Standard meeting length when no custom duration is specified
 */
export const DEFAULT_DURATION = 60;

/**
 * Minimum early join time in minutes
 * @description Earliest time participants can join before the scheduled start
 */
export const MIN_EARLY_JOIN_TIME = 10;

/**
 * Maximum early join time in minutes
 * @description Latest time participants can join before the scheduled start
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
export const DEFAULT_MEETING_TOOL = 'zoom';

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
// Template Re-exports
// ============================================================================

/**
 * Pre-defined meeting templates
 * @description Re-exported from meeting-templates/index.ts for convenient access
 */
export { MEETING_TEMPLATES } from './meeting-templates';
