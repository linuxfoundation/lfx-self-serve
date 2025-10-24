// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Column, DataType } from 'snowflake-sdk';

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
 * Internal lock entry structure for in-memory locking
 */
export interface LockEntry {
  promise: Promise<any>;
  timestamp: number;
  waiters: number;
}
