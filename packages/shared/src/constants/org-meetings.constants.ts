// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterOption } from '../interfaces';
import type {
  OrgMeeting,
  OrgMeetingsTabConfig,
  OrgMeetingsTabId,
  OrgPastMeeting,
  OrgPendingRsvpMeeting,
} from '../interfaces/org-meetings.interface';

/** Org Meetings page tabs in visible order (`upcoming` is the default). */
export const ORG_MEETINGS_TABS: readonly OrgMeetingsTabConfig[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'pending', label: 'Pending RSVP' },
] as const;

/** Default tab — URL drops `?tab=` when active to keep deep links clean. */
export const DEFAULT_ORG_MEETINGS_TAB_ID: OrgMeetingsTabId = 'upcoming';

/** Derived from ORG_MEETINGS_TABS; used to validate `?tab=` query-param input. */
export const VALID_ORG_MEETINGS_TAB_IDS: ReadonlySet<OrgMeetingsTabId> = new Set(ORG_MEETINGS_TABS.map((t) => t.id));

/** KPI: total upcoming meetings count (demo). */
export const ORG_MEETINGS_KPI_UPCOMING_COUNT = 12;

/** KPI: recurring series count (demo). */
export const ORG_MEETINGS_KPI_RECURRING_COUNT = 4;

/** KPI: next meeting label (demo). */
export const ORG_MEETINGS_KPI_NEXT_MEETING = 'Jul 3, 2026 · 10:00 AM PT';

/** KPI: recurring series project span (demo). */
export const ORG_MEETINGS_KPI_RECURRING_PROJECTS = 3;

/** Project filter options for the Org Meetings filter bar (demo). */
export const ORG_MEETINGS_PROJECT_OPTIONS: FilterOption[] = [
  { label: 'All Projects', value: null },
  { label: 'CNCF', value: 'CNCF' },
  { label: 'Kubernetes', value: 'Kubernetes' },
  { label: 'LF AI & Data Foundation', value: 'LF AI & Data Foundation' },
  { label: 'OpenSSF', value: 'OpenSSF' },
  { label: 'Security TAG', value: 'Security TAG' },
  { label: 'TOC', value: 'TOC' },
];

/** Type filter options for the Org Meetings filter bar. */
export const ORG_MEETINGS_TYPE_OPTIONS: FilterOption[] = [
  { label: 'All Types', value: null },
  { label: 'Board', value: 'board' },
  { label: 'Working Group', value: 'working-group' },
  { label: 'Other', value: 'other' },
];

/** Valid meeting type values for server-side validation. */
export const VALID_ORG_MEETING_TYPE_VALUES: ReadonlySet<string> = new Set(['board', 'working-group', 'other']);

/** Demo upcoming meetings (3 records). */
export const DEMO_UPCOMING_MEETINGS: readonly OrgMeeting[] = [
  {
    id: 'um-1',
    title: 'CNCF Governing Board',
    privacy: 'private',
    type: 'board',
    recurrenceLabel: 'Every week on Thu',
    startTime: '2026-06-30T01:54:00.000Z',
    endTime: '2026-06-30T02:54:00.000Z',
    foundation: 'Cloud Native Computing Foundation',
    project: 'CNCF',
    agenda:
      'Review Q3 budget proposal. Approve new project sandbox applications. Open floor for governing board motions.',
    resources: ['Q3 Budget Proposal.pdf', 'Board Meeting Agenda.docx'],
    rsvpTally: { yes: 12, maybe: 2, no: 1, noResponse: 3 },
    orgInvitees: [
      { name: 'Sarah Chen', title: 'VP Engineering', avatarUrl: null, rsvpStatus: 'yes' },
      { name: 'Marcus Williams', title: 'CTO', avatarUrl: null, rsvpStatus: 'yes' },
      { name: 'Priya Sharma', title: 'Director of Open Source', avatarUrl: null, rsvpStatus: 'maybe' },
    ],
    guestCount: 8,
    joinUrl: 'https://zoom.us/j/demo-cncf-board',
    statusFlags: { recording: true, transcripts: true, aiSummary: true },
  },
  {
    id: 'um-2',
    title: 'Security TAG Monthly',
    privacy: 'public',
    type: 'working-group',
    recurrenceLabel: 'Every month on the 3rd Wed',
    startTime: new Date('2026-07-15T17:00:00Z').toISOString(),
    endTime: new Date('2026-07-15T18:00:00Z').toISOString(),
    foundation: 'Cloud Native Computing Foundation',
    project: 'Security TAG',
    agenda: 'Security posture review. Vulnerability disclosure process update. New TAG member introductions.',
    resources: ['Security TAG Charter.pdf'],
    rsvpTally: { yes: 22, maybe: 5, no: 2, noResponse: 8 },
    orgInvitees: [
      { name: 'Marcus Williams', title: 'CTO', avatarUrl: null, rsvpStatus: 'yes' },
      { name: 'Aisha Johnson', title: 'Security Architect', avatarUrl: null, rsvpStatus: null },
    ],
    guestCount: 15,
    joinUrl: 'https://zoom.us/j/demo-security-tag',
    statusFlags: { recording: true, transcripts: false, aiSummary: false },
  },
  {
    id: 'um-3',
    title: 'LF AI & Data Summit Planning',
    privacy: 'public',
    type: 'other',
    recurrenceLabel: null,
    startTime: new Date('2026-08-01T15:00:00Z').toISOString(),
    endTime: new Date('2026-08-01T16:30:00Z').toISOString(),
    foundation: 'LF AI & Data',
    project: 'LF AI & Data Foundation',
    agenda: 'Summit logistics. Keynote speaker lineup. Sponsorship tier discussion.',
    resources: [],
    rsvpTally: { yes: 6, maybe: 1, no: 0, noResponse: 2 },
    orgInvitees: [
      { name: 'Sarah Chen', title: 'VP Engineering', avatarUrl: null, rsvpStatus: 'yes' },
    ],
    guestCount: 4,
    joinUrl: 'https://zoom.us/j/demo-lfai-summit',
    statusFlags: { recording: false, transcripts: false, aiSummary: false },
  },
];

