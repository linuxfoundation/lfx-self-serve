// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { logger } from '../services/logger.service';

export interface PollEndpointOptions {
  req: Request | undefined;
  operation: string;
  pollFn: () => Promise<boolean>;
  maxRetries?: number;
  retryDelayMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Polls an endpoint until `pollFn` returns `true` (condition met).
 *
 * - `pollFn` returns `true`  → polling resolved, stop retrying.
 * - `pollFn` returns `false` → condition not met, retry after delay.
 * - `pollFn` throws          → unexpected error, stop polling.
 *
 * Returns `true` if polling resolved, `false` if retries were exhausted
 * or an unexpected error occurred.
 */
export async function pollEndpoint(options: PollEndpointOptions): Promise<boolean> {
  const { req, operation, pollFn, maxRetries = 5, retryDelayMs = 2000, metadata = {} } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resolved = await pollFn();

      if (resolved) {
        logger.debug(req, operation, 'Poll resolved successfully', { ...metadata, attempt });
        return true;
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
