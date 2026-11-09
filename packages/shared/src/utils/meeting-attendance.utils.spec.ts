// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MeetingVisibility } from '../enums';
import { MeetingHomeRow, MeetingOccurrence, PastMeeting } from '../interfaces';
import { countMeetingRsvpSummary, getMeetingHomeAttendance, getPastMeetingAttendance } from './meeting-attendance.utils';

const START = '2026-11-10T15:00:00Z';

function buildMeeting(overrides: Partial<PastMeeting> = {}): PastMeeting {
  return {
    id: 'synthetic-meeting',
    created_at: '',
    modified_at: '',
    project_uid: 'p-1',
    project_name: 'Project One',
    start_time: START,
    duration: 30,
    timezone: 'UTC',
    title: 'Synthetic sync',
    description: '',
    recurrence: null,
    committees: [],
    meeting_type: 'Technical',
    visibility: MeetingVisibility.PUBLIC,
    restricted: false,
    recording_enabled: null,
    transcript_enabled: null,
    youtube_upload_enabled: null,
    artifact_visibility: null,
    cancel_on_committee_removal: null,
    organizers: [],
    password: null,
    invited: true,
    occurrences: [],
    scheduled_start_time: START,
    scheduled_end_time: START,
    meeting_id: 'synthetic-meeting',
    occurrence_id: '',
    platform_meeting_id: '',
    sessions: [],
    ...overrides,
  };
}

function buildOccurrence(overrides: Partial<MeetingOccurrence> = {}): MeetingOccurrence {
  return { occurrence_id: 'synthetic-occurrence', start_time: START, duration: 30, ...overrides };
}

function row(meeting: Partial<PastMeeting>, occurrence: MeetingOccurrence | null = null): MeetingHomeRow {
  return {
    key: 'synthetic-meeting',
    meeting: buildMeeting(meeting),
    occurrence,
    title: 'Synthetic sync',
    occurrenceId: occurrence?.occurrence_id ?? null,
    startTime: START,
    durationMinutes: 30,
  };
}

describe('getMeetingHomeAttendance', () => {
  it('counts the RSVPs of an upcoming date, dropping empty segments from the bar', () => {
    const attendance = getMeetingHomeAttendance(row({ rsvp_summary: { invited: 16, yes: 12, maybe: 0, no: 1, no_response: 3 } }), false);

    expect(attendance).toEqual({
      label: '12 of 16 attending · 75%',
      ariaLabel: 'Yes 12, Maybe 0, No 1, No response 3',
      segments: [
        { kind: 'yes', percent: 75 },
        { kind: 'no', percent: 6.25 },
      ],
      answers: [
        { kind: 'yes', label: 'Yes', count: 12 },
        { kind: 'maybe', label: 'Maybe', count: 0 },
        { kind: 'no', label: 'No', count: 1 },
      ],
      noResponse: 3,
      poor: false,
    });
  });

  it("reads the occurrence's counts on a series row, not the meeting's", () => {
    const attendance = getMeetingHomeAttendance(
      row(
        { rsvp_summary: { invited: 9, yes: 9, maybe: 0, no: 0, no_response: 0 } },
        buildOccurrence({ rsvp_summary: { invited: 4, yes: 1, maybe: 1, no: 1, no_response: 1 } })
      ),
      false
    );

    expect(attendance?.label).toBe('1 of 4 attending · 25%');
    expect(getMeetingHomeAttendance(row({ rsvp_summary: { invited: 4, yes: 4, maybe: 0, no: 0, no_response: 0 } }, buildOccurrence()), false)).toBeNull();
  });

  it.each([
    [9, 20, '9 of 20 attended · 45%', true],
    [10, 20, '10 of 20 attended · 50%', false],
  ])('counts %s of %s participants of a past meeting', (attended, invited, label, poor) => {
    const attendance = getMeetingHomeAttendance(row({ attendance_summary: { invited, attended } }), true);

    expect(attendance).toEqual({
      label,
      ariaLabel: label,
      segments: [{ kind: poor ? 'attendedPoor' : 'attended', percent: (attended / invited) * 100 }],
      answers: [],
      noResponse: null,
      poor,
    });
  });

  it('leaves an empty bar for a past meeting nobody attended', () => {
    expect(getMeetingHomeAttendance(row({ attendance_summary: { invited: 3, attended: 0 } }), true)?.segments).toEqual([]);
  });

  it.each([
    ['upcoming without counts', row({}), false],
    ['upcoming with no invitees', row({ rsvp_summary: { invited: 0, yes: 0, maybe: 0, no: 0, no_response: 0 } }), false],
    ['past without counts', row({}), true],
    ['past with no participants', row({ attendance_summary: { invited: 0, attended: 0 } }), true],
  ])('returns null for %s', (_name, meetingRow, past) => {
    expect(getMeetingHomeAttendance(meetingRow, past)).toBeNull();
  });
});

describe('getPastMeetingAttendance', () => {
  it('lists the attended and absent counts when asked to', () => {
    expect(getPastMeetingAttendance({ invited: 20, attended: 9 }, { withAbsent: true })).toEqual({
      label: '9 of 20 attended · 45%',
      ariaLabel: '9 of 20 attended · 45%, 11 absent',
      segments: [{ kind: 'attendedPoor', percent: 45 }],
      answers: [
        { kind: 'attendedPoor', label: 'Attended', count: 9 },
        { kind: 'absent', label: 'Absent', count: 11 },
      ],
      noResponse: null,
      poor: true,
    });
  });

  it('never counts a negative absent', () => {
    expect(getPastMeetingAttendance({ invited: 2, attended: 3 }, { withAbsent: true })?.answers[1].count).toBe(0);
  });
});

describe('countMeetingRsvpSummary', () => {
  it('tallies answers and counts the rest as no response', () => {
    const registrants = [
      { rsvp: { response_type: 'accepted' } },
      { rsvp: { response_type: 'maybe' } },
      { rsvp: { response_type: 'declined' } },
      { rsvp: null },
    ];
    expect(countMeetingRsvpSummary(registrants)).toEqual({ invited: 4, yes: 1, maybe: 1, no: 1, no_response: 1 });
  });
});
