// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Circuit breaker states for Snowflake connection resilience
 */
export enum SnowflakeCircuitState {
  /** Normal operation — all queries pass through to Snowflake */
  CLOSED = 'CLOSED',
  /** Snowflake is unreachable — queries fail immediately without attempting a connection */
  OPEN = 'OPEN',
  /** Cooldown elapsed — one probe query allowed to test if Snowflake recovered */
  HALF_OPEN = 'HALF_OPEN',
}

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
