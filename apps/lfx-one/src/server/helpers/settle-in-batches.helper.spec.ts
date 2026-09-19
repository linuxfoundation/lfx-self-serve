// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import { BatchDeadlineExceededError, settleInBatches } from './settle-in-batches.helper';

describe('settleInBatches', () => {
  it('returns one positional result per item, in input order', async () => {
    const results = await settleInBatches([1, 2, 3], 2, async (n) => n * 10);

    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
    ]);
  });

  it('keeps a rejection in place without aborting the remaining items', async () => {
    const boom = new Error('boom');
    const results = await settleInBatches(['a', 'b', 'c'], 2, async (item) => {
      if (item === 'b') {
        throw boom;
      }
      return item.toUpperCase();
    });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'A' });
    expect(results[1]).toEqual({ status: 'rejected', reason: boom });
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'C' });
  });

  it('never runs more than a batch concurrently and runs batches sequentially', async () => {
    let inFlight = 0;
    let peak = 0;
    const fn = vi.fn(async (n: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return n;
    });

    const results = await settleInBatches([1, 2, 3, 4, 5], 2, fn);

    expect(results).toHaveLength(5);
    expect(fn).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });

  it('turns a synchronous throw into a rejected settled result instead of escaping', async () => {
    const boom = new Error('sync boom');
    const results = await settleInBatches([1, 2], 2, (n) => {
      if (n === 1) {
        throw boom;
      }
      return Promise.resolve(n);
    });

    expect(results).toEqual([
      { status: 'rejected', reason: boom },
      { status: 'fulfilled', value: 2 },
    ]);
  });

  it('stops issuing batches once the deadline has passed and marks the rest as not attempted', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
      const deadlineAt = Date.now() + 100;
      const fn = vi.fn(async (n: number) => {
        // Each call burns more than the whole budget, so the first batch settles and nothing after it starts.
        vi.setSystemTime(new Date(Date.now() + 200));
        return n;
      });

      const results = await settleInBatches([1, 2, 3, 4, 5], 2, fn, { deadlineAt });

      expect(fn).toHaveBeenCalledTimes(2);
      expect(results.slice(0, 2)).toEqual([
        { status: 'fulfilled', value: 1 },
        { status: 'fulfilled', value: 2 },
      ]);
      for (const result of results.slice(2)) {
        expect(result.status).toBe('rejected');
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(BatchDeadlineExceededError);
      }
      expect(results).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('always runs the first batch, even with a deadline already in the past', async () => {
    const results = await settleInBatches([1, 2, 3], 2, async (n) => n, { deadlineAt: 0 });

    expect(results.slice(0, 2).map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(results[2].status).toBe('rejected');
  });

  it('handles an empty list and a non-positive batch size', async () => {
    expect(await settleInBatches([], 3, async (n: number) => n)).toEqual([]);
    expect(await settleInBatches([7], 0, async (n) => n)).toEqual([{ status: 'fulfilled', value: 7 }]);
  });
});
