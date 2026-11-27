// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BEHAVIORAL_CLASS_CALENDAR_COLORS, PUBLIC_CALENDAR_LEGEND } from '../constants/calendar-colors.constants';
import {
  Meeting,
  MeetingCalendarGridEntry,
  MeetingOccurrenceRoute,
  PastMeeting,
  PublicCalendarItem,
  PublicCalendarMeeting,
  PublicCalendarModalFacts,
  PublicCalendarModalState,
} from '../interfaces';
import type {
  CalendarColor,
  CalendarLegendItem,
  MeetingCalendarClickProps,
  MeetingCalendarEventInput,
  PublicCalendarCommittee,
  PublicCalendarCommitteeContext,
} from '../interfaces/calendar.interface';
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
 *
 * @param contextProjectUid - The project whose calendar this is. A meeting from any other project
 *   (a sub-project rolled up into a foundation's calendar) gets its project name as a title prefix.
 */
export function meetingToCalendarEvents(meeting: Meeting | PastMeeting, contextProjectUid?: string): MeetingCalendarEventInput[] {
  const projectPrefix = getCalendarProjectPrefix(meeting, contextProjectUid);
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
        title: projectPrefix + (occ.title || meeting.title),
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
      title: projectPrefix + meeting.title,
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
 * Resolves the committee a public calendar event should be attributed to, or undefined when the meeting
 * has no committee that the public group directory lists.
 *
 * A meeting can belong to several committees. The active `?committee=` filter wins when the meeting
 * carries it; otherwise the first publicly listed committee is used, so attribution stays stable
 * regardless of how many private committees the meeting is also tied to.
 */
export function resolvePublicCalendarCommittee(
  meeting: Pick<PublicCalendarMeeting, 'committee_uids'>,
  context?: PublicCalendarCommitteeContext
): PublicCalendarCommittee | undefined {
  const committeesByUid = context?.committeesByUid;
  if (!committeesByUid) {
    return undefined;
  }

  const uids = meeting.committee_uids ?? [];
  const activeUid = context?.activeCommitteeUid;
  if (activeUid && uids.includes(activeUid) && committeesByUid[activeUid]) {
    return committeesByUid[activeUid];
  }

  return uids.map((uid) => committeesByUid[uid]).find((committee) => !!committee);
}

/**
 * Committee tinting applies to live events only. Cancelled and past occurrences keep their existing
 * muted treatments, which carry more meaning to a reader than the group the meeting belongs to.
 */
function resolvePublicCalendarColors(committee: PublicCalendarCommittee | undefined, isCancelled: boolean, isPast: boolean): CalendarColor {
  if (isCancelled || isPast || !committee) {
    return resolveMeetingCalendarColors(isCancelled, isPast);
  }
  return BEHAVIORAL_CLASS_CALENDAR_COLORS[committee.behavioralClass];
}

/**
 * Suffixes the group name so the attribution is not conveyed by color alone (WCAG 1.4.1). Skipped while
 * a committee filter is applied, where every event shares one group and the suffix is pure repetition.
 */
function resolvePublicCalendarTitle(title: string, committee: PublicCalendarCommittee | undefined, context?: PublicCalendarCommitteeContext): string {
  if (!committee || context?.activeCommitteeUid) {
    return title;
  }
  return `${title} · ${committee.name}`;
}

/**
 * Builds FullCalendar event inputs for anonymous/public calendar surfaces.
 * Takes the credential-free `PublicCalendarMeeting` projection rather than a full `Meeting`, so no
 * meeting password can reach client event state, click-through URLs, browser history, or referrers —
 * defense in depth behind the server-side allowlist on `GET /public/api/projects/:id/meetings`.
 *
 * `context` adds committee attribution — a color and a name suffix. Omit it and events render with the
 * default meeting palette and bare titles.
 */
export function publicMeetingToCalendarEvents(meeting: PublicCalendarMeeting, context?: PublicCalendarCommitteeContext): MeetingCalendarEventInput[] {
  const committee = resolvePublicCalendarCommittee(meeting, context);
  const title = resolvePublicCalendarTitle(meeting.title, committee, context);

  if (meeting.occurrences && meeting.occurrences.length > 0) {
    return meeting.occurrences.map((occ) => {
      // `duration` is typed required, but indexed occurrences omit it when there is no per-occurrence
      // override — same fallback the sibling mapper applies. Without it `isOccurrencePast` computes
      // NaN (never past) and `addMinutesToDate` quietly substitutes 60 minutes.
      const occurrenceDuration = occ.duration ?? meeting.duration;
      const isCancelled = isMeetingOccurrenceCancelled(occ, meeting.cancelled_occurrences);
      const isPast = !isCancelled && isOccurrencePast(occ.start_time, occurrenceDuration);
      const colors = resolvePublicCalendarColors(committee, isCancelled, isPast);
      const classNames = ['meeting-event'];
      if (isCancelled) {
        classNames.push('cursor-default');
      } else if (isPast) {
        classNames.push('meeting-event-past');
      }
      return {
        id: `${meeting.id}-${occ.occurrence_id}`,
        title,
        start: occ.start_time,
        end: addMinutesToDate(occ.start_time, occurrenceDuration).toISOString(),
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
          durationMinutes: occurrenceDuration,
        },
      };
    });
  }

  const startTime = meeting.scheduled_start_time ?? meeting.start_time;
  const isPast = isOccurrencePast(startTime, meeting.duration);
  const colors = resolvePublicCalendarColors(committee, false, isPast);
  const resourceId = meeting.meeting_and_occurrence_id ?? meeting.id;
  const classNames = ['meeting-event'];
  if (isPast) {
    classNames.push('meeting-event-past');
  }

  return [
    {
      id: resourceId,
      title,
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
 * A public feed meeting's dates as calendar grid entries, keyed like `publicMeetingToCalendarEvents` ids; cancelled
 * occurrences are left out.
 */
export function publicMeetingToCalendarGridEntries(meeting: PublicCalendarMeeting, now = new Date()): MeetingCalendarGridEntry[] {
  const entry = (key: string, startTime: string, durationMinutes: number): MeetingCalendarGridEntry => ({
    key,
    title: meeting.title,
    type: meeting.meeting_type,
    startTime,
    durationMinutes,
    past: isOccurrencePast(startTime, durationMinutes, now),
  });
  if (meeting.occurrences?.length) {
    return meeting.occurrences
      .filter((occ) => !isMeetingOccurrenceCancelled(occ, meeting.cancelled_occurrences))
      .map((occ) => entry(`${meeting.id}-${occ.occurrence_id}`, occ.start_time, occ.duration ?? meeting.duration));
  }
  return [entry(meeting.meeting_and_occurrence_id ?? meeting.id, meeting.scheduled_start_time ?? meeting.start_time, meeting.duration)];
}

/**
 * Every date of a public feed as calendar items, soonest first. A date just ended can come both from its live series and
 * as an archived row, so it is kept once, as the archived row.
 */
export function toPublicCalendarItems(meetings: readonly PublicCalendarMeeting[], now = new Date()): PublicCalendarItem[] {
  const items = new Map<string, PublicCalendarItem>();
  for (const meeting of meetings) {
    for (const entry of publicMeetingToCalendarGridEntries(meeting, now)) {
      const date = `${meeting.id}|${Date.parse(entry.startTime)}`;
      if (!items.has(date) || meeting.meeting_and_occurrence_id) items.set(date, { meeting, entry });
    }
  }
  return [...items.values()].sort((a, b) => Date.parse(a.entry.startTime) - Date.parse(b.entry.startTime));
}

/**
 * An .ics file with every date of a public meeting's series, cancelled ones left out, keyed like the project calendar feed.
 * shortcut: a browser copy of the server ics.helper events, folding by characters, not octets. revisit: when ics.helper moves to shared.
 */
export function buildPublicMeetingIcs(meeting: PublicCalendarMeeting, now = new Date()): string {
  const stamp = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const summary = meeting.title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/[;,]/g, (char) => `\\${char}`)
    .replace(/\r\n|\r|\n/g, '\\n');
  const fold = (line: string): string => line.match(/[\s\S]{1,74}/gu)?.join('\r\n ') ?? line;
  const events = publicMeetingToCalendarGridEntries(meeting, now).flatMap((entry) => [
    'BEGIN:VEVENT',
    `UID:${entry.key}@lfx.linuxfoundation.org`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(entry.startTime)}`,
    `DTEND:${stamp(addMinutesToDate(entry.startTime, entry.durationMinutes).toISOString())}`,
    'SEQUENCE:0',
    fold(`SUMMARY:${summary}`),
    fold(`DESCRIPTION:${summary}`),
    'END:VEVENT',
  ]);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LFX//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n');
}

/** The badge, note and actions of the public calendar meeting modal for what is known about the viewer and the date. */
export function resolvePublicCalendarModalState(facts: PublicCalendarModalFacts): PublicCalendarModalState {
  const { signedIn, failed, past, live, restricted, invited, recording, summary, access } = facts;
  if (failed) {
    const note = { text: "We couldn't load your details for this meeting. Try again in a moment.", warning: true };
    if (past) return { badge: { label: 'Ended', tone: 'neutral', variant: 'outline' }, note, actions: [] };
    // Joining or saving a public meeting doesn't depend on the viewer; registering and invite-only access do.
    return { badge: null, note, actions: restricted ? [] : [live ? 'join' : 'add-to-calendar'] };
  }
  if (past && signedIn && !access) {
    const text = "Only the meeting's invited guests can see its recording and summary.";
    return { badge: { label: 'Ended', tone: 'neutral', variant: 'outline' }, note: { text, warning: true }, actions: [] };
  }
  if (past) {
    const actions: PublicCalendarModalState['actions'] = [];
    if (summary) actions.push(signedIn ? 'view-summary' : 'sign-in-summary');
    if (recording) actions.push(signedIn ? 'watch-recording' : 'sign-in-watch');
    const note = actions.length ? null : { text: 'No recording or summary was published for this meeting.', warning: false };
    return { badge: { label: 'Ended', tone: 'neutral', variant: 'outline' }, note, actions };
  }
  const inviteOnly = { label: 'Invite only', tone: 'danger', variant: 'subtle' } as const;
  if (restricted && !signedIn) {
    return { badge: inviteOnly, note: { text: "Only invited guests can join. Sign in to check if you're invited.", warning: false }, actions: ['sign-in'] };
  }
  if (restricted && invited) {
    return { badge: { label: "You're invited", tone: 'success', variant: 'subtle' }, note: null, actions: [live ? 'join' : 'add-to-calendar'] };
  }
  if (restricted) {
    const text = 'Only invited guests can join this meeting. Contact the organizers if you think you should be invited.';
    return { badge: inviteOnly, note: { text, warning: true }, actions: [] };
  }
  if (live) return { badge: null, note: null, actions: ['join'] };
  if (!signedIn) return { badge: null, note: null, actions: ['add-to-calendar', 'sign-in-register'] };
  if (invited) {
    const text = "You'll get the join link by email before the meeting starts.";
    return { badge: { label: 'Registered', tone: 'success', variant: 'subtle' }, note: { text, warning: false }, actions: ['add-to-calendar'] };
  }
  return { badge: null, note: null, actions: ['add-to-calendar', 'register'] };
}

/**
 * Legend for a set of public calendar events, restricted to the colors those events actually use.
 *
 * Derived from the resolved events rather than from the meetings' committee associations because the
 * cancelled and past treatments override the group tint: a feed of only finished oversight meetings
 * resolves entirely to the past color, and an association-derived legend would advertise a green
 * "Oversight" swatch that is painted nowhere — worse than showing no legend at all, since the legend is
 * what carries the color key for readers who cannot rely on hue (WCAG 1.4.1).
 *
 * Scoped to the events passed in, which callers supply as the whole loaded feed rather than the visible
 * date range — so a swatch can still describe an event in a month the reader has not scrolled to. That
 * narrows the mismatch above rather than eliminating it; closing it entirely would mean feeding this the
 * viewport range from FullCalendar's `datesSet`.
 */
export function resolvePublicCalendarLegend(events: Pick<MeetingCalendarEventInput, 'backgroundColor'>[]): CalendarLegendItem[] {
  const colorsInUse = new Set(events.map((event) => event.backgroundColor));
  return PUBLIC_CALENDAR_LEGEND.filter((entry) => colorsInUse.has(entry.color));
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

/** `"<project> · "` for a meeting outside the calendar's own project, else an empty string. */
function getCalendarProjectPrefix(meeting: Pick<Meeting, 'project_uid' | 'project_name'>, contextProjectUid?: string): string {
  const projectName = meeting.project_name?.trim();
  if (!contextProjectUid || !projectName || meeting.project_uid === contextProjectUid) return '';
  return `${projectName} · `;
}
