// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Meeting, MeetingOccurrenceRoute, PastMeeting, PublicCalendarMeeting } from '../interfaces';
import type { MeetingCalendarClickProps, MeetingCalendarEventInput } from '../interfaces/calendar.interface';
import { Vote } from '../interfaces/poll.interface';
import { Survey } from '../interfaces/survey.interface';

import { addMinutesToDate } from './date-time.utils';
import {
  buildMeetingOccurrenceRoute,
  hasMeetingEnded,
  isCalendarDeadlinePast,
  isMeetingOccurrenceCancelled,
  isOccurrencePast,
  isVoteCalendarEventPast,
  resolveMeetingCalendarColors,
  resolveSurveyCalendarColors,
  resolveVoteCalendarColors,
} from './meeting.utils';
import { getPastMeetingResourceId, getPastMeetingStartTimeMs, isPastMeetingCalendarRow } from './past-meeting.utils';

/**
 * Builds FullCalendar event inputs for a meeting or past-meeting row.
 * Shared by committee and dashboard calendar surfaces.
 */
export function meetingToCalendarEvents(meeting: Meeting | PastMeeting): MeetingCalendarEventInput[] {
  if (meeting.occurrences && meeting.occurrences.length > 0) {
    return meeting.occurrences.map((occ) => {
      const occurrenceDuration = occ.duration ?? meeting.duration;
      const isCancelled = isMeetingOccurrenceCancelled(occ, meeting.cancelled_occurrences);
      const isPast = !isCancelled && hasMeetingEnded(meeting, { ...occ, duration: occurrenceDuration });
      const colors = resolveMeetingCalendarColors(isCancelled, isPast);
      const classNames = ['meeting-event'];
      if (isCancelled) {
        classNames.push('cursor-default');
      } else if (isPast) {
        classNames.push('meeting-event-past');
      }
      return {
        id: `${meeting.id}-${occ.occurrence_id}`,
        title: occ.title || meeting.title,
        start: occ.start_time,
        end: addMinutesToDate(occ.start_time, occ.duration ?? meeting.duration).toISOString(),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        textColor: colors.text,
        display: 'block',
        classNames,
        extendedProps: {
          type: 'meeting',
          meetingId: meeting.id,
          cancelled: isCancelled,
          password: meeting.password ?? undefined,
          startTime: occ.start_time,
          durationMinutes: occ.duration ?? meeting.duration,
        },
      };
    });
  }

  const pastRow = isPastMeetingCalendarRow(meeting);
  const startTimeMs = pastRow ? getPastMeetingStartTimeMs(meeting) : null;
  const startTime = startTimeMs !== null ? new Date(startTimeMs).toISOString() : meeting.start_time;
  const isPast = isOccurrencePast(startTime, meeting.duration);
  const colors = resolveMeetingCalendarColors(false, isPast);
  const pastResourceId = pastRow ? getPastMeetingResourceId(meeting) : undefined;
  const classNames = ['meeting-event'];
  if (isPast) {
    classNames.push('meeting-event-past');
  }

  return [
    {
      id: pastResourceId ?? meeting.id,
      title: meeting.title,
      start: startTime,
      end: addMinutesToDate(startTime, meeting.duration).toISOString(),
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: colors.text,
      display: 'block',
      classNames,
      extendedProps: {
        type: 'meeting',
        meetingId: pastResourceId ?? meeting.id,
        pastMeetingResourceId: pastResourceId,
        password: meeting.password ?? undefined,
        startTime,
        durationMinutes: meeting.duration,
      },
    },
  ];
}

/**
 * Builds FullCalendar event inputs for anonymous/public calendar surfaces.
 * Takes the credential-free `PublicCalendarMeeting` projection rather than a full `Meeting`, so no
 * meeting password can reach client event state, click-through URLs, browser history, or referrers —
 * defense in depth behind the server-side allowlist on `GET /public/api/projects/:id/meetings`.
 */
