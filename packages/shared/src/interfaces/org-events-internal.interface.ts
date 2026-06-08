// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Internal Snowflake query-row shapes for the Org Lens Events backend service.
// These mirror raw column names returned by the queries in org-lens-events.service.ts.
// They live in the shared package because CLAUDE.md prohibits module-level interfaces
// inside apps/lfx-one/; they are not part of the public API surface consumed by the frontend.

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
  ORG_REGISTRATION_COUNT: number;
  EVENT_REGISTRATIONS_GOAL: number | null;
  ORG_SPEAKER_ACCEPTED_COUNT: number;
  ORG_SPEAKER_SUBMITTED_COUNT: number;
  IS_ORG_SPONSOR: boolean;
  TOTAL_RECORDS: number;
}

/** Raw row returned by the org events summary (stat strip) Snowflake query. */
export interface OrgEventsSummaryRow {
  TOTAL_EVENTS: number;
  PAST_EVENTS: number;
  UPCOMING_EVENTS: number;
}

/** Raw row returned by the per-event attendees drawer Snowflake query. */
export interface OrgEventAttendeesDrawerRow {
  CONTACT_ID: string;
  NAME: string | null;
  JOB_TITLE: string | null;
  EVENT_NAME: string | null;
}

/** Raw row returned by the per-event speakers drawer Snowflake query. */
export interface OrgEventSpeakersDrawerRow {
  CONTACT_ID: string;
  NAME: string | null;
  JOB_TITLE: string | null;
  IS_ACCEPTED: number;
  EVENT_NAME: string | null;
}
