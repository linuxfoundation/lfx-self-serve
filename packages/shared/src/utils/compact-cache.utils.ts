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
 * The encoding is collision-free, by escaping rather than by hoping no real value matches:
 *
 * - an absent field is stored as exactly {@link ABSENT}, a lone `\u0000`;
 * - a real string that itself begins with `\u0000` is stored with one extra `\u0000` in front,
 *   which {@link fromColumnar} strips again;
 * - every other value is stored unchanged.
 *
 * So no real value can ever be stored as a lone `\u0000`, and every real value — including the
 * strings `"\u0000"` and `"\u0000absent"` — round-trips exactly. Only top-level cells are escaped;
 * a string nested inside an array or object cell is never inspected on decode, so it needs none.
 *
 * Trailing absent values are deliberately NOT trimmed off the encoded row, even though
 * {@link fromColumnar} would decode a short tail as absent: a caller's guard may assert
 * `row.length === k.length` to reject corrupt entries (the Org Lens per-user seat and directory
 * guards do), and trimming would make every such entry fail that check and silently never hit.
 */
const ABSENT = '\u0000';

/** Encodes one top-level cell — see {@link ABSENT} for the escaping rule. */
function encodeCell(value: unknown): unknown {
  if (value === undefined) return ABSENT;
  if (typeof value === 'string' && value.startsWith(ABSENT)) return ABSENT + value;
  return value;
}

/**
 * Projects `rows` onto the columnar cache shape (GH-1906), storing `keys` once instead of on every
 * row.
 *
 * A field that is absent or `undefined` is stored as {@link ABSENT} rather than `null`, and a real
 * string beginning with `\u0000` is escaped, so {@link fromColumnar} can rebuild the original object
 * exactly — see that sentinel's note for why the two must not be collapsed.
 */
export function toColumnar<T extends object>(rows: readonly T[], keys: readonly (keyof T & string)[]): ColumnarTable {
  return {
    k: [...keys],
    r: rows.map((row) => keys.map((key) => encodeCell(row[key]))),
  };
}

/**
 * Rebuilds the row objects encoded by {@link toColumnar}, restoring `null`, absent fields and
 * escaped strings exactly as they were: a key stored as {@link ABSENT} is left off the rebuilt
 * object, so `JSON.stringify` of a cache hit equals `JSON.stringify` of the cache miss that
 * populated it.
 *
 * A row shorter than `k` (truncated, or written by hand) treats its missing tail as absent for the
 * same reason — an entry that never carried the field must not start asserting `null` for it.
 */
export function fromColumnar<T>(table: ColumnarTable): T[] {
  return table.r.map((values) => {
    const row: Record<string, unknown> = {};
    table.k.forEach((key, index) => {
      const value = index < values.length ? values[index] : ABSENT;
      if (value === ABSENT || value === undefined) return;
      row[key] = typeof value === 'string' && value.startsWith(ABSENT) ? value.slice(ABSENT.length) : value;
    });
    return row as T;
  });
}

/**
 * True when a raw stored cell is the {@link ABSENT} sentinel, i.e. the source row never carried
 * that field.
 *
 * For cache guards that validate stored rows positionally, before {@link fromColumnar} runs: a
 * required column must reject this value the same way the pre-compaction guard rejected a missing
 * key, instead of treating the sentinel as an ordinary string. A required column holding it fails
 * the whole entry, which then degrades to a miss. Exported so no caller has to repeat the
 * sentinel's encoding. An escaped real string is never mistaken for it.
 */
export function isColumnarAbsent(value: unknown): boolean {
  return value === ABSENT;
}

/**
 * Shape guard for a cached {@link ColumnarTable}. Cheap by design — it checks the envelope, not
 * every row's arity, because the cost is paid on every cache read and `fromColumnar` already treats
 * a short row's tail as absent. Callers layer their own domain guard on the stored or decoded rows.
 */
export function isColumnarTable(value: unknown): value is ColumnarTable {
  const table = value as Partial<ColumnarTable> | null;
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
