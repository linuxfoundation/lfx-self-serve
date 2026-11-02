// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_CALENDAR_DEFAULT_DURATION_MINUTES } from '../constants/meeting.constants';
import type { Meeting, MeetingCalendarEvent } from '../interfaces/meeting.interface';
import { getActiveOccurrences, getCurrentOrNextOccurrence } from './meeting.utils';
import { slugify } from './string.utils';

const GOOGLE_CALENDAR_RENDER_URL = 'https://calendar.google.com/calendar/render';

/**
 * Picks the occurrence a calendar event should describe.
 * @description Reuses the page's own resolution: an explicit `?occurrence=<epoch ms>` wins when it matches an active
 * occurrence, otherwise the current-or-next active occurrence. A one-time meeting (no occurrences) uses its own start.
 * A recurring meeting with no remaining occurrence resolves to null rather than to the series' past start.
 * @returns start (RFC3339 instant) and duration in minutes, or null when no usable start exists
 */
export function resolveMeetingCalendarOccurrence(
  meeting: Meeting,
  requestedOccurrenceMs?: number | null
): { start: string; durationMinutes: number; occurrenceId: string | null } | null {
  const occurrences = meeting?.occurrences ?? [];
  let start: string | undefined;
  let duration: number | undefined;
  let occurrenceId: string | null = null;

  if (occurrences.length > 0) {
    const requested =
      requestedOccurrenceMs && Number.isFinite(requestedOccurrenceMs)
        ? getActiveOccurrences(occurrences, meeting.cancelled_occurrences).find((o) => Date.parse(o.start_time) === requestedOccurrenceMs)
        : undefined;
    const occurrence = requested ?? getCurrentOrNextOccurrence(meeting);
    start = occurrence?.start_time;
    duration = occurrence?.duration;
    occurrenceId = occurrence?.occurrence_id ?? null;
  } else {
    start = meeting?.start_time;
    duration = meeting?.duration;
  }

  if (!start || Number.isNaN(Date.parse(start))) {
    return null;
  }
  return { start, durationMinutes: pickPositiveDuration(duration, meeting.duration), occurrenceId };
}

// First strictly positive duration, else the shared default; kept as statements (no nested ternary).
function pickPositiveDuration(...candidates: (number | undefined | null)[]): number {
  const positive = candidates.find((value): value is number => typeof value === 'number' && value > 0);
  return positive ?? MEETING_CALENDAR_DEFAULT_DURATION_MINUTES;
}

/** `20261105T190000Z` — an instant in the iCalendar/Google UTC basic format. */
export function formatCalendarUtc(instantMs: number): string {
  return new Date(instantMs)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Description shared by the ICS and the Google link: project name (when known) and the LFX meeting page URL. */
export function buildMeetingCalendarDescription(event: MeetingCalendarEvent): string {
  return [event.projectName?.trim(), event.joinUrl].filter(Boolean).join('\n');
}

/** Download name for the ICS: `<title-slug>.ics`, never empty. */
export function buildMeetingIcsFileName(title: string): string {
  return `${slugify(title || '').slice(0, 80) || 'meeting'}.ics`;
}

/** Prefilled Google Calendar "create event" URL from the same fields as the ICS. */
export function buildGoogleCalendarUrl(event: MeetingCalendarEvent): string {
  const startMs = Date.parse(event.start);
  if (Number.isNaN(startMs)) {
    throw new RangeError('Meeting start is not a valid date');
  }
  const endMs = startMs + event.durationMinutes * 60_000;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatCalendarUtc(startMs)}/${formatCalendarUtc(endMs)}`,
    details: buildMeetingCalendarDescription(event),
  });
  return `${GOOGLE_CALENDAR_RENDER_URL}?${params.toString()}`;
}
