// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EVENT_SOURCE_BACKFILL } from '../constants/events.constants';
import { sanitizeFilename } from './file.utils';
import { slugify } from './string.utils';

/**
 * True when an event registration row came from the CSV backfill import.
 *
 * Lowercased and whitespace-stripped on purpose: the value originates in hand-maintained import
 * data, so casing and stray whitespace drift.
 *
 * The stripped set is deliberately the four characters `' \t\n\r'` rather than whatever
 * `String.prototype.trim()` happens to cover. This must agree exactly with the
 * `LOWER(TRIM(EVENT_SOURCE, ' \t\n\r'))` comparison in EventsService.isPastEventSql(), or a row can
 * land in one tab while carrying the other tab's status. `trim()` strips a strict superset —
 * vertical tab, form feed, NBSP (U+00A0), BOM (U+FEFF), U+2028/2029, U+3000 and more — and
 * Snowflake has no equivalent character class, so parity is only reachable by narrowing this side.
 *
 * Consequence: a source value padded with one of those exotic characters matches on neither side,
 * so the row falls to the `ELSE` branch and keeps the stored IS_PAST_EVENT — the pre-fix behaviour,
 * which is the safe direction to fail in.
 *
 * This parity requirement only binds callers mirroring isPastEventSql() against Snowflake. A
 * JS-only caller (no SQL counterpart) may pre-trim with String.prototype.trim() before calling.
 */
export function isBackfillEventSource(source: string | null | undefined): boolean {
  return source?.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '').toLowerCase() === EVENT_SOURCE_BACKFILL;
}

/** Certificate filename length budget for the slugified event name, leaving room for the fixed prefix, date suffix, and extension. */
const MAX_NAME_SLUG_LENGTH = 100;

/**
 * Local calendar-date `YYYY-MM-DD` for a timestamp, matching the date `CertificateService` prints
 * in the PDF body (also derived from local `Date` getters) so the filename and the certificate
 * text never disagree. Returns '' when missing/unparseable.
 */
function toDateStamp(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Build the download filename for a Certificate of Attendance PDF, e.g.
 * "certificate-of-attendance-kubecon-cloudnativecon-na-2025-2025-11-10.pdf". Falls back to
 * `eventId` when the event name and start date are both unavailable, so the file always has a
 * discriminator.
 */
export function buildCertificateFileName(eventName: string | null | undefined, startDate: Date | string | null | undefined, eventId: string): string {
  const nameSlug = eventName ? slugify(eventName).slice(0, MAX_NAME_SLUG_LENGTH) : '';
  const dateStamp = toDateStamp(startDate);

  const parts = ['certificate-of-attendance'];
  if (nameSlug) parts.push(nameSlug);
  if (dateStamp) parts.push(dateStamp);
  if (!nameSlug && !dateStamp) parts.push(eventId);

  return sanitizeFilename(`${parts.join('-')}.pdf`, 150);
}
