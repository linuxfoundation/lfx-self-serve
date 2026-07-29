// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Go zero-value sentinel ("0001-01-01T00:00:00Z") some Go-backed upstream services emit on an
 * unset timestamp field instead of omitting it. A raw `Date.parse` would treat this as a real
 * (~year 1) timestamp rather than "no value" — sorting the record as the oldest possible item
 * instead of falling back to another field or being treated as absent.
 */
const GO_ZERO_DATE_PREFIX = '0001-01-01';

/** True for a value `Date.parse` would treat as real time — present, not the Go zero-date sentinel, and syntactically parseable. */
function isRealTimestamp(iso: string | undefined): iso is string {
  return !!iso && !iso.startsWith(GO_ZERO_DATE_PREFIX) && !Number.isNaN(Date.parse(iso));
}

/**
 * First candidate ISO timestamp that's genuinely present and parseable, treating a Go zero-date
 * sentinel the same as absent. A plain `??` fallback chain (e.g. `a.updated_at ?? a.created_at`)
 * only advances past `null`/`undefined` — a zero-date string is truthy and syntactically valid, so
 * it would otherwise win over a real value in a later field.
 */
export function firstValidTimestamp(...candidates: (string | undefined)[]): string {
  return candidates.find(isRealTimestamp) ?? '';
}

/** Same fallback as `firstValidTimestamp`, returned as epoch ms (or `null` if every candidate is invalid/absent). */
export function firstValidTimestampMs(...candidates: (string | undefined)[]): number | null {
  const found = candidates.find(isRealTimestamp);
  return found !== undefined ? new Date(found).getTime() : null;
}
