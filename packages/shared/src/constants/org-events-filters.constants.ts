// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgEventAttendanceMetricColumn } from '../interfaces/org-events-internal.interface';
import type { OrgEventsParticipation, OrgEventsParticipationOption, OrgEventsScope, OrgEventsScopeOption } from '../interfaces/org-events-filters.interface';

// One set of Events filters for the Overview, People → Event Attendees and the Events page (lfx-self-serve#4598): the same
// options, defaults and URL parameters everywhere, so the same selection gives the same count on every page.

/** Caption phrase for the company-email count every Events surface shows: only registrations or speaker records made with a company email count. */
export const ORG_EVENTS_COMPANY_EMAIL_CAPTION_PHRASE = 'Counts only registrations and speaker records made with a company email.';

/** "Count" options, default first. */
export const ORG_EVENTS_PARTICIPATION_OPTIONS: readonly OrgEventsParticipationOption[] = [
  { label: 'All', value: 'all' },
  { label: 'Registered', value: 'registered' },
  { label: 'Attended', value: 'attended' },
] as const;

/** Default "Count" — the URL drops `?participation=` when it is active. The Overview is pinned to it. */
export const DEFAULT_ORG_EVENTS_PARTICIPATION: OrgEventsParticipation = 'all';

/** URL query parameter of the "Count" filter. */
export const ORG_EVENTS_PARTICIPATION_QUERY_PARAM = 'participation';

/** Accessible label of the "Count" filter. */
export const ORG_EVENTS_PARTICIPATION_LABEL = 'Count';

/** Tooltip on the "Count" filter, per option. */
export const ORG_EVENTS_PARTICIPATION_TOOLTIP: Readonly<Record<OrgEventsParticipation, string>> = {
  all: 'People who registered or attended, cancelled and denied registrations excluded.',
  registered: 'Everyone who registered, cancelled and denied registrations excluded.',
  attended: 'Only people marked as attended. Counts events that have ended.',
};

/** Phrase a caption or tooltip adds for the participation it counts. */
export const ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE: Readonly<Record<OrgEventsParticipation, string>> = {
  all: 'Registered or attended.',
  registered: 'Registered attendees.',
  attended: 'Attended, events that have ended.',
};

/** Status badge on each person row of the attendees drawer, per participation: with Count All a row is a person who registered or attended. */
export const ORG_EVENTS_PARTICIPATION_BADGE_LABEL: Readonly<Record<OrgEventsParticipation, string>> = {
  all: 'Registered or attended',
  registered: 'Registered',
  attended: 'Attended',
};

/** Tooltip on the disabled "Count" filter on the Upcoming tab, where no one has attended yet. */
export const ORG_EVENTS_PARTICIPATION_UPCOMING_NOTE = 'Upcoming events have no attendance yet; registrations are counted.';

/** "Show" options on the Events page, default first. */
export const ORG_EVENTS_SCOPE_OPTIONS: readonly OrgEventsScopeOption[] = [
  { label: 'My org’s activity', value: 'activity' },
  { label: 'All foundation events', value: 'all' },
] as const;

/** Default "Show" — the URL drops `?eventScope=` when it is active. */
export const DEFAULT_ORG_EVENTS_SCOPE: OrgEventsScope = 'activity';

/** URL query parameter of the "Show" filter. */
export const ORG_EVENTS_SCOPE_QUERY_PARAM = 'eventScope';

/** Accessible label of the "Show" filter. */
export const ORG_EVENTS_SCOPE_LABEL = 'Show';

/** URL query parameter of the foundation filter (a foundation id; absent is All Foundations). */
export const ORG_EVENTS_FOUNDATION_QUERY_PARAM = 'foundation';

/** Label of the foundation filter's "all" option. */
export const ORG_EVENTS_ALL_FOUNDATIONS_LABEL = 'All Foundations';

/** Label shown for a registrant who has no usable name; never an email address. */
export const ORG_EVENTS_NEUTRAL_REGISTRANT_LABEL = 'Registered attendee';

/** Label shown for a speaker who has no usable name; never an email address. */
export const ORG_EVENTS_NEUTRAL_SPEAKER_LABEL = 'Speaker';

/** Every Events read counts company-email registrations and speaker records only: its warehouse columns carry this suffix (`REGISTERED_COUNT_COMPANY_EMAIL`, `IS_COUNTED_ALL_COMPANY_EMAIL`, ...). Never built from user input. */
export const ORG_EVENTS_COUNTED_COLUMN_SUFFIX = 'COMPANY_EMAIL';

/** The `ATTRIBUTION` value of the company-email rows in the warehouse summary tables (`ORG_EVENT_PARTICIPATION_SUMMARY`); bound, never built from user input. */
export const ORG_EVENTS_COUNTED_ATTRIBUTION = 'company_email';

/** The one mapping from a participation to its segment of a warehouse column (`<SEGMENT>_COUNT_COMPANY_EMAIL`, `IS_COUNTED_<SEGMENT>_COMPANY_EMAIL`); never built from user input. */
export const ORG_EVENTS_PARTICIPATION_COLUMN_SEGMENT: Readonly<Record<OrgEventsParticipation, string>> = {
  all: 'ALL',
  registered: 'REGISTERED',
  attended: 'ATTENDED',
};

/**
 * The metric columns of `ORG_EVENT_PARTICIPATION_MONTHLY` the Overview selects: the company-email (`COMPANY_EMAIL`) columns, the
 * only ones Events count.
 */
export const ORG_EVENT_ATTENDANCE_METRIC_COLUMNS: readonly OrgEventAttendanceMetricColumn[] = [
  'ATTENDEES_ALL_COMPANY_EMAIL',
  'SPEAKERS_COMPANY_EMAIL',
  'TOTAL_ATTENDEES_ALL_COMPANY_EMAIL',
  'TOTAL_SPEAKERS_COMPANY_EMAIL',
] as const;

/** Longest foundation id the Events filters accept; ids are short opaque strings and the value is only ever bound, never inlined. */
export const ORG_EVENTS_FOUNDATION_ID_MAX_LENGTH = 128;
