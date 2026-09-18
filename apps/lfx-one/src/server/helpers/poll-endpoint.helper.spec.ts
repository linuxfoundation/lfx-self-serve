// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for poll-endpoint.helper.ts — the wall-clock budget (maxDurationMs) pins GH-1637's
// "worst case never exceeds the pre-fine-grid window" contract: attempt counts alone can't bound
// wall-clock time because each pollFn call takes as long as its upstream request, so a
// slow-but-successful endpoint would otherwise stretch the total far past the documented cap.

import { describe, expect, it, vi } from 'vitest';

import { logger } from '../services/logger.service';
import { pollEndpoint } from './poll-endpoint.helper';

vi.mock('../services/logger.service', () => ({
  logger: {
    debug: vi.fn(),
    warning: vi.fn(),
  },
}));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('pollEndpoint', () => {
  it('resolves true as soon as pollFn reports the condition met', async () => {
    const pollFn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 5, retryDelayMs: 1 })).resolves.toBe(true);
    expect(pollFn).toHaveBeenCalledTimes(2);
  });

  it('stops at maxRetries when no wall-clock budget is set (attempt-count bounding unchanged)', async () => {
    const pollFn = vi.fn().mockResolvedValue(false);

    await expect(pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 3, retryDelayMs: 1 })).resolves.toBe(false);
    expect(pollFn).toHaveBeenCalledTimes(3);
    // No budget → no remaining budget handed to pollFn.
    expect(pollFn).toHaveBeenCalledWith({ remainingMs: undefined });
  });

  it('stops when the wall-clock budget is spent, even with attempts remaining', async () => {
    // Each query burns ~30 ms of the 50 ms budget: attempt 1 runs at t≈0, the truncated sleep
    // lands at t≈40, attempt 2 gets a small remainingMs and ends past the deadline — the 100-
    // attempt count is never reached. Without the deadline this loop would take 100 × 40 ms ≈ 4 s.
    const pollFn = vi.fn(async () => {
      await sleep(30);
      return false;
    });

    const start = Date.now();
    const resolved = await pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 100, retryDelayMs: 10, maxDurationMs: 50 });
    const elapsed = Date.now() - start;

    expect(resolved).toBe(false);
    expect(pollFn.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(pollFn.mock.calls.length).toBeLessThanOrEqual(3);
    expect(elapsed).toBeLessThan(1000);
  });

  it('never invokes pollFn when the wall-clock budget is already spent (maxDurationMs: 0)', async () => {
    // Pins the `=== undefined` discrimination: 0 is a real budget — enableVote's trailing poll
    // legitimately passes it after slow retries — and a refactor to a truthy check would
    // silently restore unbounded polling on exactly this boundary.
    const pollFn = vi.fn().mockResolvedValue(true);

    const resolved = await pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 5, retryDelayMs: 1, maxDurationMs: 0 });

    expect(resolved).toBe(false);
    expect(pollFn).not.toHaveBeenCalled();
  });

  it('keeps polling into the final second of the budget — late index visibility still resolves', async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      // The vote grid (8 s budget, 300 ms cadence): the condition flips at t≈7.5 s — inside the
      // last second of the budget, which a minimum-request-budget floor would have discarded even
      // though the remaining time still carries a viable query (GH-1637's no-new-fallback bar).
      const pollFn = vi.fn(async () => Date.now() - start >= 7500);

      const promise = pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 27, retryDelayMs: 300, maxDurationMs: 8000 });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a pollFn throw at the deadline as budget exhaustion, not an unexpected error', async () => {
    vi.useFakeTimers();
    vi.mocked(logger.warning).mockClear();
    try {
      const start = Date.now();
      const pollFn = vi.fn(async () => {
        if (Date.now() - start < 7800) {
          return false;
        }
        // The tail request runs past the 8 s deadline before its timeout aborts it.
        await sleep(300);
        throw new Error('The operation timed out');
      });

      const promise = pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 27, retryDelayMs: 300, maxDurationMs: 8000 });
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe(false);
      expect(vi.mocked(logger.warning)).toHaveBeenCalledWith(
        undefined,
        'test_op',
        'Poll wall-clock budget exhausted, proceeding anyway',
        expect.objectContaining({ max_duration_ms: 8000 })
      );
      expect(vi.mocked(logger.warning)).not.toHaveBeenCalledWith(undefined, 'test_op', 'Unexpected error during polling', expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands pollFn the remaining wall-clock budget so the caller can cap its request timeout', async () => {
    const pollFn = vi.fn(async ({ remainingMs }: { remainingMs?: number }) => {
      expect(remainingMs).toBeDefined();
      expect(remainingMs!).toBeGreaterThan(0);
      expect(remainingMs!).toBeLessThanOrEqual(5000);
      return true;
    });

    await expect(pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 5, retryDelayMs: 1, maxDurationMs: 5000 })).resolves.toBe(true);
    expect(pollFn).toHaveBeenCalledTimes(1);
  });

  it('stops polling when pollFn throws (error behavior unchanged)', async () => {
    const pollFn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(pollEndpoint({ req: undefined, operation: 'test_op', pollFn, maxRetries: 5, retryDelayMs: 1 })).resolves.toBe(false);
    expect(pollFn).toHaveBeenCalledTimes(1);
  });
});
