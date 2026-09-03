// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EVENT_SOURCE_BACKFILL } from '../constants/events.constants';

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
