// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ColumnarTable, DedupedValues } from '../interfaces/compact-cache.interface';

/**
 * Sentinel standing in for a field that was ABSENT (or explicitly `undefined`) on the source row,
 * as distinct from one that held `null`.
 *
 * The distinction is observable and must survive the cache. `JSON.stringify` omits an
 * `undefined`-valued key entirely, so on a cache MISS an optional field the source left unset
 * never reaches the client — while collapsing it to `null` at encode time would make the same
 * response come back carrying `"field": null` on a HIT. That is a wire difference between a warm
 * and a cold cache for every optional field in the Org Lens payloads (`accessBadge` on a roster
 * row, `project_uid` / `job_title` / `reason` / `avatar` / `username` on a seat), and
 * cache-hit-only divergence is the worst class of bug to trace.
 *
 * A `\u0000`-prefixed string is used because it will not collide with real data in practice. It is
 * NOT impossible — an escaped `\u0000` is legal inside a JSON string, and warehouse or upstream text
 * could in principle carry one — but a field whose entire value is exactly this sentinel would have
 * to occur, and the only consequence would be that one field decoding as absent.
 *
 * Trailing absent values are deliberately NOT trimmed off the encoded row, even though
 * {@link fromColumnar} would decode a short tail as absent: callers' cache guards assert
 * `row.length === k.length` to reject corrupt entries, and trimming would make every such entry
 * fail that check and silently never hit.
 */
const ABSENT = '\u0000absent';

/**
 * Projects `rows` onto the columnar cache shape (GH-1906), storing `keys` once instead of on every
 * row.
 *
 * A field that is absent or `undefined` is stored as {@link ABSENT} rather than `null`, so
 * {@link fromColumnar} can rebuild the original object exactly — see that sentinel's note for why
 * the two must not be collapsed.
 */
export function toColumnar<T extends object>(rows: readonly T[], keys: readonly (keyof T & string)[]): ColumnarTable {
  return {
    k: [...keys],
    r: rows.map((row) => keys.map((key) => (row[key] === undefined ? ABSENT : row[key]))),
  };
}

/**
 * Rebuilds the row objects encoded by {@link toColumnar}, restoring `null` and absent fields
 * exactly as they were: a key stored as {@link ABSENT} is left off the rebuilt object, so
 * `JSON.stringify` of a cache hit equals `JSON.stringify` of the cache miss that populated it.
 *
 * A row shorter than `k` (truncated, or written by hand) treats its missing tail as absent for the
 * same reason — an entry that never carried the field must not start asserting `null` for it.
 */
export function fromColumnar<T>(table: ColumnarTable): T[] {
  return table.r.map((values) => {
    const row: Record<string, unknown> = {};
    table.k.forEach((key, index) => {
      const value = index < values.length ? values[index] : ABSENT;
      if (value !== ABSENT && value !== undefined) {
        row[key] = value;
      }
    });
    return row as T;
  });
}

/**
 * Shape guard for a cached {@link ColumnarTable}. Cheap by design — it checks the envelope, not
 * every row's arity, because the cost is paid on every cache read and `fromColumnar` already treats
 * a short row's tail as absent. Callers layer their own domain guard on the decoded rows.
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
