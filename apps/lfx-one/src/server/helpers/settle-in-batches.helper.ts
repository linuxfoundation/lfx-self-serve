// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** The rejection reason `settleInBatches` records for every item it never started because `deadlineAt` passed first. */
export class BatchDeadlineExceededError extends Error {
  public constructor(remaining: number) {
    super(`Batch deadline exceeded with ${remaining} item(s) not attempted`);
    this.name = 'BatchDeadlineExceededError';
  }
}

/**
 * Runs `fn` over `items` in sequential batches of `batchSize`, fanning each batch out with
 * `Promise.allSettled`, and returns one settled result per item in input order. Never throws: a
 * rejected `fn` (including one that throws synchronously) shows up as its positional
 * `{ status: 'rejected' }` entry for the caller to inspect.
 *
 * With `deadlineAt` (epoch ms), no new batch starts once the deadline has passed — the batch in
 * flight still settles — and every item not attempted is recorded as rejected with a
 * {@link BatchDeadlineExceededError}, so the caller can tell "gave up" from "failed". The first
 * batch always runs. For best-effort per-item enrichment (e.g. one NATS lookup per listed person,
 * #2724) where the list is small but unbounded, a single failure must neither abort the rest nor
 * fan every item out at once, and the whole operation must not stall a page. A `batchSize` below 1
 * is treated as 1.
 */
export async function settleInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
  options: { deadlineAt?: number } = {}
): Promise<PromiseSettledResult<R>[]> {
  const size = Math.max(1, Math.floor(batchSize));
  const results: PromiseSettledResult<R>[] = [];

  for (let start = 0; start < items.length; start += size) {
    if (start > 0 && options.deadlineAt !== undefined && Date.now() > options.deadlineAt) {
      const reason = new BatchDeadlineExceededError(items.length - start);
      for (let i = start; i < items.length; i += 1) {
        results.push({ status: 'rejected', reason });
      }
      break;
    }

    const batch = items.slice(start, start + size);
    // `async` wrapper: a `fn` that throws synchronously becomes a rejected settled result instead
    // of escaping `map` before `allSettled` ever sees it.
    const settled = await Promise.allSettled(batch.map(async (item) => fn(item)));
    results.push(...settled);
  }

  return results;
}
