// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { logger } from '../services/logger.service';

export interface PollEndpointContext {
  /**
   * Remaining wall-clock budget in ms — set only when `maxDurationMs` is. Callers should pass it
   * as the per-request timeout of any upstream call inside `pollFn` so an in-flight request can
   * never overshoot the deadline (a timeout throws, which ends polling like any other error).
   */
  remainingMs?: number;
}

export interface PollEndpointOptions {
  req: Request | undefined;
  operation: string;
  pollFn: (ctx: PollEndpointContext) => Promise<boolean>;
  maxRetries?: number;
  retryDelayMs?: number;
  /**
   * Wall-clock budget in ms covering request duration plus delays; polling stops once it is
   * spent, even with attempts remaining. Attempt counts alone cannot bound wall-clock time —
   * each `pollFn` call takes as long as its upstream request — so latency-sensitive callers
   * must set this. Omit for attempt-count-only bounding.
   */
  maxDurationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Polls an endpoint until `pollFn` returns `true` (condition met).
 *
 * - `pollFn` returns `true`  → polling resolved, stop retrying.
 * - `pollFn` returns `false` → condition not met, retry after delay.
 * - `pollFn` throws          → unexpected error, stop polling.
 * - deadline passed          → `maxDurationMs` spent (request time counts), stop polling.
 *
 * Returns `true` if polling resolved, `false` if retries or the wall-clock budget were
 * exhausted or an unexpected error occurred.
 */
export async function pollEndpoint(options: PollEndpointOptions): Promise<boolean> {
  const { req, operation, pollFn, maxRetries = 5, retryDelayMs = 2000, maxDurationMs, metadata = {} } = options;
  const deadline = maxDurationMs === undefined ? undefined : Date.now() + maxDurationMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const remainingMs = deadline === undefined ? undefined : deadline - Date.now();
    if (remainingMs !== undefined && remainingMs <= 0) {
      logger.warning(req, operation, 'Poll wall-clock budget exhausted, proceeding anyway', {
        ...metadata,
        attempts_made: attempt - 1,
        max_duration_ms: maxDurationMs,
      });
      return false;
    }

    try {
      const resolved = await pollFn({ remainingMs });

      if (resolved) {
        logger.debug(req, operation, 'Poll resolved successfully', { ...metadata, attempt });
        return true;
      }

      if (attempt < maxRetries) {
        // Never sleep past the deadline — the next attempt's budget check would fire immediately
        // anyway, so a truncated sleep just wastes the caller's time.
        const delayMs = deadline === undefined ? retryDelayMs : Math.min(retryDelayMs, Math.max(deadline - Date.now(), 0));
        logger.debug(req, operation, 'Poll condition not met, retrying', {
          ...metadata,
          attempt,
          next_retry_ms: delayMs,
        });
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        continue;
      }

      logger.warning(req, operation, 'Poll condition not met after max retries, proceeding anyway', {
        ...metadata,
        attempts: maxRetries,
      });
      return false;
    } catch (error: any) {
      logger.warning(req, operation, 'Unexpected error during polling', {
        ...metadata,
        attempt,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  return false;
}

export interface PollUntilIndexedOptions<T> {
  req: Request | undefined;
  operation: string;
  pollFn: () => Promise<T | null>;
  maxRetries?: number;
  retryDelayMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Polls an endpoint until `pollFn` returns a non-null value (resource indexed).
 *
 * - `pollFn` returns `T`    → resource found, stop retrying.
 * - `pollFn` returns `null` → not yet indexed, retry after delay.
 * - `pollFn` throws         → unexpected error, stop polling.
 *
 * Returns the resource if found, `null` if retries were exhausted
 * or an unexpected error occurred.
 */
export async function pollUntilIndexed<T>(options: PollUntilIndexedOptions<T>): Promise<T | null> {
  const { req, operation, pollFn, maxRetries = 5, retryDelayMs = 2000, metadata = {} } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pollFn();

      if (result !== null) {
        logger.debug(req, operation, 'Poll resolved successfully', { ...metadata, attempt });
        return result;
      }

      if (attempt < maxRetries) {
        logger.debug(req, operation, 'Poll condition not met, retrying', {
          ...metadata,
          attempt,
          next_retry_ms: retryDelayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      logger.warning(req, operation, 'Poll condition not met after max retries, proceeding anyway', {
        ...metadata,
        attempts: maxRetries,
      });
      return null;
    } catch (error: unknown) {
      logger.warning(req, operation, 'Unexpected error during polling', {
        ...metadata,
        attempt,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  return null;
}
