// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * True when a Snowflake error indicates the referenced table/view doesn't exist (or isn't
 * authorized) yet — the expected shape for a not-yet-deployed dbt model, distinct from a
 * malformed query (e.g. a wrong column name) against a table that does exist. Extracted from
 * `SnowflakeService.isMissingObjectError` so callers — including specs — can depend on the real
 * predicate instead of a hand-copied regex that can drift silently.
 *
 * Pass `expectedObject` to ask the narrower question "is THIS object the missing one?" — enough to
 * choose a fallback tier, and enough to keep a missing core table out of a caller's exemption.
 */
export function isMissingObjectError(error: unknown, expectedObject?: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const isMissingObject = /does not exist or not authorized/i.test(message);
  if (!isMissingObject || !expectedObject) {
    return isMissingObject;
  }

  // Snowflake names the object it blames. Without a name there is nothing to match, so the caller's
  // narrower expectation is not met and the error keeps its normal failure handling.
  const objectMatch = /\b(?:object|table|view|schema|database)\s+(?:'([^']+)'|"([^"]+)"|([^\s,;]+?))\s+does not exist or not authorized/i.exec(message);
  const blamedObject = objectMatch?.[1] ?? objectMatch?.[2] ?? objectMatch?.[3];
  if (!blamedObject) {
    return false;
  }

  // Compare on the qualified name's last segment so a caller can name the table alone, but require a
  // dot at the boundary: `FOO.BAR_REGISTRATIONS` must not satisfy an expectation of `REGISTRATIONS`.
  const actual = blamedObject.replace(/"/g, '').toUpperCase();
  const expected = expectedObject.replace(/"/g, '').toUpperCase();
  return actual === expected || actual.endsWith(`.${expected}`);
}

/**
 * True when the local connection pool refused the query because every connection was busy and its
 * waiting queue was already full (generic-pool's `acquire`). The query never reached Snowflake, so
 * this is backpressure from this process, not evidence that Snowflake is unhealthy. Acquire timeouts
 * are deliberately excluded: they also occur when Snowflake is unreachable and no connection can be
 * created, which the circuit breaker must still see.
 */
export function isPoolQueueFullError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /max waitingClients count exceeded/i.test(message);
}

/**
 * True when Snowflake rejects an out-of-range `LIMIT` (002010) or `OFFSET` (002011) row count.
 * `LIMIT`/`OFFSET` are interpolated literals, so this error is caused by the request rather than by
 * Snowflake being unhealthy. Deliberately narrow: other compilation errors — notably "does not exist
 * or not authorized", which can mean a revoked GRANT — must still reach the circuit breaker.
 */
export function isInvalidRowCountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code ?? '') : '';
  const normalizedErrorCode = errorCode.replace(/^0+/, '');
  return normalizedErrorCode === '2010' || normalizedErrorCode === '2011' || /invalid row count '[^']*' in (?:limit|result offset) clause/i.test(message);
}

/**
 * True when Snowflake cannot recognize a Date/Time/Timestamp/Numeric/Boolean value, typically from a
 * malformed request bind. These are value faults, not availability failures. Match only this error
 * family (or the confirmed numeric code 100038), so unrelated compilation/auth errors still count.
 */
export function isValueConversionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code ?? '') : '';
  const normalizedErrorCode = errorCode.replace(/^0+/, '');
  return normalizedErrorCode === '100038' || /\b(?:date|time|timestamp|numeric value|boolean value) '[^']*' is not recognized/i.test(message);
}

/**
 * True when Snowflake rejects a column reference, optionally for one expected identifier. Snowflake names the
 * reference as written, so an aliased column (`r.IS_CDP_TEAM_MEMBER`) comes back qualified (`'R.IS_CDP_TEAM_MEMBER'`):
 * quotes are stripped and a qualified name matches on its last part.
 */
export function isInvalidIdentifierError(error: unknown, expectedIdentifier?: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  let errorCode = '';
  if (typeof error === 'object' && error !== null && 'code' in error) {
    errorCode = String((error as { code?: unknown }).code ?? '');
  }
  const normalizedErrorCode = errorCode.replace(/^0+/, '');
  const isInvalidIdentifier = /invalid identifier/i.test(message) || /\berror code:\s*0*904\b/i.test(message) || normalizedErrorCode === '904';
  if (!isInvalidIdentifier || !expectedIdentifier) {
    return isInvalidIdentifier;
  }

  const identifierMatch = /invalid identifier\s+(?:'([^']+)'|"([^"]+)"|([^\s,;]+))/i.exec(message);
  const actual = (identifierMatch?.[1] ?? identifierMatch?.[2] ?? identifierMatch?.[3])?.replace(/["']/g, '').toUpperCase();
  const expected = expectedIdentifier.replace(/["']/g, '').toUpperCase();
  return actual !== undefined && (actual === expected || actual.endsWith(`.${expected}`));
}
