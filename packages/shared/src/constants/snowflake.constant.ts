// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Configuration constants for Snowflake integration
 */
export const SNOWFLAKE_CONFIG = {
  /**
   * Per-query execution timeout in milliseconds.
   * Covers both pool acquisition wait and query execution time.
   * Reduced from 60s to 15s so a single slow query fails fast instead of
   * tying up the event loop and downstream callers.
   */
  DEFAULT_QUERY_TIMEOUT: 15000, // 15 seconds

  /**
   * Connection timeout in milliseconds
   */
  CONNECTION_TIMEOUT: 30000, // 30 seconds

  /**
   * Minimum connections kept warm in the pool.
   * Set to 0 so the pool only creates connections on demand — no eager
   * warm-up attempts at server start when Snowflake may be unreachable.
   */
  MIN_CONNECTIONS: 0,

  /**
   * Maximum number of connections in the pool
   */
  MAX_CONNECTIONS: 20,

  /**
   * Maximum requests queued when the pool is exhausted.
   * Reduced from 50 to 10 so the server fails fast under sustained Snowflake
   * outages instead of holding 50 requests for up to 30s each.
   */
  MAX_WAITING_CLIENTS: 10,

  /**
   * Timeout for acquiring a connection from the pool in milliseconds.
   * Halved from 30s to 15s — pairs with DEFAULT_QUERY_TIMEOUT so the
   * total worst-case per-request wait stays bounded at ~15s.
   */
  CONNECTION_ACQUIRE_TIMEOUT: 15000, // 15 seconds

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

  /**
   * Number of consecutive failures before the circuit breaker opens.
   * Once open, all Snowflake calls fail immediately (503) without attempting
   * a connection, preventing event-loop saturation during outages.
   */
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,

  /**
   * How long the circuit stays OPEN before allowing a probe request (HALF_OPEN).
   * If the probe succeeds the circuit closes; if it fails the timer resets.
   */
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: 60000, // 60 seconds
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
