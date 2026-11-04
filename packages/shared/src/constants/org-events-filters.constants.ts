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
  { label: 'Company email', value: 'company_email' },
  { label: 'Account on registration', value: 'account' },
  { label: 'All relations', value: 'all' },
] as const;

/** Default "Counted by" — the URL drops `?attribution=` when it is active. The Overview is pinned to it. */
export const DEFAULT_ORG_EVENTS_ATTRIBUTION: OrgEventsAttribution = 'company_email';

/** URL query parameter of the "Counted by" filter. */
export const ORG_EVENTS_ATTRIBUTION_QUERY_PARAM = 'attribution';

/** Accessible label of the "Counted by" filter. */
export const ORG_EVENTS_ATTRIBUTION_LABEL = 'Counted by';

/** Tooltip on the "Counted by" filter, per option. */
export const ORG_EVENTS_ATTRIBUTION_TOOLTIP: Readonly<Record<OrgEventsAttribution, string>> = {
  company_email: 'People who registered with one of the company’s own email addresses.',
  account:
    'Registrations credited to the company’s account, whatever address was used. People are counted, not listed, unless they also used a company address or are current employees.',
  all: 'Everyone related to the company: company-email registrations, registrations credited to the account, and current employees. People are counted, not listed, unless they used a company address or are current employees.',
};

/** Phrase a caption or tooltip adds for the attribution it counts. */
export const ORG_EVENTS_ATTRIBUTION_CAPTION_PHRASE: Readonly<Record<OrgEventsAttribution, string>> = {
  company_email: 'Registered with a company email.',
  account: 'Registrations credited to the company account.',
  all: 'Everyone related to the company.',
};

/**
 * Note shown while Company email is picked but the company has no company-email data: the read serves Account on
 * registration instead, so the numbers are not zero.
 */
export const ORG_EVENTS_ATTRIBUTION_UNAVAILABLE_NOTE = 'No company-email data is available for this company; counts use registrations credited to the account.';

/** "Count" options, default first. */
export const ORG_EVENTS_PARTICIPATION_OPTIONS: readonly OrgEventsParticipationOption[] = [
  { label: 'Registered', value: 'registered' },
  { label: 'Attended', value: 'attended' },
] as const;

/** Default "Count" — the URL drops `?participation=` when it is active. The Overview is pinned to it. */
export const DEFAULT_ORG_EVENTS_PARTICIPATION: OrgEventsParticipation = 'registered';

/** URL query parameter of the "Count" filter. */
export const ORG_EVENTS_PARTICIPATION_QUERY_PARAM = 'participation';

/** Accessible label of the "Count" filter. */
export const ORG_EVENTS_PARTICIPATION_LABEL = 'Count';

/** Tooltip on the "Count" filter, per option. */
export const ORG_EVENTS_PARTICIPATION_TOOLTIP: Readonly<Record<OrgEventsParticipation, string>> = {
  registered: 'Everyone who registered, cancelled and denied registrations excluded.',
  attended: 'Only people marked as attended. Counts events that have ended.',
};

/** Phrase a caption or tooltip adds for the participation it counts. */
export const ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE: Readonly<Record<OrgEventsParticipation, string>> = {
  registered: 'Registered attendees.',
  attended: 'Attended, events that have ended.',
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
  company_email: 'COMPANY_EMAIL',
  account: 'ACCOUNT',
  all: 'ALL',
};

/** The per-attribution metric columns of `ORG_EVENT_PARTICIPATION_MONTHLY` the Overview selects. */
export const ORG_EVENT_ATTENDANCE_METRIC_COLUMNS: readonly OrgEventAttendanceMetricColumn[] = Object.values(ORG_EVENTS_ATTRIBUTION_COLUMN_SUFFIX).flatMap(
  (suffix) => [
    `ATTENDEES_REGISTERED_${suffix}` as const,
    `SPEAKERS_${suffix}` as const,
    `TOTAL_ATTENDEES_REGISTERED_${suffix}` as const,
    `TOTAL_SPEAKERS_${suffix}` as const,
  ]
);

/** Longest foundation id the Events filters accept; ids are short opaque strings and the value is only ever bound, never inlined. */
export const ORG_EVENTS_FOUNDATION_ID_MAX_LENGTH = 128;
