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

/**
 * Snowflake text timestamp: `YYYY-MM-DD[ T]HH:MM[:SS[.fff…]][ ][Z|±HH[:]MM]`.
 * The space before the offset is what `snowflake-sdk` emits from its `Date.toJSON()` override
 * (default `TIMESTAMP_OUTPUT_FORMAT` = `YYYY-MM-DD HH24:MI:SS.FF3 TZHTZM`), so it is the shape a
 * Snowflake row takes after a JSON round-trip through the Valkey cache.
 */
const SNOWFLAKE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/** The pattern's zone capture as an offset `new Date()` accepts: absent or `Z` → `Z`; `-0700` → `-07:00`; `-07:00` passes through. */
function normalizeOffset(zone: string | undefined): string {
  if (!zone || zone.toUpperCase() === 'Z') return 'Z';
  if (zone.includes(':')) return zone;
  return `${zone.slice(0, 3)}:${zone.slice(3)}`;
}

/**
 * Normalize a Snowflake `Date | string | null` to a full ISO-8601 UTC string, or null when missing /
 * unparseable. Accepts native ISO, Snowflake NTZ strings (no zone → treated as UTC, not server-local),
 * and Snowflake LTZ/TZ strings with a space-separated `±HHMM` offset — the last of which `new Date()`
 * rejects, which is what blanked Org Lens dates on cache hits (Microsoft Code Contributions, Past 12 Months).
 */
export function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  const match = trimmed.match(SNOWFLAKE_TIMESTAMP_PATTERN);
  if (match) {
    const [, date, time, zone] = match;
    const parsed = new Date(`${date}T${time}${normalizeOffset(zone)}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * `JSON.stringify` replacer that writes every `Date` as strict ISO-8601 UTC. `snowflake-sdk` returns
 * timestamp columns as `Date`s whose `toJSON()` is overridden to emit the session output format
 * (`YYYY-MM-DD HH24:MI:SS.FF3 TZHTZM`, e.g. `2026-10-21 23:12:33.000 -0700`), which `new Date()`
 * cannot parse — so a cache hit silently turned a valid timestamp into null. Reads `this[key]` because
 * the replacer's `value` argument has already been through `toJSON()`.
 */
export function isoDateReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const original = this[key];
  if (original instanceof Date) {
    return Number.isNaN(original.getTime()) ? null : original.toISOString();
  }
  return value;
}
