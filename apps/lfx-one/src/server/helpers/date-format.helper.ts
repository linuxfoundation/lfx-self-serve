// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Normalize Snowflake `Date | string | null` to ISO `YYYY-MM-DD` (null on invalid). Mirrors the regex-prefix pattern in `org-lens-people.service.ts` / `ProjectService.toIsoDate` so non-strict-ISO strings can't drift by a day via `new Date(...)` local-time parsing. */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
