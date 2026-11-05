// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Synthetic feeds for the Me lens meetings home page specs, dated against a fixed clock. */

import { RecurrenceType } from '@lfx-one/shared/enums';
import type { Meeting, MeetingOccurrence, MeetingRsvp, PastMeeting, PastMeetingRecording, PastMeetingSummary } from '@lfx-one/shared/interfaces';

/** Wednesday morning: every day bucket below is relative to this instant in UTC. */
export const MEETINGS_HOME_NOW = new Date('2026-11-04T09:00:00Z');

export const MEETINGS_HOME_PROJECT = { uid: 'p0000000-0000-0000-0000-000000004883', slug: 'synthetic-meetings-home', name: 'Synthetic Meetings Home' };

export const MEETINGS_HOME_IDS = {
  next: 'home-e2e-next',
  oneOff: 'home-e2e-one-off',
  series: 'home-e2e-series',
  other: 'home-e2e-other',
  pastRecent: 'home-e2e-past-recent',
  pastOlder: 'home-e2e-past-older',
  ended: 'home-e2e-ended',
} as const;

export const MEETINGS_HOME_TITLES = {
  next: 'Platform Sync',
  oneOff: 'Budget Review',
  series: 'Community Call',
  other: 'Marketing Standup',
  pastRecent: 'Release Retro',
  pastOlder: 'Project Kickoff',
  ended: 'Design Review',
} as const;

/** Variations of the upcoming feed; the defaults give the five rows described on {@link buildMeetingsHomeUpcoming}. */
export interface MeetingsHomeFeedOptions {
  /** The viewer organizes every upcoming meeting, which offers Edit and Delete. */
  organizer?: boolean;
  /** Alpha and Omega are foundations and Beta Project is Alpha's child, for the Foundation filter. */
  foundations?: boolean;
  /** Adds a meeting that ended 30 minutes ago, so its row is still inside its join window. */
  joinWindow?: boolean;
  /** Adds this many uninvited one-off meetings from November 20, one a day, for paging. */
  extraCount?: number;
}

export const MEETINGS_HOME_JOIN_URL = 'https://zoom.example.test/j/4883';
export const MEETINGS_HOME_RECORDING_URL = 'https://zoom.example.test/rec/share/4883';
export const MEETINGS_HOME_SUMMARY_TEXT = 'The release shipped on time and the team agreed on the next milestones.';

const PROJECT_A = { project_uid: 'proj-e2e-alpha', project_name: 'Alpha Foundation' };
const PROJECT_B = { project_uid: 'proj-e2e-beta', project_name: 'Beta Project' };
const OMEGA_FOUNDATION = { project_uid: 'proj-e2e-omega', project_name: 'Omega Foundation', is_foundation: true };

function occurrence(start: string, duration: number): MeetingOccurrence {
  return { occurrence_id: String(Date.parse(start) / 1000), start_time: start, duration };
}

/** The viewer's RSVP as the feed and the write acknowledgement carry it. */
export function meetingsHomeRsvp(meetingId: string, response: MeetingRsvp['response_type'], scope: MeetingRsvp['scope'] = 'all'): MeetingRsvp {
  return {
    id: `rsvp-${meetingId}`,
    meeting_id: meetingId,
    registrant_id: `reg-${meetingId}`,
    username: 'e2e-viewer',
    email: 'viewer-e2e@example.com',
    response_type: response,
    scope,
    created_at: MEETINGS_HOME_NOW.toISOString(),
  };
}

function meeting(id: string, title: string, start: string, extra: Partial<Meeting>): Partial<Meeting> {
  return {
    id,
    title,
    description: title,
    start_time: start,
    duration: 60,
    timezone: 'UTC',
    visibility: null,
    restricted: false,
    committees: [],
    occurrences: [],
    recurrence: null,
    organizers: [],
    password: null,
    invited: false,
    is_invite_responses_enabled: false,
    ...PROJECT_A,
    ...extra,
  };
}

/** Invited, with a registration, so the RSVP controls can answer it. */
function invited(id: string, myRsvp: MeetingRsvp | null): Partial<Meeting> {
  return { invited: true, is_invite_responses_enabled: true, my_rsvp: myRsvp, my_registrant_ids: [`reg-${id}`] };
}

/**
 * Five upcoming rows: the Next card (today, answered), a pending one-off tomorrow, a pending weekly series
 * with two dates (this week, this month) and an uninvited meeting in December. `answers` overlays saved RSVPs.
 */
