// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EVENT_SOURCE_BACKFILL } from '../constants/events.constants';
import { sanitizeFilename } from './file.utils';

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

/** Overall certificate filename length budget, matching the `sanitizeFilename()` call below. */
const MAX_FILENAME_LENGTH = 150;
const CERTIFICATE_PREFIX = 'certificate-of-attendance';
const CERTIFICATE_EXTENSION = '.pdf';

/**
 * Unicode-aware slug for the certificate filename: keeps letters, digits, and combining marks
 * from any script (unlike the ASCII-only `slugify()` in string.utils.ts). Marks matter for
 * scripts like Devanagari, where they're required characters, not decoration — dropping them
 * (as a `\p{L}`/`\p{N}`-only filter would) reduces e.g. "हिन्दी" to the unreadable "ह-न-द" and can
 * collide distinct names. `sanitizeFilename()` still runs over the final joined result.
 */
function slugifyEventName(text: string): string {
  const slug = text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-');
  const start = slug.startsWith('-') ? 1 : 0;
  const end = slug.endsWith('-') ? slug.length - 1 : slug.length;
  return slug.slice(start, end);
}

/**
 * Truncate `text` to at most `maxLength` UTF-16 code units without splitting a surrogate pair.
 * Iterating by `for...of` walks whole code points, so an astral character (e.g. `𐐀`, itself a
 * surrogate pair) is either kept whole or dropped entirely — never left as an unpaired trailing
 * high surrogate, which would otherwise make `encodeURIComponent` throw downstream.
 */
function truncateByCodePoint(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let result = '';
  for (const codePoint of text) {
    if (result.length + codePoint.length > maxLength) break;
    result += codePoint;
  }
  return result;
}

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
  const dateStamp = toDateStamp(startDate);

  // Budget the name slug against the *NFD-normalized* form — the same normalization
  // `sanitizeFilename()` applies below — so a decomposable character (e.g. "é" → "e" + "´")
  // can't grow past this count later and crowd the date suffix out of sanitizeFilename's own
  // trailing truncation.
  const suffix = dateStamp ? `-${dateStamp}` : '';
  const nameBudget = Math.max(0, MAX_FILENAME_LENGTH - CERTIFICATE_PREFIX.length - 1 - suffix.length - CERTIFICATE_EXTENSION.length);
  const nameSlug = eventName ? truncateByCodePoint(slugifyEventName(eventName).normalize('NFD'), nameBudget) : '';

  const parts = [CERTIFICATE_PREFIX];
  if (nameSlug) parts.push(nameSlug);
  if (dateStamp) parts.push(dateStamp);
  if (!nameSlug && !dateStamp) parts.push(eventId);

  return sanitizeFilename(`${parts.join('-')}${CERTIFICATE_EXTENSION}`, MAX_FILENAME_LENGTH);
}
