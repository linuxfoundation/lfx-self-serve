// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Column, DataType } from 'snowflake-sdk';

import type { SnowflakeCircuitState } from '../enums/snowflake.enum';

/**
 * Result of a Snowflake query execution
 * Uses SDK's Column type for metadata
 */
export interface SnowflakeQueryResult<T> {
  rows: T[];
  metadata: Column[];
  statementHandle?: string;
}

/**
 * Options for Snowflake query execution
 * Extends SDK's StatementOption properties
 */
export interface SnowflakeQueryOptions {
  /**
   * Query execution timeout in milliseconds
   */
  timeout?: number;

  /**
   * Array of data types to fetch as strings (for large numbers, etc.)
   */
  fetchAsString?: DataType[];

  /** When true, an "object does not exist" error is expected (e.g. a table not yet created) and is not counted toward the circuit breaker; the query still rejects so the caller can degrade gracefully. */
  expectMissingObject?: boolean;
}

/**
 * Statistics for the Snowflake connection pool
 */
export interface SnowflakePoolStats {
  /**
   * Number of connections currently executing queries
   */
  activeConnections: number;

  /**
   * Number of idle connections available in the pool
   */
  idleConnections: number;

  /**
   * Number of requests waiting for a connection
   */
  waitingRequests: number;

  /**
   * Total number of connections in the pool
   */
  totalConnections: number;
}

/**
 * Statistics for the lock manager (query deduplication)
 */
export interface LockStats {
  /**
   * Number of currently active locks
   */
  activeLocks: number;

  /**
   * Total number of deduplication hits (queries reused)
   */
  totalHits: number;

  /**
   * Total number of deduplication misses (new queries)
   */
  totalMisses: number;

  /**
   * Deduplication effectiveness as a percentage
   */
  deduplicationRate: number;
}

/**
 * Circuit breaker statistics for observability
 */
export interface SnowflakeCircuitStats {
  /** Current circuit state */
  state: SnowflakeCircuitState;
  /** Number of consecutive failures since last success */
  consecutiveFailures: number;
  /** Epoch ms of the last recorded failure (0 if none) */
  lastFailureTime: number;
  /** Milliseconds until the circuit allows a probe request (0 when CLOSED or HALF_OPEN) */
  msUntilProbe: number;
}

/**
 * Internal lock entry structure for in-memory locking
 */
export interface LockEntry {
  promise: Promise<any>;
  timestamp: number;
  waiters: number;
}
