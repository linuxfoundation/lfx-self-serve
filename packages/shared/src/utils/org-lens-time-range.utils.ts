// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_DEFAULT_TIME_RANGE, ORG_LENS_TIME_RANGE_DAYS, ORG_LENS_TIME_RANGES } from '../constants/org-lens-time-range.constants';
import type { OrgLensTimeRange } from '../interfaces/org-lens-time-range.interface';

/** Whether `value` is one of the Org Lens range values. */
export function isOrgLensTimeRange(value: unknown): value is OrgLensTimeRange {
  return (ORG_LENS_TIME_RANGES as readonly unknown[]).includes(value);
}

/**
 * `?range=` value → range. The legacy `12mo` reads as `365d`, as the BFF reads it (an old link keeps its 12-month
 * window rather than widening to the default); anything else absent or unknown is the default.
 */
export function parseOrgLensTimeRange(value: string | null | undefined): OrgLensTimeRange {
  const normalized = typeof value === 'string' ? normalizeLegacyOrgLensTimeRange(value) : value;
  return isOrgLensTimeRange(normalized) ? normalized : ORG_LENS_DEFAULT_TIME_RANGE;
}

/**
 * A `range` / `timeRange` value with the legacy `12mo` (the old default, still sent by tabs opened before the
 * Past 365 days ranges) read as `365d`; any other value is returned unchanged for the caller to validate.
 */
export function normalizeLegacyOrgLensTimeRange(value: string): string {
  return value === '12mo' ? '365d' : value;
}

/** Window length in days of a bounded range; throws for any other value, so a SQL builder never inlines `undefined`. */
export function orgLensTimeRangeDays(range: Exclude<OrgLensTimeRange, 'all'>): number {
  if (!Object.hasOwn(ORG_LENS_TIME_RANGE_DAYS, range)) {
    throw new Error(`Unknown bounded Org Lens time range: ${String(range)}`);
  }
  return ORG_LENS_TIME_RANGE_DAYS[range];
}

/** The `?range=` value to write for a range: `null` (dropped from the URL) at the default. */
export function orgLensTimeRangeUrlParam(range: OrgLensTimeRange): OrgLensTimeRange | null {
  return range === ORG_LENS_DEFAULT_TIME_RANGE ? null : range;
}
