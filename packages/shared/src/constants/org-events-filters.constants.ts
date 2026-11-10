// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgEventAttendanceMetricColumn } from '../interfaces/org-events-internal.interface';
import type {
  OrgEventsAttribution,
  OrgEventsAttributionColumnSuffix,
  OrgEventsAttributionOption,
  OrgEventsParticipation,
  OrgEventsParticipationOption,
  OrgEventsScope,
  OrgEventsScopeOption,
} from '../interfaces/org-events-filters.interface';

// One set of Events filters for the Overview, People → Event Attendees and the Events page (lfx-self-serve#4598): the same
// options, defaults and URL parameters everywhere, so the same selection gives the same count on every page.

/** "Counted by" options, default first. */
export const ORG_EVENTS_ATTRIBUTION_OPTIONS: readonly OrgEventsAttributionOption[] = [
  { label: 'Employee match', value: 'verified' },
  { label: 'Self-reported only', value: 'self_reported' },
  { label: 'All', value: 'all' },
] as const;

/**
 * Default "Counted by" — the URL drops `?attribution=` when it is active. The Overview is pinned to it. People linked
 * only through the organization they named on their registration or talk submission are a weak relationship and are not
 * counted by default (lfx-self-serve#5158); Self-reported only lists them alone and All adds them (lfx-self-serve#5315).
 */
export const DEFAULT_ORG_EVENTS_ATTRIBUTION: OrgEventsAttribution = 'verified';

/** URL query parameter of the "Counted by" filter. */
export const ORG_EVENTS_ATTRIBUTION_QUERY_PARAM = 'attribution';

/** Accessible label of the "Counted by" filter. */
export const ORG_EVENTS_ATTRIBUTION_LABEL = 'Counted by';

/** Tooltip on the "Counted by" filter, per option. */
export const ORG_EVENTS_ATTRIBUTION_TOOLTIP: Readonly<Record<OrgEventsAttribution, string>> = {
  verified: 'Registered or spoke with a company email address on record, or their LF account matches someone on the company roster.',
  self_reported: 'Linked only because they named the company on their registration or talk submission.',
  all: 'Everyone linked to the company, including people who only named it on their registration or talk submission.',
};

/** Phrase a caption or tooltip adds for the attribution it counts. */
export const ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE: Readonly<Record<OrgEventsAttribution, string>> = {
  verified: 'Company email on record or LF account on the company roster.',
  self_reported: 'Linked only because they named the company on their registration or talk submission.',
  all: 'Everyone linked to the company, including people who only named it on their registration or talk submission.',
};

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

/** The one mapping from an attribution to its warehouse column suffix; every Events read derives its column identifiers from it, never from user input. */
export const ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX: Readonly<Record<OrgEventsAttribution, OrgEventsAttributionColumnSuffix>> = {
  verified: 'VERIFIED',
  self_reported: 'SELF_REPORTED',
  all: 'ALL',
};

/** The one mapping from a participation to its segment of a warehouse column (`<SEGMENT>_COUNT_<ATTRIBUTION>`, `IS_COUNTED_<SEGMENT>_<ATTRIBUTION>`); never built from user input. */
export const ORG_EVENTS_PARTICIPATION_COLUMN_SEGMENT: Readonly<Record<OrgEventsParticipation, string>> = {
  all: 'ALL',
  registered: 'REGISTERED',
  attended: 'ATTENDED',
};

/**
 * The metric columns of `ORG_EVENT_PARTICIPATION_MONTHLY` the Overview selects: only those of the default attribution, which
 * the Overview is pinned to (the monthly table has no Self-reported only columns).
 */
export const ORG_EVENT_ATTENDANCE_METRIC_COLUMNS: readonly OrgEventAttendanceMetricColumn[] = [
  'ATTENDEES_ALL_VERIFIED',
  'SPEAKERS_VERIFIED',
  'TOTAL_ATTENDEES_ALL_VERIFIED',
  'TOTAL_SPEAKERS_VERIFIED',
] as const;

/** Longest foundation id the Events filters accept; ids are short opaque strings and the value is only ever bound, never inlined. */
export const ORG_EVENTS_FOUNDATION_ID_MAX_LENGTH = 128;
