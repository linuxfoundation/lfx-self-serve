// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Column-oriented projection of a homogeneous row set, used to shrink cached Valkey payloads
 * (GH-1906): the field names are stored once in `k` instead of on every row, and each row becomes
 * a positional value array in `r`. For the warehouse-backed Org Lens caches the repeated key names
 * are roughly half of every serialized row, so this is the single largest saving available without
 * changing what the BFF returns to the browser.
 *
 * Self-describing on purpose: `k` travels with the data so a decoder never has to be kept in sync
 * with the encoder's key list. `fromColumnar` is therefore order-independent — it rebuilds from the
 * stored `k`, whatever order that is. A caller's GUARD need not be: the Org Lens guards use
 * `hasExactColumns`, which requires `k` to match the declared list position for position, so
 * reordering a column list is a stored-shape change and needs the cache key's version bumped with
 * it, exactly as adding or removing a column does.
 */
export interface ColumnarTable {
  /** Field names, in the same order as every row's values in `r`. */
  k: readonly string[];
  /** One positional value array per row, each aligned to `k`. */
  r: readonly (readonly unknown[])[];
}

/** A value set deduplicated for cache storage, plus the encode-time lookup from natural key to position in `values`. */
export interface DedupedValues<T> {
  /** Each distinct value stored exactly once; referenced elsewhere by its index. */
  values: T[];
  /** Natural key → index in `values`, for building the index references at encode time. */
  indexOf: Map<string, number>;
}

/**
 * Translates between the value a caller works with (`T`) and the value Valkey holds (`S`), for
 * `ValkeyService.withCompactCache`. `accept` is the shape guard applied to `S` on the way back: a
 * legacy, truncated or foreign entry must be rejected as a miss, never handed to `decode`.
 */
export interface CacheCodec<T, S> {
  encode: (value: T) => S;
  decode: (stored: S) => T;
  accept: (value: unknown) => boolean;
}
