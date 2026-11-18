// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Internal Snowflake query-row shapes for the Org Lens Events backend service.
// These mirror raw column names returned by the queries in org-lens-events.service.ts.
// They live in the shared package because AGENTS.md prohibits module-level interfaces
// inside apps/lfx-one/; they are not part of the public API surface consumed by the frontend.

import type { OrgLensRowOrganization } from './org-memberships.interface';

/** Row from ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENTS (platinum_lfx_one_org_events). */
export interface OrgEventRow {
  EVENT_ID: string;
  EVENT_NAME: string;
  FOUNDATION_NAME: string | null;
  EVENT_START_DATE: Date | string | null;
  EVENT_END_DATE: Date | string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  EVENT_URL: string | null;
  EVENT_REGISTRATION_URL: string | null;
  /** `ALL_COUNT_VERIFIED` / `REGISTERED_COUNT_VERIFIED` / `ATTENDED_COUNT_VERIFIED` of the picked participation, aliased. */
  ORG_ATTENDEE_COUNT: number;
  EVENT_REGISTRATIONS_GOAL: number | null;
  ORG_SPEAKER_ACCEPTED_COUNT: number;
  ORG_SPEAKER_SUBMITTED_COUNT: number;
  IS_ORG_SPONSOR: boolean;
  TOTAL_RECORDS: number;
}

/** One event of a family roll-up list: the event's own columns, and the organizations shown that took part in or sponsor it. */
export interface OrgFamilyEventRow extends OrgEventRow {
  /** Comma-separated account ids of the organizations shown that took part in the event; `null` or empty when none did. */
  ACTIVE_ACCOUNT_IDS: string | null;
  /** Comma-separated account ids of the organizations shown that sponsor the event; `null` or empty when none does. */
  SPONSOR_ACCOUNT_IDS: string | null;
}

/** One (person, organization) row of a family roll-up attendees drawer; `PERSON_KEY` is the same for one person across the family. */
export interface OrgFamilyEventAttendeeRow {
  PERSON_KEY: string;
  ACCOUNT_ID: string;
  DISPLAY_NAME: string | null;
  JOB_TITLE: string | null;
}

/** One (speaker, organization) row of a family roll-up speakers drawer. */
export interface OrgFamilyEventSpeakerRow extends OrgEventSpeakersDrawerRow {
  ACCOUNT_ID: string;
}

/** A family drawer row as the service reads it: one person or speaker `key` credited through one organization, name and title already made displayable. */
export interface OrgFamilyEventCreditRow {
  key: string;
  accountId: string;
  name: string | null;
  jobTitle: string | null;
}

/** One person or speaker of a family drawer, once, with every organization served they are credited through (alphabetical). */
export interface OrgFamilyEventPerson {
  key: string;
  name: string | null;
  jobTitle: string | null;
  organizations: OrgLensRowOrganization[];
}

/** Raw row returned by the org events summary (stat strip) Snowflake query. */
export interface OrgEventsSummaryRow {
  PAST_EVENTS: number;
  UPCOMING_EVENTS: number;
}

/** Per-event header read for the attendees drawer: the event's name and whether it has ended. */
export interface OrgEventDrawerHeaderRow {
  EVENT_NAME: string | null;
  IS_PAST_EVENT: boolean | null;
}

/** Raw row returned by the per-event attendees drawer query: one person the picked option credits to the organization, by name (title only for roster employees). */
export interface OrgEventAttendeesDrawerRow {
  PARTICIPANT_REF: number;
  DISPLAY_NAME: string | null;
  JOB_TITLE: string | null;
}

/** Raw row returned by the per-event speakers drawer Snowflake query. */
export interface OrgEventSpeakersDrawerRow {
  SPEAKER_ID: string;
  NAME: string | null;
  JOB_TITLE: string | null;
  IS_ACCEPTED: number;
  EVENT_NAME: string | null;
}

/** Person × event row from `ORG_EVENT_PARTICIPATION` (attendee predicate, ended events, range window); everyone credited is listed. */
export interface OrgEventParticipationRow {
  PARTICIPANT_REF: number;
  PERSON_KEY: string | null;
  DISPLAY_NAME: string | null;
  JOB_TITLE: string | null;
  EVENT_ID: string;
  EVENT_NAME: string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  EVENT_URL: string | null;
  EVENT_START_DATE: Date | string | null;
  EVENT_END_DATE: Date | string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  /** `true` when the person has an accepted talk Employee match credits to the organization (the speaker predicate). */
  IS_SPEAKER: boolean | null;
}

/** Row from `ORG_EVENT_PARTICIPATION_SUMMARY` for one (account, range, participation), Employee match only. */
export interface OrgEventParticipationSummaryRow {
  ATTENDEES_COUNT: number | null;
  SPEAKERS_COUNT: number | null;
  EVENTS_COUNT: number | null;
  FOUNDATIONS_COUNT: number | null;
}

/** Distinct `(FOUNDATION_ID, FOUNDATION_NAME)` row from the foundation-options query (event attendees). */
export interface EventAttendeeFoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

/** Distinct `(EVENT_ID, EVENT_NAME, EVENT_DATE)` row from the event-options query — `EVENT_DATE` carried for ORDER BY only, never read downstream. */
export interface EventAttendeeEventOptionRow {
  EVENT_ID: string;
  EVENT_NAME: string;
  EVENT_DATE: Date | string | null;
}

/** The raw reads behind one Event Attendees response. */
export interface EventAttendeesRaw {
  detailRows: OrgEventParticipationRow[];
  foundationRows: EventAttendeeFoundationOptionRow[];
  eventRows: EventAttendeeEventOptionRow[];
}

/** A metric column of `ORG_EVENT_PARTICIPATION_MONTHLY` the Overview reads: the Employee match (`VERIFIED`) columns only. */
export type OrgEventAttendanceMetricColumn = 'ATTENDEES_ALL_VERIFIED' | 'SPEAKERS_VERIFIED' | 'TOTAL_ATTENDEES_ALL_VERIFIED' | 'TOTAL_SPEAKERS_VERIFIED';

/** Row of `ORG_EVENT_PARTICIPATION_MONTHLY` (Overview Event Attendees / Event Speakers cards). */
export type OrgEventAttendanceMonthlyRow = Record<OrgEventAttendanceMetricColumn, number | null> & {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  MONTH_START_DATE: Date;
};
