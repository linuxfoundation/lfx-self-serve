// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import { settleInBatches } from './settle-in-batches.helper';

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

  it('handles an empty list and a non-positive batch size', async () => {
    expect(await settleInBatches([], 3, async (n: number) => n)).toEqual([]);
    expect(await settleInBatches([7], 0, async (n) => n)).toEqual([{ status: 'fulfilled', value: 7 }]);
  });
});
