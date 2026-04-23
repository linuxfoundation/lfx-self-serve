// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Configuration constants for Snowflake integration
 */
export const SNOWFLAKE_CONFIG = {
  /**
   * Default query execution timeout in milliseconds
   */
  DEFAULT_QUERY_TIMEOUT: 60000, // 60 seconds

  /**
   * Connection timeout in milliseconds
   */
  CONNECTION_TIMEOUT: 30000, // 30 seconds

  /**
   * Minimum number of connections in the pool
   */
  MIN_CONNECTIONS: 2,

  /**
   * Maximum number of connections in the pool
   */
  MAX_CONNECTIONS: 20,

  /**
   * Maximum number of clients waiting when pool is exhausted
   */
  MAX_WAITING_CLIENTS: 50,

  /**
   * Timeout for acquiring a connection from the pool in milliseconds
   */
  CONNECTION_ACQUIRE_TIMEOUT: 30000, // 30 seconds

  /**
   * Idle timeout for connections in milliseconds
   */
  IDLE_TIMEOUT: 600000, // 10 minutes

  /**
   * Maximum lifetime for a connection in milliseconds
   */
  MAX_CONNECTION_LIFETIME: 3600000, // 1 hour

  /**
   * Interval for cleaning up stale locks in milliseconds
   */
  LOCK_CLEANUP_INTERVAL: 60000, // 60 seconds

  /**
   * Buffer time added to lock TTL in milliseconds
   */
  LOCK_TTL_BUFFER: 5000, // 5 seconds

  /**
   * Maximum number of retry attempts for transient failures
   */
  MAX_RETRIES: 3,
} as const;

/**
 * Row cap for the pending-surveys query in `getPendingActionSurveys`.
 * @description When the Me-lens path calls this without a `PROJECT_SLUG` predicate, Snowflake
 * would otherwise filter only by `EMAIL`, widening the micro-partition scan for users enrolled
 * in many projects. Pairing the existing `ORDER BY SURVEY_CUTOFF_DATE ASC` with this cap keeps
 * the 50 most-urgent pending surveys — far more than the dashboard surfaces today (≤10 rows)
 * — while bounding compute on the unscoped path. The same cap applies to the scoped path; a
 * single user is extremely unlikely to have >50 open surveys within a single project.
 */
export const PENDING_ACTION_SURVEYS_ROW_LIMIT = 50;
