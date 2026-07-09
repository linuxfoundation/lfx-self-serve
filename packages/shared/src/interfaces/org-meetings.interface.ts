// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OffsetPaginatedResponse } from './api.interface';

/** Tab identifier for the Org Meetings page tab strip. */
export type OrgMeetingsTabId = 'upcoming' | 'past';

/** Tab definition for the Org Meetings page. */
export interface OrgMeetingsTabConfig {
  readonly id: OrgMeetingsTabId;
  readonly label: string;
}

/** Meeting type for filtering. */
export type OrgMeetingType = 'board' | 'working-group' | 'other';

/** Privacy level of a meeting. */
export type OrgMeetingPrivacy = 'public' | 'private';

/** RSVP status for an individual invitee. */
export type OrgMeetingRsvpStatus = 'yes' | 'maybe' | 'no' | null;

/** Attendance result for a past meeting invitee. */
export type OrgMeetingAttendanceStatus = 'attended' | 'missed' | 'excused';

/** An individual invitee from the viewer's org on an upcoming meeting. */
export interface OrgMeetingInvitee {
  readonly name: string;
  readonly title: string;
  readonly avatarUrl: string | null;
  readonly rsvpStatus: OrgMeetingRsvpStatus;
}

/** An individual invitee from the viewer's org on a past meeting, with attendance. */
export interface OrgPastMeetingInvitee {
  readonly name: string;
  readonly title: string;
  readonly avatarUrl: string | null;
  readonly attendanceStatus: OrgMeetingAttendanceStatus;
}

/** Post-meeting artifacts. */
export interface OrgMeetingArtifact {
  readonly recordingUrl: string | null;
  readonly transcriptUrl: string | null;
  readonly aiSummaryId: string | null;
}

/** RSVP tally across all invitees. */
export interface OrgMeetingRsvpTally {
  readonly yes: number;
  readonly maybe: number;
  readonly no: number;
  readonly noResponse: number;
}

/** Attendance tally for a past meeting. */
export interface OrgMeetingAttendanceTally {
  readonly attended: number;
  readonly missed: number;
  readonly excused: number;
}

/** Status flags indicating which features are enabled for this meeting/series. */
export interface OrgMeetingStatusFlags {
  readonly recording: boolean;
  readonly transcripts: boolean;
  readonly aiSummary: boolean;
}

/** Fields shared by both upcoming and past meetings. */
export interface OrgMeetingBase {
  readonly id: string;
  readonly title: string;
  readonly privacy: OrgMeetingPrivacy;
  readonly type: OrgMeetingType;
  readonly recurrenceLabel: string | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly foundation: string;
  readonly orgName: string;
  readonly project: string;
  readonly agenda: string | null;
  readonly resources: readonly string[];
}

/** An upcoming meeting in the Org Lens Meetings list. */
export interface OrgMeeting extends OrgMeetingBase {
  readonly rsvpTally: OrgMeetingRsvpTally;
  readonly orgInvitees: readonly OrgMeetingInvitee[];
  readonly guestCount: number;
  readonly joinUrl: string | null;
  readonly statusFlags: OrgMeetingStatusFlags;
}

/** RSVP badge label + style for an invitee row. */
export interface OrgMeetingRsvpBadge {
  readonly label: string;
  readonly badgeClass: string;
}

/** Org invitee with its RSVP badge pre-derived (avoids method calls in the template). */
export interface OrgMeetingInviteeVm extends OrgMeetingInvitee {
  readonly badge: OrgMeetingRsvpBadge;
}

/** Upcoming meeting with presentation fields pre-baked for template rendering (avoids method calls in the `@for`). */
export interface OrgMeetingVm extends OrgMeeting {
  readonly linkUrl: string;
  readonly totalInvited: number;
  readonly attendingPercent: number;
  readonly yesPercent: number;
  readonly maybePercent: number;
  readonly noPercent: number;
  readonly inviteeVms: readonly OrgMeetingInviteeVm[];
}

/** A past meeting in the Org Lens Meetings list. */
export interface OrgPastMeeting extends OrgMeetingBase {
  readonly attendanceTally: OrgMeetingAttendanceTally;
  readonly artifact: OrgMeetingArtifact;
  readonly minutesUploaded: boolean;
  readonly orgPastInvitees: readonly OrgPastMeetingInvitee[];
}

/** Summary counts for the Org Meetings stat strip (Snowflake ORG_UPCOMING_MEETINGS; nextMeeting is ISO or null; foundation counts drive "Across N"). */
export interface OrgMeetingsSummary {
  readonly upcomingMeetings: number;
  readonly recurringSeries: number;
  readonly recurringFoundations: number;
  readonly nextMeeting: string | null;
}

/** Server-side filter/pagination options for the Org Lens Upcoming Meetings list. */
export interface GetOrgUpcomingMeetingsOptions {
  readonly searchQuery: string | null;
  readonly project: string | null;
  readonly type: OrgMeetingType | null;
  readonly pendingRsvpOnly: boolean;
  readonly pageSize: number;
  readonly offset: number;
}

/** Paginated response for the Org Lens Upcoming Meetings list. */
export type OrgUpcomingMeetingsResponse = OffsetPaginatedResponse<OrgMeeting>;

/** Distinct foundation/project names the selected org has upcoming meetings in (Project filter options). */
export interface OrgMeetingsProjectsResponse {
  readonly projects: readonly string[];
}
