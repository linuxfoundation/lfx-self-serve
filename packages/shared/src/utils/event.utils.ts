// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EVENT_SOURCE_BACKFILL } from '../constants/events.constants';

/**
 * True when an event registration row came from the CSV backfill import.
 *
 * Trimmed and lowercased on purpose: the value originates in hand-maintained import data, so
 * casing and stray whitespace drift. Keep this in sync with the equivalent
 * `LOWER(TRIM(EVENT_SOURCE))` comparison used in the Snowflake queries — the two must agree, or a
 * row can land in one tab while carrying the other tab's status.
 */
export function isBackfillEventSource(source: string | null | undefined): boolean {
  return source?.trim().toLowerCase() === EVENT_SOURCE_BACKFILL;
}