export function publicMeetingToCalendarEvents(meeting: PublicCalendarMeeting): MeetingCalendarEventInput[] {
  if (meeting.occurrences && meeting.occurrences.length > 0) {
    return meeting.occurrences.map((occ) => {
      const isCancelled = isMeetingOccurrenceCancelled(occ, meeting.cancelled_occurrences);
      const isPast = !isCancelled && isOccurrencePast(occ.start_time, occ.duration);
      const colors = resolveMeetingCalendarColors(isCancelled, isPast);
      const classNames = ['meeting-event'];
      if (isCancelled) {
        classNames.push('cursor-default');
      } else if (isPast) {
        classNames.push('meeting-event-past');
      }
      return {
        id: `${meeting.id}-${occ.occurrence_id}`,
        title: meeting.title,
        start: occ.start_time,
        end: addMinutesToDate(occ.start_time, occ.duration).toISOString(),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        textColor: colors.text,
        display: 'block',
        classNames,
        extendedProps: {
          type: 'meeting',
          meetingId: meeting.id,
          cancelled: isCancelled,
          startTime: occ.start_time,
          durationMinutes: occ.duration,
        },
      };
    });
  }

  const startTime = meeting.scheduled_start_time ?? meeting.start_time;
  const isPast = isOccurrencePast(startTime, meeting.duration);
  const colors = resolveMeetingCalendarColors(false, isPast);
  const resourceId = meeting.meeting_and_occurrence_id ?? meeting.id;
  const classNames = ['meeting-event'];
  if (isPast) {
    classNames.push('meeting-event-past');
  }

  return [
    {
      id: resourceId,
      title: meeting.title,
      start: startTime,
      end: addMinutesToDate(startTime, meeting.duration).toISOString(),
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: colors.text,
      display: 'block',
      classNames,
      extendedProps: {
        type: 'meeting',
        meetingId: resourceId,
        pastMeetingResourceId: meeting.meeting_and_occurrence_id,
        startTime,
        durationMinutes: meeting.duration,
      },
    },
  ];
}

/**
 * Resolves the router target for a meeting calendar click, or null when the event is inert.
 */
export function resolveMeetingCalendarClickRoute(props: MeetingCalendarClickProps, eventStart?: Date | null): MeetingOccurrenceRoute | null {
  if (props.cancelled || props.type !== 'meeting' || !props.meetingId) {
    return null;
  }

  const startTime = props.startTime ?? eventStart?.toISOString();
  if (!startTime) {
    return {
      path: ['/meetings', props.meetingId],
      queryParams: props.password ? { password: props.password } : undefined,
    };
  }

  return buildMeetingOccurrenceRoute(props.meetingId, startTime, props.durationMinutes ?? 0, {
    password: props.password,
    pastMeetingResourceId: props.pastMeetingResourceId,
  });
}

/** Returns true when a survey cutoff event should render with past calendar styling. */
export function isSurveyCalendarEventPast(survey: Pick<Survey, 'survey_cutoff_date'>, now = new Date()): boolean {
  return isCalendarDeadlinePast(survey.survey_cutoff_date, now);
}

/** Builds a FullCalendar event input for a committee vote deadline. */
export function voteToCalendarEvent(vote: Pick<Vote, 'uid' | 'name' | 'end_time' | 'status' | 'early_end_time'>): MeetingCalendarEventInput {
  const isPast = isVoteCalendarEventPast(vote);
  const colors = resolveVoteCalendarColors(isPast);
  const classNames = ['vote-event', 'cursor-default'];
  if (isPast) {
    classNames.push('vote-event-past');
  }

  return {
    id: `vote-${vote.uid}`,
    title: `Vote closes: ${vote.name}`,
    start: vote.end_time,
    allDay: true,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    textColor: colors.text,
    classNames,
    extendedProps: { type: 'vote', voteId: vote.uid },
  };
}

/** Builds a FullCalendar event input for a committee survey cutoff. */
export function surveyToCalendarEvent(
  survey: Pick<Survey, 'uid' | 'survey_title' | 'survey_cutoff_date'> & { survey_cutoff_date: string }
): MeetingCalendarEventInput {
  const isPast = isSurveyCalendarEventPast(survey);
  const colors = resolveSurveyCalendarColors(isPast);
  const classNames = ['survey-event', 'cursor-default'];
  if (isPast) {
    classNames.push('survey-event-past');
  }

  return {
    id: `survey-${survey.uid}`,
    title: `Survey: ${survey.survey_title}`,
    start: survey.survey_cutoff_date,
    allDay: true,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    textColor: colors.text,
    classNames,
    extendedProps: { type: 'survey', surveyId: survey.uid },
  };
}