/** Demo past meetings (3 records). */
export const DEMO_PAST_MEETINGS: readonly OrgPastMeeting[] = [
  {
    id: 'pm-1',
    title: 'CNCF Governing Board',
    privacy: 'private',
    type: 'board',
    recurrenceLabel: 'Every week on Thu',
    startTime: new Date('2026-06-26T17:00:00Z').toISOString(),
    endTime: new Date('2026-06-26T18:00:00Z').toISOString(),
    foundation: 'Cloud Native Computing Foundation',
    project: 'CNCF',
    agenda: 'Q2 financial review. Project graduation vote. Open source strategy alignment.',
    resources: ['Q2 Financial Summary.pdf', 'Project Graduation Proposal.pdf'],
    rsvpTally: { yes: 14, maybe: 1, no: 0, noResponse: 3 },
    orgInvitees: [
      { name: 'Sarah Chen', title: 'VP Engineering', avatarUrl: null, rsvpStatus: 'yes' },
      { name: 'Marcus Williams', title: 'CTO', avatarUrl: null, rsvpStatus: 'yes' },
      { name: 'Priya Sharma', title: 'Director of Open Source', avatarUrl: null, rsvpStatus: 'yes' },
    ],
    guestCount: 9,
    joinUrl: null,
    statusFlags: { recording: true, transcripts: true, aiSummary: true },
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
    startTime: new Date('2026-06-10T16:00:00Z').toISOString(),
    endTime: new Date('2026-06-10T17:00:00Z').toISOString(),
    foundation: 'Cloud Native Computing Foundation',
    project: 'Kubernetes',
    agenda: 'Documentation sprint planning. Review PR backlog. Localization status updates.',
    resources: ['Docs Sprint Board.pdf'],
    rsvpTally: { yes: 18, maybe: 3, no: 2, noResponse: 5 },
    orgInvitees: [
      { name: 'Aisha Johnson', title: 'Security Architect', avatarUrl: null, rsvpStatus: 'yes' },
    ],
    guestCount: 12,
    joinUrl: null,
    statusFlags: { recording: false, transcripts: true, aiSummary: false },
    attendanceTally: { attended: 16, missed: 5, excused: 2 },
    artifact: {
      recordingUrl: null,
      transcriptUrl: 'https://lfx.dev/transcripts/demo-sig-docs-jun10',
      aiSummaryId: null,
    },
    minutesUploaded: false,
    orgPastInvitees: [
      { name: 'Aisha Johnson', title: 'Security Architect', avatarUrl: null, attendanceStatus: 'attended' },
    ],
  },
  {
    id: 'pm-3',
    title: 'OpenSSF Board Meeting',
    privacy: 'private',
    type: 'board',
    recurrenceLabel: 'Every month on the 1st Fri',
    startTime: new Date('2026-05-30T15:00:00Z').toISOString(),
    endTime: new Date('2026-05-30T16:30:00Z').toISOString(),
    foundation: 'Open Source Security Foundation',
    project: 'OpenSSF',
    agenda: 'Alpha-Omega initiative review. Membership renewal pipeline. Security scorecard adoption metrics.',
    resources: [],
    rsvpTally: { yes: 10, maybe: 0, no: 1, noResponse: 2 },
    orgInvitees: [
      { name: 'Sarah Chen', title: 'VP Engineering', avatarUrl: null, rsvpStatus: 'yes' },
      { name: 'Marcus Williams', title: 'CTO', avatarUrl: null, rsvpStatus: 'yes' },
    ],
    guestCount: 6,
    joinUrl: null,
    statusFlags: { recording: false, transcripts: false, aiSummary: false },
    attendanceTally: { attended: 8, missed: 3, excused: 0 },
    artifact: { recordingUrl: null, transcriptUrl: null, aiSummaryId: null },
    minutesUploaded: false,
    orgPastInvitees: [
      { name: 'Sarah Chen', title: 'VP Engineering', avatarUrl: null, attendanceStatus: 'attended' },
      { name: 'Marcus Williams', title: 'CTO', avatarUrl: null, attendanceStatus: 'missed' },
    ],
  },
];

/** Demo pending-RSVP meetings (2 records). */
export const DEMO_PENDING_RSVP_MEETINGS: readonly OrgPendingRsvpMeeting[] = [
  {
    id: 'pr-1',
    title: 'CNCF TOC Meeting',
    privacy: 'public',
    type: 'working-group',
    recurrenceLabel: 'Every 2 weeks on Sat',
    startTime: new Date('2026-07-05T15:00:00Z').toISOString(),
    endTime: new Date('2026-07-05T16:00:00Z').toISOString(),
    foundation: 'Cloud Native Computing Foundation',
    project: 'TOC',
    agenda: 'Project lifecycle updates. Sandbox application review. TOC elections discussion.',
  },
  {
    id: 'pr-2',
    title: 'Security TAG Monthly',
    privacy: 'public',
    type: 'working-group',
    recurrenceLabel: 'Every month on the 3rd Wed',
    startTime: new Date('2026-07-15T17:00:00Z').toISOString(),
    endTime: new Date('2026-07-15T18:00:00Z').toISOString(),
    foundation: 'Cloud Native Computing Foundation',
    project: 'Security TAG',
    agenda: 'Security posture review. Vulnerability disclosure process update.',
  },
];
