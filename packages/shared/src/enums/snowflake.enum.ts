// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Lock strategy for query deduplication
 */
export enum SnowflakeLockStrategy {
  /**
   * In-memory locking using Map (single instance)
   */
  MEMORY = 'memory',

  /**
   * Redis-based distributed locking (multi-instance)
   */
  REDIS = 'redis',
}
