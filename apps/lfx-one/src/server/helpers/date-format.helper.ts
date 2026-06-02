// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Normalize a Snowflake `Date | string | null | undefined` to an ISO
 * `YYYY-MM-DD` date string. Returns `null` when the input is missing or
 * unparseable. Date-only — strips any time component, suitable for the
 * date-grain columns the events / contributors platinum models expose
 * even when the underlying SQL type is TIMESTAMP.
 *
 * Use this helper anywhere a server response field is documented as
 * date-grain (`string | null`). For full ISO timestamps with time-of-day
 * preserved, write a service-local `toIsoTimestamp` (the training tab
 * keeps one locally because its sort/most-recent derivations need the
 * full precision).
 */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return null;
}
