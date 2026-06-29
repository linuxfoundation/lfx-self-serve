// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Tab identifier for the Org Meetings page tab strip. */
export type OrgMeetingsTabId = 'upcoming' | 'past' | 'pending';

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

/** An upcoming meeting in the Org Lens Meetings list. */
export interface OrgMeeting {
  readonly id: string;
  readonly title: string;
  readonly privacy: OrgMeetingPrivacy;
  readonly type: OrgMeetingType;
  readonly recurrenceLabel: string | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly foundation: string;
  readonly project: string;
  readonly agenda: string | null;
  readonly resources: readonly string[];
  readonly rsvpTally: OrgMeetingRsvpTally;
  readonly orgInvitees: readonly OrgMeetingInvitee[];
  readonly guestCount: number;
  readonly joinUrl: string | null;
  readonly statusFlags: OrgMeetingStatusFlags;
}

/** A past meeting in the Org Lens Meetings list. */
export interface OrgPastMeeting extends OrgMeeting {
  readonly attendanceTally: OrgMeetingAttendanceTally;
  readonly artifact: OrgMeetingArtifact;
  readonly minutesUploaded: boolean;
  readonly orgPastInvitees: readonly OrgPastMeetingInvitee[];
}

/** A pending-RSVP meeting row — subset of OrgMeeting fields needed for the RSVP flow. */
export type OrgPendingRsvpMeeting = Pick<
  OrgMeeting,
  'id' | 'title' | 'privacy' | 'type' | 'recurrenceLabel' | 'startTime' | 'endTime' | 'foundation' | 'project' | 'agenda'
>;

/** Payload emitted when a user clicks an RSVP button. */
export interface OrgMeetingRsvpChangeEvent {
  readonly meetingId: string;
  readonly status: 'yes' | 'maybe' | 'no';
}
