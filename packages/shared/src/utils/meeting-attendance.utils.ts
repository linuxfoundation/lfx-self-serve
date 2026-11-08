// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MeetingHomeAttendance,
  MeetingHomeAttendanceCount,
  MeetingHomeRow,
  MeetingRsvpSummary,
  PastMeeting,
  PastMeetingAttendanceSummary,
} from '../interfaces';
import { countRegistrantAttendance } from './rsvp-calculator.util';

/**
 * The organizer attendance block of a meetings home row or card.
 * @description Upcoming dates count RSVPs, past meetings count participants. The feeds attach the counts only to meetings the
 * viewer organizes, so a row without them, or with no invitees, gets null and shows no block.
 */
export function getMeetingHomeAttendance(row: MeetingHomeRow, past: boolean): MeetingHomeAttendance | null {
  // Past rows carry the past-meetings feed's records.
  if (past) return getPastMeetingAttendance((row.meeting as PastMeeting).attendance_summary);
  return getMeetingRsvpAttendance(row.occurrence ? row.occurrence.rsvp_summary : row.meeting.rsvp_summary);
}

/**
 * "X of Y attending" with a Yes / Maybe / No bar for one upcoming date; null without counts or invitees.
 */
export function getMeetingRsvpAttendance(summary: MeetingRsvpSummary | null | undefined): MeetingHomeAttendance | null {
  if (!summary || summary.invited <= 0) return null;
  const { invited } = summary;
  const answers: MeetingHomeAttendanceCount[] = [
    { kind: 'yes', label: 'Yes', count: summary.yes },
    { kind: 'maybe', label: 'Maybe', count: summary.maybe },
    { kind: 'no', label: 'No', count: summary.no },
  ];
  return {
    label: `${summary.yes} of ${invited} attending · ${Math.round((summary.yes / invited) * 100)}%`,
    ariaLabel: [...answers.map((answer) => `${answer.label} ${answer.count}`), `No response ${summary.no_response}`].join(', '),
    segments: answers.filter((answer) => answer.count > 0).map((answer) => ({ kind: answer.kind, percent: (answer.count / invited) * 100 })),
    answers,
    noResponse: summary.no_response,
    poor: false,
  };
}

/**
 * "X of Y attended" for a past meeting, where Y counts every participant record, as the meeting page does; null without any.
 * @description `withAbsent` also lists the attended and absent counts under the bar.
 */
export function getPastMeetingAttendance(
  summary: PastMeetingAttendanceSummary | null | undefined,
  options: { withAbsent?: boolean } = {}
): MeetingHomeAttendance | null {
  if (!summary || summary.invited <= 0) return null;
  const percent = Math.round((summary.attended / summary.invited) * 100);
  const label = `${summary.attended} of ${summary.invited} attended · ${percent}%`;
  const absent = Math.max(0, summary.invited - summary.attended);
  const poor = percent < 50;
  const attendedKind = poor ? 'attendedPoor' : 'attended';
  return {
    label,
    ariaLabel: options.withAbsent ? `${label}, ${absent} absent` : label,
    segments: summary.attended > 0 ? [{ kind: attendedKind, percent: (summary.attended / summary.invited) * 100 }] : [],
    answers: options.withAbsent
      ? [
          { kind: attendedKind, label: 'Attended', count: summary.attended },
          { kind: 'absent', label: 'Absent', count: absent },
        ]
      : [],
    noResponse: null,
    poor,
  };
}

/** Tallies one date's guest responses from registrants that carry the RSVP that applies to it. */
export function countMeetingRsvpSummary(registrants: Parameters<typeof countRegistrantAttendance>[0]): MeetingRsvpSummary {
  const counts = countRegistrantAttendance(registrants, { inviteResponsesEnabled: true });
  return {
    invited: counts.total,
    yes: counts.accepted,
    maybe: counts.maybe,
    no: counts.declined,
    no_response: counts.total - counts.accepted - counts.maybe - counts.declined,
  };
}
