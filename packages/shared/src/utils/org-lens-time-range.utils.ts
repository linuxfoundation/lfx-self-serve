// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_DEFAULT_TIME_RANGE, ORG_LENS_TIME_RANGE_DAYS, ORG_LENS_TIME_RANGES } from '../constants/org-lens-time-range.constants';
import type { OrgLensTimeRange } from '../interfaces/org-lens-time-range.interface';

/** Whether `value` is one of the Org Lens range values. */
export function isOrgLensTimeRange(value: unknown): value is OrgLensTimeRange {
  return (ORG_LENS_TIME_RANGES as readonly unknown[]).includes(value);
}

/** `?range=` value → range; anything absent or unknown (an old `12mo` link included) is the default. */
export function parseOrgLensTimeRange(value: string | null | undefined): OrgLensTimeRange {
  return isOrgLensTimeRange(value) ? value : ORG_LENS_DEFAULT_TIME_RANGE;
}

/** The `?range=` value to write for a range: `null` (dropped from the URL) at the default. */
export function orgLensTimeRangeUrlParam(range: OrgLensTimeRange): OrgLensTimeRange | null {
  return range === ORG_LENS_DEFAULT_TIME_RANGE ? null : range;
}

/**
 * First UTC day (`YYYY-MM-DD`) a bounded range counts, `null` for all time — the client-side match
 * of `DATEADD(day, -N, CURRENT_DATE())`. Lexically comparable to ISO dates and timestamps.
 */
export function orgLensTimeRangeStartDate(range: OrgLensTimeRange, now: Date = new Date()): string | null {
  if (range === 'all') return null;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ORG_LENS_TIME_RANGE_DAYS[range]));
  return start.toISOString().slice(0, 10);
}

/** Today's UTC date (`YYYY-MM-DD`) — the match of `CURRENT_DATE()` for "has ended" checks. */
export function orgLensUtcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
