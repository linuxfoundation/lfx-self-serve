// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * True when a Snowflake error indicates the referenced table/view doesn't exist (or isn't
 * authorized) yet — the expected shape for a not-yet-deployed dbt model, distinct from a
 * malformed query (e.g. a wrong column name) against a table that does exist. Extracted from
 * `SnowflakeService.isMissingObjectError` so callers — including specs — can depend on the real
 * predicate instead of a hand-copied regex that can drift silently.
 */
export function isMissingObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist or not authorized/i.test(message);
}
