// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingHomeAttendance, MeetingHomeAttendanceCount, MeetingHomeRow, PastMeeting } from '../interfaces';

/**
 * The organizer attendance block of a meetings home row or card.
 * @description Upcoming dates count RSVPs, past meetings count participants. The feeds attach the counts only to meetings the
 * viewer organizes, so a row without them, or with no invitees, gets null and shows no block.
 */
export function getMeetingHomeAttendance(row: MeetingHomeRow, past: boolean): MeetingHomeAttendance | null {
  if (past) {
    // Past rows carry the past-meetings feed's records.
    const summary = (row.meeting as PastMeeting).attendance_summary;
    if (!summary || summary.invited <= 0) return null;
    const percent = Math.round((summary.attended / summary.invited) * 100);
    const label = `${summary.attended} of ${summary.invited} attended · ${percent}%`;
    return {
      label,
      ariaLabel: label,
      segments: summary.attended > 0 ? [{ kind: 'attended', percent: (summary.attended / summary.invited) * 100 }] : [],
      answers: [],
      noResponse: null,
      poor: percent < 50,
    };
  }

  const summary = row.occurrence ? row.occurrence.rsvp_summary : row.meeting.rsvp_summary;
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
