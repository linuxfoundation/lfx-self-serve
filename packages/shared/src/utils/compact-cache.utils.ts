// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ColumnarTable, DedupedValues } from '../interfaces/compact-cache.interface';

/**
 * Projects `rows` onto the columnar cache shape (GH-1906), storing `keys` once instead of on every
 * row.
 *
 * `undefined` is normalized to `null` at encode time rather than left to `JSON.stringify` (which
 * would do the same thing inside an array, silently): making it explicit keeps the encoded value
 * identical whether or not it round-trips through JSON, so a unit test that never serializes still
 * covers what the cache stores.
 */
export function toColumnar<T extends object>(rows: readonly T[], keys: readonly (keyof T & string)[]): ColumnarTable {
  return {
    k: [...keys],
    r: rows.map((row) => keys.map((key) => (row[key] === undefined ? null : row[key]))),
  };
}

/**
 * Rebuilds the row objects encoded by {@link toColumnar}.
 *
 * A row shorter than `k` (a truncated or hand-written entry) yields `null` for the missing fields
 * rather than `undefined`, so the result is JSON-identical to a row that stored explicit nulls and
 * the caller's cache shape guard sees one shape, not two.
 */
export function fromColumnar<T>(table: ColumnarTable): T[] {
  return table.r.map((values) => {
    const row: Record<string, unknown> = {};
    table.k.forEach((key, index) => {
      row[key] = index < values.length && values[index] !== undefined ? values[index] : null;
    });
    return row as T;
  });
}

/**
 * Shape guard for a cached {@link ColumnarTable}. Cheap by design — it checks the envelope, not
 * every row's arity, because the cost is paid on every cache read and `fromColumnar` already
 * degrades a short row to nulls. Callers layer their own domain guard on the decoded rows.
 */
export function isColumnarTable(value: unknown): boolean {
  const table = value as ColumnarTable | null;
  return (
    !!table &&
    typeof table === 'object' &&
    Array.isArray(table.k) &&
    table.k.every((key) => typeof key === 'string') &&
    Array.isArray(table.r) &&
    table.r.every((row) => Array.isArray(row))
  );
}

/**
 * Deduplicates `items` by `keyOf` for cache storage (GH-1906), so a value repeated across many rows
 * — a project's people, a seat's committee, an attendee's event — is stored once and referenced by
 * index everywhere else.
 *
 * First occurrence wins: later duplicates are dropped rather than overwriting, so the retained
 * value matches the row order the caller already sorted by.
 */
export function dedupeByKey<T>(items: readonly T[], keyOf: (item: T) => string): DedupedValues<T> {
  const values: T[] = [];
  const indexOf = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (!indexOf.has(key)) {
      indexOf.set(key, values.length);
      values.push(item);
    }
  }
  return { values, indexOf };
}
