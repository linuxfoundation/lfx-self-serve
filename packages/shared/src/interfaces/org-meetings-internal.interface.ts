// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Raw row returned by the org meetings summary (stat strip) Snowflake query. */
export interface OrgMeetingsSummaryRow {
  UPCOMING_MEETINGS: number;
  RECURRING_SERIES: number;
  RECURRING_FOUNDATIONS: number;
  NEXT_MEETING: string | null;
}

/** Raw row from ANALYTICS.PLATINUM_LFX_ONE.ORG_UPCOMING_MEETINGS (page query). */
export interface OrgUpcomingMeetingRow {
  MEETING_ID: string;
  TOPIC: string;
  AGENDA: string | null;
  VISIBILITY: string | null;
  MEETING_TYPE_BUCKET: string | null;
  RECURRENCE_LABEL: string | null;
  NEXT_OCCURRENCE_UTC_TS: string | null;
  MEETING_DURATION: number | null;
  FOUNDATION_NAME: string | null;
  RECORDING_ENABLED: boolean;
  TRANSCRIPT_ENABLED: boolean;
  AI_SUMMARY_ENABLED: boolean;
  ATTENDING_COUNT: number;
  MAYBE_COUNT: number;
  NO_COUNT: number;
  NO_RESPONSE_COUNT: number;
  GUEST_COUNT: number;
  TOTAL_RECORDS: number;
}

/** Raw row from ANALYTICS.PLATINUM_LFX_ONE.ORG_UPCOMING_MEETING_INVITEES (invitee query). */
export interface OrgUpcomingMeetingInviteeRow {
  MEETING_ID: string;
  FULL_NAME: string;
  JOB_TITLE: string | null;
  AVATAR_URL: string | null;
  RSVP_STATUS: string;
}

/** Raw row from the distinct org meeting projects (facets) query. */
export interface OrgMeetingProjectRow {
  PROJECT_NAME: string;
}
