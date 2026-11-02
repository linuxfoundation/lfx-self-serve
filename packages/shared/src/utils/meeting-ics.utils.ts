// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting, MeetingCalendarEvent } from '../interfaces/meeting.interface';
import { getActiveOccurrences, getCurrentOrNextOccurrence } from './meeting.utils';
import { slugify } from './string.utils';

const ICS_PRODID = '-//The Linux Foundation//LFX One//EN';
const ICS_UID_DOMAIN = 'lfx.dev';
const ICS_MAX_LINE_OCTETS = 75;
const DEFAULT_DURATION_MINUTES = 60;
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
  return { start, durationMinutes: duration && duration > 0 ? duration : meeting.duration > 0 ? meeting.duration : DEFAULT_DURATION_MINUTES, occurrenceId };
}

/** `20261105T190000Z` — an instant in the iCalendar/Google UTC basic format. */
export function formatCalendarUtc(instantMs: number): string {
  return new Date(instantMs)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Description shared by the ICS and the Google link: project name (when known) and the LFX meeting page URL. */
function buildDescription(event: MeetingCalendarEvent): string {
  return [event.projectName?.trim(), event.joinUrl].filter(Boolean).join('\n');
}

// Removes control characters except TAB, CR and LF (the latter two are escaped by escapeIcsText, not dropped).
function stripControlCharacters(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

// RFC 5545 §3.3.11 TEXT escaping. Bare CR/LF become the literal \n escape so a value can never start a new property line.
function escapeIcsText(value: string): string {
  return stripControlCharacters(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// RFC 5545 §3.1 folding: lines are limited to 75 octets; continuation lines start with one space. Never splits a UTF-8 character.
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= ICS_MAX_LINE_OCTETS) {
    return line;
  }
  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;
  let limit = ICS_MAX_LINE_OCTETS;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = '';
      currentOctets = 0;
      limit = ICS_MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// Control characters other than TAB are invalid in an ICS value; strip them from URI values (TEXT values escape instead).
function sanitizeIcsUri(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '');
}

/**
 * Builds a single-event iCalendar (RFC 5545) document for one meeting occurrence.
 * @description DTSTART/DTEND are UTC instants, so no VTIMEZONE is needed and DST is resolved by the instant itself.
 * No RRULE: a recurring meeting is exported as the one occurrence passed in. Lines end in CRLF.
 * @param event The occurrence to describe
 * @param now DTSTAMP source (injectable for tests)
 * @throws RangeError when `event.start` is not a valid instant
 */
export function buildMeetingIcs(event: MeetingCalendarEvent, now: Date = new Date()): string {
  const startMs = Date.parse(event.start);
  if (Number.isNaN(startMs)) {
    throw new RangeError('Meeting start is not a valid date');
  }
  const endMs = startMs + event.durationMinutes * 60_000;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.occurrenceId ? `${event.uid}-${event.occurrenceId}` : event.uid)}@${ICS_UID_DOMAIN}`,
    `DTSTAMP:${formatCalendarUtc(now.getTime())}`,
    `DTSTART:${formatCalendarUtc(startMs)}`,
    `DTEND:${formatCalendarUtc(endMs)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(buildDescription(event))}`,
    `URL:${sanitizeIcsUri(event.joinUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
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
    details: buildDescription(event),
  });
  return `${GOOGLE_CALENDAR_RENDER_URL}?${params.toString()}`;
}