export function buildMeetingsHomeUpcoming(answers: ReadonlyMap<string, MeetingRsvp> = new Map(), options: MeetingsHomeFeedOptions = {}): Partial<Meeting>[] {
  const { next, oneOff, series, other } = MEETINGS_HOME_IDS;
  const meetings = [
    meeting(next, MEETINGS_HOME_TITLES.next, '2026-11-04T15:00:00Z', { meeting_type: 'Board', ...invited(next, meetingsHomeRsvp(next, 'accepted')) }),
    meeting(oneOff, MEETINGS_HOME_TITLES.oneOff, '2026-11-05T16:00:00Z', {
      meeting_type: 'Board',
      committees: [{ uid: 'c-e2e-board', name: 'Governing Board' }],
      ...invited(oneOff, answers.get(oneOff) ?? null),
    }),
    meeting(series, MEETINGS_HOME_TITLES.series, '2026-11-06T17:00:00Z', {
      meeting_type: 'Technical',
      duration: 30,
      recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '6' },
      occurrences: [occurrence('2026-11-06T17:00:00Z', 30), occurrence('2026-11-13T17:00:00Z', 30)],
      ...invited(series, answers.get(series) ?? null),
      ...(options.foundations ? OMEGA_FOUNDATION : {}),
    }),
    meeting(other, MEETINGS_HOME_TITLES.other, '2026-12-02T14:00:00Z', {
      meeting_type: 'Marketing',
      ...PROJECT_B,
      ...(options.foundations ? { parent_project_uid: PROJECT_A.project_uid } : {}),
    }),
  ];
  if (options.joinWindow) {
    meetings.push(meeting(MEETINGS_HOME_IDS.ended, MEETINGS_HOME_TITLES.ended, '2026-11-04T08:00:00Z', { meeting_type: 'Technical', duration: 30 }));
  }
  for (let index = 0; index < (options.extraCount ?? 0); index++) {
    const start = new Date(Date.UTC(2026, 10, 20 + index, 14)).toISOString();
    meetings.push(meeting(`home-e2e-extra-${index + 1}`, `Working Group ${index + 1}`, start, { meeting_type: 'Technical' }));
  }
  return meetings.map((item) => ({
    ...item,
    ...(options.organizer ? { organizer: true, project_slug: MEETINGS_HOME_PROJECT.slug } : {}),
    ...(options.foundations && item.project_uid === PROJECT_A.project_uid ? { is_foundation: true } : {}),
  }));
}

function pastMeeting(id: string, title: string, start: string): Partial<PastMeeting> {
  return { ...meeting(id, title, start, { meeting_type: 'Board' }), scheduled_start_time: start, meeting_and_occurrence_id: id };
}

/** Two past rows: yesterday, with a recording and an AI summary, and last month. The most recent is also the Last meeting card. */
export function buildMeetingsHomePast(): Partial<PastMeeting>[] {
  return [
    {
      ...pastMeeting(MEETINGS_HOME_IDS.pastRecent, MEETINGS_HOME_TITLES.pastRecent, '2026-11-03T15:00:00Z'),
      has_recording: true,
      recording_share_url: MEETINGS_HOME_RECORDING_URL,
      has_ai_summary: true,
    },
    pastMeeting(MEETINGS_HOME_IDS.pastOlder, MEETINGS_HOME_TITLES.pastOlder, '2026-10-20T15:00:00Z'),
  ];
}

export function meetingsHomeRecording(pastMeetingId: string): Partial<PastMeetingRecording> {
  return {
    uid: `rec-${pastMeetingId}`,
    past_meeting_id: pastMeetingId,
    sessions: [{ uuid: 'session-1', start_time: '2026-11-03T15:00:00Z', share_url: MEETINGS_HOME_RECORDING_URL, total_size: 1024 }],
  };
}

/** An approved summary, so every viewer may read it. */
export function meetingsHomeSummary(pastMeetingId: string): Partial<PastMeetingSummary> {
  return {
    uid: `sum-${pastMeetingId}`,
    past_meeting_id: pastMeetingId,
    approved: true,
    requires_approval: false,
    summary_data: { title: 'Summary', content: MEETINGS_HOME_SUMMARY_TEXT, edited_content: '', doc_url: '', start_time: '', end_time: '' },
  };
}
