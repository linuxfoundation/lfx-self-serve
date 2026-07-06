// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterOption, OrgMeetingRsvpStatus, OrgMeetingsTabConfig, OrgMeetingsTabId, OrgMeetingType, OrgPastMeeting } from '../interfaces';

/** Org Meetings page tabs in visible order (`upcoming` is the default). */
export const ORG_MEETINGS_TABS: readonly OrgMeetingsTabConfig[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
] as const;

/** Default tab — URL drops `?tab=` when active to keep deep links clean. */
export const DEFAULT_ORG_MEETINGS_TAB_ID: OrgMeetingsTabId = 'upcoming';

/** Derived from ORG_MEETINGS_TABS; used to validate `?tab=` query-param input. */
export const VALID_ORG_MEETINGS_TAB_IDS: ReadonlySet<OrgMeetingsTabId> = new Set(ORG_MEETINGS_TABS.map((t) => t.id));

/** Default / max page size for the server-paginated Upcoming meetings list. */
export const DEFAULT_MEETINGS_PAGE_SIZE = 10;
export const MAX_MEETINGS_PAGE_SIZE = 100;

/** Valid meeting-type filter values for server-side validation. */
export const VALID_ORG_MEETING_TYPE_VALUES: ReadonlySet<OrgMeetingType> = new Set<OrgMeetingType>(['board', 'working-group', 'other']);

/** KPI: recordings available from past 30 days (demo). */
export const ORG_MEETINGS_KPI_RECORDINGS_COUNT = 3;

/** RSVP badge label/style per status, for the Org Meetings upcoming invitee list. */
export const ORG_MEETINGS_RSVP_BADGES: Record<Exclude<OrgMeetingRsvpStatus, null>, { label: string; badgeClass: string }> = {
  yes: { label: 'Accepted', badgeClass: 'bg-emerald-50 text-emerald-600' },
  maybe: { label: 'Tentative', badgeClass: 'bg-amber-50 text-amber-600' },
  no: { label: 'Declined', badgeClass: 'bg-red-50 text-red-600' },
};

/** RSVP badge shown when an invitee has not responded. */
export const ORG_MEETINGS_NO_RESPONSE_BADGE = { label: 'No Response', badgeClass: 'bg-gray-100 text-gray-500' };

/** Type filter options for the Org Meetings filter bar. */
export const ORG_MEETINGS_TYPE_OPTIONS: FilterOption<OrgMeetingType | null>[] = [
  { label: 'All Types', value: null },
  { label: 'Board', value: 'board' },
  { label: 'Working Group', value: 'working-group' },
  { label: 'Other', value: 'other' },
];

/**
 * Builds a demo meeting's start/end ISO timestamps relative to the current time, so the
 * Upcoming/Past demo data (and the e2e assertions that depend on it) stay valid indefinitely
 * instead of drifting into the wrong tab as hardcoded absolute dates elapse.
 */
function demoMeetingTimes(offsetDays: number, hour: number, minute: number, durationMinutes: number): { startTime: string; endTime: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + offsetDays);
  start.setUTCHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

/** Demo past meetings (3 records). */
export const DEMO_PAST_MEETINGS: readonly OrgPastMeeting[] = [
  {
    id: 'pm-1',
    title: 'CNCF Governing Board',
    privacy: 'private',
    type: 'board',
    recurrenceLabel: 'Every week on Thu',
    ...demoMeetingTimes(-6, 17, 0, 60),
    foundation: 'Cloud Native Computing Foundation',
    orgName: 'CoreOS',
    project: 'CNCF',
    agenda: 'Q2 financial review. Project graduation vote. Open source strategy alignment.',
    resources: ['Q2 Financial Summary.pdf', 'Project Graduation Proposal.pdf'],
    attendanceTally: { attended: 10, missed: 2, excused: 1 },
    artifact: {
      recordingUrl: 'https://lfx.dev/recordings/demo-cncf-board-jun26',
      transcriptUrl: 'https://lfx.dev/transcripts/demo-cncf-board-jun26',
      aiSummaryId: 'ai-sum-pm-1',
    },
    minutesUploaded: true,
    orgPastInvitees: [
      { name: 'Sarah Chen', title: 'VP Engineering', avatarUrl: null, attendanceStatus: 'attended' },
      { name: 'Marcus Williams', title: 'CTO', avatarUrl: null, attendanceStatus: 'attended' },
      { name: 'Priya Sharma', title: 'Director of Open Source', avatarUrl: null, attendanceStatus: 'excused' },
    ],
  },
  {
    id: 'pm-2',
    title: 'Kubernetes SIG Docs',
    privacy: 'public',
    type: 'working-group',
    recurrenceLabel: 'Every 2 weeks on Tue',
    ...demoMeetingTimes(-22, 16, 0, 60),
    foundation: 'Cloud Native Computing Foundation',
    orgName: 'CoreOS',
    project: 'Kubernetes',
    agenda: 'Documentation sprint planning. Review PR backlog. Localization status updates.',
    resources: ['Docs Sprint Board.pdf'],
    attendanceTally: { attended: 16, missed: 5, excused: 2 },
    artifact: {
      recordingUrl: null,
      transcriptUrl: 'https://lfx.dev/transcripts/demo-sig-docs-jun10',
      aiSummaryId: null,
    },
    minutesUploaded: false,
    orgPastInvitees: [{ name: 'Aisha Johnson', title: 'Security Architect', avatarUrl: null, attendanceStatus: 'attended' }],
  },
  {
    id: 'pm-3',
    title: 'OpenSSF Board Meeting',
    privacy: 'private',
    type: 'board',
    recurrenceLabel: 'Every month on the 1st Fri',
    ...demoMeetingTimes(-33, 15, 0, 90),
    foundation: 'Open Source Security Foundation',
    orgName: 'CoreOS',
    project: 'OpenSSF',
    agenda: 'Alpha-Omega initiative review. Membership renewal pipeline. Security scorecard adoption metrics.',
    resources: [],
    attendanceTally: { attended: 8, missed: 3, excused: 0 },
    artifact: { recordingUrl: null, transcriptUrl: null, aiSummaryId: null },
    minutesUploaded: false,
    orgPastInvitees: [
      { name: 'Sarah Chen', title: 'VP Engineering', avatarUrl: null, attendanceStatus: 'attended' },
      { name: 'Marcus Williams', title: 'CTO', avatarUrl: null, attendanceStatus: 'missed' },
    ],
  },
];
