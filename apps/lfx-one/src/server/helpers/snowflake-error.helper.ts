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

/** True when Snowflake rejects a column reference, optionally for one expected identifier. */
export function isInvalidIdentifierError(error: unknown, expectedIdentifier?: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const isInvalidIdentifier = /invalid identifier/i.test(message) || /\berror code:\s*904\b/i.test(message);
  if (!isInvalidIdentifier || !expectedIdentifier) {
    return isInvalidIdentifier;
  }

  const identifierMatch = /invalid identifier\s+(?:'([^']+)'|"([^"]+)"|([^\s,;]+))/i.exec(message);
  const actualIdentifier = identifierMatch?.[1] ?? identifierMatch?.[2] ?? identifierMatch?.[3];
  return actualIdentifier?.toUpperCase() === expectedIdentifier.toUpperCase();
}
