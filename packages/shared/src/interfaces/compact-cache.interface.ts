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
 * with the encoder's key list, and an entry written under an older key order still decodes
 * correctly. Cache keys are still version-bumped when the *shape* changes, because a decoded row
 * whose field set changed is a different contract.
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
