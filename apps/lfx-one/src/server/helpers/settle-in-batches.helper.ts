// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Runs `fn` over `items` in sequential batches of `batchSize`, fanning each batch out with
 * `Promise.allSettled`, and returns one settled result per item in input order. Never throws: a
 * rejected `fn` shows up as its positional `{ status: 'rejected' }` entry for the caller to inspect.
 *
 * For best-effort per-item enrichment (e.g. one NATS lookup per listed person, #2724) where the
 * list is small but unbounded and a single failure must neither abort the rest nor fan every item
 * out at once. A `batchSize` below 1 is treated as 1.
 */
export async function settleInBatches<T, R>(items: readonly T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const size = Math.max(1, Math.floor(batchSize));
  const results: PromiseSettledResult<R>[] = [];

  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    const settled = await Promise.allSettled(batch.map((item) => fn(item)));
    results.push(...settled);
  }

  return results;
}
