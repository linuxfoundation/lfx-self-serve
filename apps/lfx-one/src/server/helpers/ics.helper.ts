// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Meeting, PaginatedResponse } from '@lfx-one/shared/interfaces';
import { addMinutesToDate } from '@lfx-one/shared/utils';
import { logger } from '../services/logger.service';

/**
 * Formats an ISO date string to ICS DTSTART/DTEND format (e.g., 20230115T140000Z).
 */
export function formatICSDate(isoDate: string): string {
  return new Date(isoDate).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Escapes ICS text values per RFC 5545 (backslash, semicolons, commas, newlines).
 */
export function escapeICSText(value: string): string {
  return (value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a long ICS content line at 75 octets per RFC 5545 §3.1.
 * Counts UTF-8 bytes (not characters) so multi-byte chars don't exceed the limit.
 * Continuation lines begin with a single SPACE character (1 octet).
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  const maxFirst = 75;
  const maxCont = 74; // continuation lines: 75 minus the leading SPACE

  for (const char of line) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    const limit = chunks.length === 0 ? maxFirst : maxCont;

    if (currentBytes + charBytes > limit) {
      chunks.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }

  if (current) chunks.push(current);

  return chunks.join('\r\n ');
}

/**
 * Builds a single VEVENT block from meeting fields.
 * Uses nullish coalescing for duration so a valid 0-minute meeting is preserved.
 * Includes SEQUENCE:0 per RFC 5545 so calendar clients can detect rescheduled events,
 * and DESCRIPTION with the meeting title for richer calendar entries.
 */
export function buildVEvent(uid: string, title: string, startIso: string, durationMinutes: number | null | undefined): string {
  const dtstart = formatICSDate(startIso);
  const dtend = formatICSDate(addMinutesToDate(startIso, durationMinutes).toISOString());
  const dtstamp = formatICSDate(new Date().toISOString());

  return [
    'BEGIN:VEVENT',
    `UID:${uid}@lfx.linuxfoundation.org`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    'SEQUENCE:0',
    foldLine(`SUMMARY:${escapeICSText(title)}`),
    foldLine(`DESCRIPTION:${escapeICSText(title)}`),
    'END:VEVENT',
  ].join('\r\n');
}

/**
 * Converts an array of meetings into VEVENT strings.
 * Recurring meetings are expanded per occurrence; cancelled occurrences are excluded.
 * Per-occurrence duration takes precedence over the parent meeting duration.
 */
export function meetingsToVEvents(meetings: Meeting[]): string[] {
  const events: string[] = [];

  for (const meeting of meetings) {
    if (meeting.occurrences && meeting.occurrences.length > 0) {
      for (const occ of meeting.occurrences) {
        if (occ.status === 'cancel') continue;
        events.push(buildVEvent(`${meeting.id}-${occ.occurrence_id}`, occ.title || meeting.title, occ.start_time, occ.duration ?? meeting.duration));
      }
    } else if (meeting.start_time) {
      events.push(buildVEvent(meeting.id, meeting.title, meeting.start_time, meeting.duration));
    }
  }

  return events;
}

/**
 * Wraps VEVENT strings in a VCALENDAR envelope and returns the complete ICS string.
 */
export function buildVCalendar(events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LFX//Committee Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join(
    '\r\n'
  );
}

const MAX_PAGES = 50;

/**
 * Fetches all pages of meetings by following page_token pagination.
 * Accepts a callback so the caller controls which service method and query params are used.
 * Stops after MAX_PAGES pages to prevent unbounded loops from runaway pagination tokens.
 */
export async function fetchAllMeetingPages(fetchPage: (pageToken?: string) => Promise<PaginatedResponse<Meeting>>): Promise<Meeting[]> {
  const results: Meeting[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  do {
    const result = await fetchPage(pageToken);
    results.push(...result.data);
    pageToken = result.page_token;
    pageCount++;
    if (pageCount >= MAX_PAGES) {
      logger.warning(undefined, 'fetch_all_meeting_pages', 'Max page limit reached', { pageCount });
      break;
    }
  } while (pageToken);

  return results;
}
