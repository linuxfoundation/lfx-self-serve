// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EventInput } from '@fullcalendar/core';

import { CANCELLED_COLOR, MEETING_TYPE_COLORS } from '../constants';
import { Meeting, MeetingOccurrenceRoute, PastMeeting } from '../interfaces';
import type { MeetingCalendarClickProps } from '../interfaces/calendar.interface';

import { addMinutesToDate } from './date-time.utils';
import {
  buildMeetingOccurrenceRoute,
  hasMeetingEnded,
  isMeetingOccurrenceCancelled,
  resolveMeetingCalendarColors,
} from './meeting.utils';
import { getPastMeetingResourceId, getPastMeetingStartTimeMs, isPastMeetingCalendarRow } from './past-meeting.utils';

/**
 * Builds FullCalendar event inputs for a meeting or past-meeting row.
 * Shared by committee and dashboard calendar surfaces.
 */
export function meetingToCalendarEvents(meeting: Meeting | PastMeeting): EventInput[] {
  if (meeting.occurrences && meeting.occurrences.length > 0) {
    return meeting.occurrences.map((occ) => {
      const occurrenceDuration = occ.duration ?? meeting.duration;
      const isCancelled = isMeetingOccurrenceCancelled(occ, meeting.cancelled_occurrences);
      const isPast = !isCancelled && hasMeetingEnded(meeting, { ...occ, duration: occurrenceDuration });
      const colors = resolveMeetingCalendarColors(isCancelled, isPast);
      const classNames = ['meeting-event'];
      if (isCancelled) {
        classNames.push('cursor-default');
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
          password: meeting.password,
          startTime: occ.start_time,
          durationMinutes: occ.duration ?? meeting.duration,
        },
      };
    });
  }

  const pastRow = isPastMeetingCalendarRow(meeting);
  const startTimeMs = pastRow ? getPastMeetingStartTimeMs(meeting) : null;
  const startTime = startTimeMs !== null ? new Date(startTimeMs).toISOString() : meeting.start_time;
  const isPast = pastRow || hasMeetingEnded(meeting);
  const colors = resolveMeetingCalendarColors(false, isPast);
  const pastResourceId = pastRow ? getPastMeetingResourceId(meeting) : undefined;

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
      classNames: ['meeting-event'],
      extendedProps: {
        type: 'meeting',
        meetingId: pastResourceId ?? meeting.id,
        pastMeetingResourceId: pastResourceId,
        password: meeting.password,
        startTime,
        durationMinutes: meeting.duration,
      },
    },
  ];
}

/**
 * Resolves the router target for a meeting calendar click, or null when the event is inert.
 */
export function resolveMeetingCalendarClickRoute(
  props: MeetingCalendarClickProps,
  eventStart?: Date | null
): MeetingOccurrenceRoute | null {
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
