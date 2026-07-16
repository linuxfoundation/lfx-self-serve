// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_QUERY_SUMMARY,
  ATTR_DB_SYSTEM_NAME,
  ATTR_SERVER_ADDRESS,
} from '@opentelemetry/semantic-conventions';
import { ATTR_DB_RESPONSE_RETURNED_ROWS } from '@opentelemetry/semantic-conventions/incubating';
import { SNOWFLAKE_CONFIG } from '@lfx-one/shared/constants';
import { SnowflakeCircuitState, SnowflakeLockStrategy } from '@lfx-one/shared/enums';
import { LockStats, SnowflakeCircuitStats, SnowflakePoolStats, SnowflakeQueryOptions, SnowflakeQueryResult } from '@lfx-one/shared/interfaces';
import crypto from 'crypto';
import snowflakeSdk from 'snowflake-sdk';

import { MicroserviceError } from '../errors';
import { tracer } from '../server-tracer';
import { LockManager } from '../utils/lock-manager';
import { logger } from './logger.service';

import type { Bind, Connection, ConnectionOptions, LogLevel, Pool, PoolOptions, RowStatement, SnowflakeError } from 'snowflake-sdk';
const { createPool } = snowflakeSdk;

/**
 * Service for executing read-only queries against Snowflake DBT
 *
 * Features:
 * - Connection pooling for efficient resource management
 * - Query deduplication to prevent duplicate execution
 * - SQL injection protection via parameterized queries
 * - Read-only enforcement at multiple layers
 * - Private key JWT authentication
 * - Singleton pattern for shared connection pool across all services
 */
export class SnowflakeService {
  private static instance: SnowflakeService | null = null;
  private pool: Pool<Connection> | null = null;
  private poolPromise: Promise<Pool<Connection>> | null = null;
  private lockManager: LockManager;

  // === Circuit Breaker ===
  private circuitState: SnowflakeCircuitState = SnowflakeCircuitState.CLOSED;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  // True while a HALF_OPEN probe is in-flight; subsequent requests fail fast
  // rather than stampeding Snowflake with multiple concurrent probes.
  private probeInFlight = false;

  /**
   * Get the singleton instance of SnowflakeService
   * All services should use this method to share the same connection pool
   */
  public static getInstance(): SnowflakeService {
    if (!SnowflakeService.instance) {
      SnowflakeService.instance = new SnowflakeService();
      // Safe logging - logger may not be initialized during SSR build
      try {
        logger.debug(undefined, 'snowflake_singleton', 'SnowflakeService singleton instance created', {});
      } catch {
        // Silently ignore logging errors during SSR build
      }
    }
    return SnowflakeService.instance;
  }

  /**
   * Shuts down the singleton only if it was ever initialized.
   * Safe to call from server shutdown — avoids creating a pool just to tear it down.
   */
  public static shutdownIfInitialized(): Promise<void> {
    if (!SnowflakeService.instance) return Promise.resolve();
    return SnowflakeService.instance.shutdown();
  }

  /**
   * Reset the singleton instance (primarily for testing)
   */
  public static resetInstance(): void {
    if (SnowflakeService.instance) {
      SnowflakeService.instance.shutdown().catch((err) => {
        logger.error(undefined, 'snowflake_reset', Date.now(), err);
      });
      SnowflakeService.instance = null;
    }
  }

  public static isMissingObjectError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /does not exist or not authorized/i.test(message);
  }

  private constructor() {
    // Configure Snowflake SDK logging (defaults to ERROR to minimize verbose logs)
    // Valid levels: 'OFF', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'
    const logLevel = (process.env['SNOWFLAKE_LOG_LEVEL'] || 'ERROR') as LogLevel;
    snowflakeSdk.configure({ logLevel });

    // Initialize lock manager with configured strategy
    const lockStrategy = (process.env['SNOWFLAKE_LOCK_STRATEGY'] || 'memory') as SnowflakeLockStrategy;
    this.lockManager = new LockManager(lockStrategy);
  }

  /**
   * Execute a read-only query with deduplication and connection pooling
   *
   * @param sqlText - SQL query text with ? placeholders for bind parameters
   * @param binds - Array of bind parameters (prevents SQL injection, Date objects will be converted to ISO strings)
   * @param options - Query execution options (timeout, fetchAsString)
   * @returns Query result with rows and metadata
   */
  public async execute<T = any>(sqlText: string, binds?: (Bind | Date)[], options?: SnowflakeQueryOptions): Promise<SnowflakeQueryResult<T>> {
    // Validate that query is read-only
    this.validateReadOnlyQuery(sqlText);

    // Fail fast if the circuit is OPEN (Snowflake is known to be unreachable)
    this.checkCircuit();

    // Generate query hash for deduplication
    const queryHash = this.lockManager.hashQuery(sqlText, binds);

    const sqlOp = sqlText.trim().split(/\s+/)[0]?.toUpperCase() || 'QUERY';
    // Strip string literals from SQL for span attributes to avoid PII leaks
    const sanitizedSql = sqlText.replace(/'[^']*'/g, '?').substring(0, 100);

    // Lock first to deduplicate, then open span only for the executing query
    return this.lockManager.executeLocked(queryHash, async () => {
      return tracer.startActiveSpan(
        `Snowflake ${sqlOp}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            [ATTR_DB_SYSTEM_NAME]: 'snowflake',
            [ATTR_DB_OPERATION_NAME]: sqlOp,
            [ATTR_DB_QUERY_SUMMARY]: sanitizedSql,
            [ATTR_DB_NAMESPACE]: process.env['SNOWFLAKE_DATABASE'] || '',
            [ATTR_SERVER_ADDRESS]: process.env['SNOWFLAKE_ACCOUNT'] || '',
          },
        },
        async (span) => {
          logger.debug(undefined, 'snowflake_query', 'Executing query', {
            query_hash: queryHash,
            sql_preview: sqlText.substring(0, 100).replace(/\s+/g, ' ').trim(),
            bind_count: binds?.length || 0,
            circuit_state: this.circuitState,
          });

          const startTime = Date.now();

          try {
            // ensurePool is inside try so a pool-creation failure during a HALF_OPEN
            // probe is caught by the catch below and calls recordFailure(), preventing
            // probeInFlight from getting stuck.
            const pool = await this.ensurePool();
            const queryTimeoutMs = options?.timeout ?? SNOWFLAKE_CONFIG.DEFAULT_QUERY_TIMEOUT;

            // Race the full pool.use() + query execution against a per-query timeout.
            // This bounds event-loop exposure to a slow/unresponsive Snowflake regardless
            // of the pool's own acquire timeout — whichever fires first wins.
            //
            // The pool.use callback returns a Promise that settles inside the Snowflake
            // complete callback so generic-pool holds the connection until the statement
            // finishes, keeping pool accounting (max, maxWaitingClients, acquireTimeout)
            // accurate for in-flight queries.
            const executePromise = pool.use(
              (connection: Connection) =>
                new Promise<SnowflakeQueryResult<T>>((resolve, reject) => {
                  connection.execute({
                    sqlText,
                    binds: binds as any[],
                    fetchAsString: options?.fetchAsString,
                    complete: (err: SnowflakeError | undefined, stmt: RowStatement, rows: any[] | undefined) => {
                      if (err) {
                        reject(err);
                      } else {
                        resolve({
                          rows: rows ?? [],
                          metadata: stmt.getColumns() ?? [],
                          statementHandle: stmt.getQueryId(),
                        });
                      }
                    },
                  });
                })
            );

            let timeoutHandle: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => reject(new Error(`Snowflake query timed out after ${queryTimeoutMs}ms`)), queryTimeoutMs);
            });

            let result: SnowflakeQueryResult<T>;
            try {
              result = await Promise.race([executePromise, timeoutPromise]);
            } finally {
              clearTimeout(timeoutHandle!);
            }

            const rowCount = Array.isArray(result?.rows) ? result.rows.length : 0;
            const poolStats = this.getPoolStats();

            span.setStatus({ code: SpanStatusCode.OK });
            span.setAttribute(ATTR_DB_RESPONSE_RETURNED_ROWS, rowCount);

            this.recordSuccess();

            logger.debug(undefined, 'snowflake_query', 'Query completed', {
              query_hash: queryHash,
              row_count: rowCount,
              duration_ms: Date.now() - startTime,
              pool_active: poolStats.activeConnections,
              pool_idle: poolStats.idleConnections,
            });

            return result;
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            span.recordException(error instanceof Error ? error : new Error(String(error)));

            const expectedMissing = options?.expectMissingObject === true && SnowflakeService.isMissingObjectError(error);
            if (expectedMissing) {
              this.recordSuccess();
            } else {
              this.recordFailure();
            }

            logger.error(undefined, 'snowflake_query', startTime, error instanceof Error ? error : new Error(String(error)), {
              query_hash: queryHash,
              sql_preview: sqlText.substring(0, 100).replace(/\s+/g, ' ').trim(),
              circuit_state: this.circuitState,
              consecutive_failures: this.consecutiveFailures,
            });

            // Wrap Snowflake SDK errors in MicroserviceError for proper error handling
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new MicroserviceError(`Snowflake query execution failed: ${errorMessage}`, 500, 'SNOWFLAKE_QUERY_ERROR', {
              operation: 'snowflake_query_execution',
              service: 'snowflake',
              errorBody: {
                query_hash: queryHash,
                duration_ms: Date.now() - startTime,
              },
              originalError: error instanceof Error ? error : undefined,
            });
          } finally {
            span.end();
          }
        }
      );
    });
  }

  /**
   * Check if service is connected to Snowflake
   */
  public isConnected(): boolean {
    return this.pool !== null;
  }

  /**
   * Get connection pool statistics
   *
   * Maps generic-pool properties to our interface:
   * - borrowed → activeConnections (resources currently in use)
   * - available → idleConnections (unused resources in pool)
   * - pending → waitingRequests (callers waiting for a resource)
   * - size → totalConnections (total resources: borrowed + available)
   */
  public getPoolStats(): SnowflakePoolStats {
    if (!this.pool) {
      return {
        activeConnections: 0,
        idleConnections: 0,
        waitingRequests: 0,
        totalConnections: 0,
      };
    }

    return {
      activeConnections: this.pool.borrowed || 0,
      idleConnections: this.pool.available || 0,
      waitingRequests: this.pool.pending || 0,
      totalConnections: this.pool.size || 0,
    };
  }

  /**
   * Get lock manager statistics
   */
  public getLockStats(): LockStats {
    return this.lockManager.getStats();
  }

  /**
   * Get circuit breaker statistics for observability
   */
  public getCircuitStats(): SnowflakeCircuitStats {
    const msUntilProbe =
      this.circuitState === SnowflakeCircuitState.OPEN
        ? Math.max(0, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - (Date.now() - this.lastFailureTime))
        : 0;

    return {
      state: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      msUntilProbe,
    };
  }

  /**
   * Gracefully shutdown the service
   */
  public async shutdown(): Promise<void> {
    const startTime = logger.startOperation(undefined, 'snowflake_shutdown');

    // Shutdown lock manager
    this.lockManager.shutdown();

    // Drain connection pool
    if (this.pool) {
      try {
        // Race drain operation against timeout
        const drainPromise = this.pool.drain();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Pool drain timeout after 30 seconds')), 30000);
        });

        await Promise.race([drainPromise, timeoutPromise]);
        logger.success(undefined, 'snowflake_shutdown', startTime, {
          message: 'Snowflake connection pool drained successfully',
        });
      } catch (error) {
        logger.error(undefined, 'snowflake_shutdown', startTime, error instanceof Error ? error : new Error(String(error)));
      }

      this.pool = null;
    }
  }

  /**
   * Ensure connection pool exists with lazy initialization
   * @private
   */
  private async ensurePool(): Promise<Pool<Connection>> {
    // Return existing pool if valid
    if (this.pool) {
      return this.pool;
    }

    // If already creating pool, wait for it
    if (this.poolPromise) {
      return this.poolPromise;
    }

    // Create new pool with thread safety
    this.poolPromise = this.createPool();

    try {
      this.pool = await this.poolPromise;
      return this.pool;
    } catch (error) {
      // Reset promise on failure
      this.poolPromise = null;
      throw error;
    } finally {
      // Reset promise after completion
      this.poolPromise = null;
    }
  }

  /**
   * Create a new Snowflake connection pool
   * @private
   */
  private async createPool(): Promise<Pool<Connection>> {
    const startTime = logger.startOperation(undefined, 'snowflake_pool_creation');

    // Validate all required environment variables
    const requiredEnvVars = {
      SNOWFLAKE_ACCOUNT: process.env['SNOWFLAKE_ACCOUNT'],
      SNOWFLAKE_USER: process.env['SNOWFLAKE_USER'],
      SNOWFLAKE_ROLE: process.env['SNOWFLAKE_ROLE'],
      SNOWFLAKE_DATABASE: process.env['SNOWFLAKE_DATABASE'],
      SNOWFLAKE_WAREHOUSE: process.env['SNOWFLAKE_WAREHOUSE'],
      SNOWFLAKE_API_KEY: process.env['SNOWFLAKE_API_KEY'],
    };

    const missingVars = Object.entries(requiredEnvVars)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missingVars.length > 0) {
      const errorMessage = `Snowflake configuration error: Missing required environment variables: ${missingVars.join(', ')}`;
      logger.error(undefined, 'snowflake_pool_creation', startTime, new Error(errorMessage), {
        missing_variables: missingVars,
        all_required: Object.keys(requiredEnvVars),
      });
      throw new MicroserviceError(errorMessage, 500, 'SNOWFLAKE_CONFIG_ERROR', {
        operation: 'snowflake_pool_creation',
        service: 'snowflake',
        errorBody: {
          missing_variables: missingVars,
          all_required: Object.keys(requiredEnvVars),
        },
      });
    }

    const rawKey = requiredEnvVars.SNOWFLAKE_API_KEY!;
    const passphrase = process.env['SNOWFLAKE_PRIVATE_KEY_PASSPHRASE'];
    let privateKey: string;

    if (passphrase) {
      // Decrypt the encrypted private key in memory before passing to the SDK
      const privateKeyObject = crypto.createPrivateKey({ key: rawKey, format: 'pem', passphrase });
      privateKey = privateKeyObject.export({ format: 'pem', type: 'pkcs8' }) as string;
      logger.debug(undefined, 'snowflake_pool_creation', 'Using encrypted SNOWFLAKE_API_KEY with passphrase', {});
    } else {
      privateKey = rawKey;
      logger.debug(undefined, 'snowflake_pool_creation', 'Using SNOWFLAKE_API_KEY from environment variable', {});
    }

    // Pool configuration
    const minConnections = Number(process.env['SNOWFLAKE_MIN_CONNECTIONS']) || SNOWFLAKE_CONFIG.MIN_CONNECTIONS;
    const maxConnections = Number(process.env['SNOWFLAKE_MAX_CONNECTIONS']) || SNOWFLAKE_CONFIG.MAX_CONNECTIONS;

    const connectionOptions: ConnectionOptions = {
      account: requiredEnvVars.SNOWFLAKE_ACCOUNT!,
      username: requiredEnvVars.SNOWFLAKE_USER!,
      role: requiredEnvVars.SNOWFLAKE_ROLE!,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey: privateKey,
      schema: 'PUBLIC',
      database: requiredEnvVars.SNOWFLAKE_DATABASE!,
      warehouse: requiredEnvVars.SNOWFLAKE_WAREHOUSE!,
      timeout: SNOWFLAKE_CONFIG.CONNECTION_TIMEOUT,
    };

    const poolOptions: PoolOptions = {
      max: maxConnections,
      min: minConnections,
      // Validate connections before borrowing from pool to catch terminated connections
      testOnBorrow: true,
      // Check for idle connections every 30 seconds
      evictionRunIntervalMillis: 30000,
      // Close idle connections after 10 minutes
      idleTimeoutMillis: SNOWFLAKE_CONFIG.IDLE_TIMEOUT,
      // Maximum waiting clients when pool is exhausted
      maxWaitingClients: Number(process.env['SNOWFLAKE_MAX_WAITING_CLIENTS']) || SNOWFLAKE_CONFIG.MAX_WAITING_CLIENTS,
      // Timeout for acquiring a connection from pool
      acquireTimeoutMillis: SNOWFLAKE_CONFIG.CONNECTION_ACQUIRE_TIMEOUT,
    };

    try {
      const pool = createPool(connectionOptions, poolOptions);

      logger.success(undefined, 'snowflake_pool_creation', startTime, {
        min_connections: minConnections,
        max_connections: maxConnections,
        idle_timeout_ms: SNOWFLAKE_CONFIG.IDLE_TIMEOUT,
        acquire_timeout_ms: SNOWFLAKE_CONFIG.CONNECTION_ACQUIRE_TIMEOUT,
        test_on_borrow: true,
        account: requiredEnvVars.SNOWFLAKE_ACCOUNT,
        warehouse: requiredEnvVars.SNOWFLAKE_WAREHOUSE,
        database: requiredEnvVars.SNOWFLAKE_DATABASE,
      });

      return pool;
    } catch (error) {
      logger.error(undefined, 'snowflake_pool_creation', startTime, error instanceof Error ? error : new Error(String(error)), {
        account: requiredEnvVars.SNOWFLAKE_ACCOUNT,
      });
      // Wrap SDK errors in MicroserviceError for proper error handling
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new MicroserviceError(`Snowflake connection pool creation failed: ${errorMessage}`, 500, 'SNOWFLAKE_CONNECTION_ERROR', {
        operation: 'snowflake_pool_creation',
        service: 'snowflake',
        errorBody: {
          account: requiredEnvVars.SNOWFLAKE_ACCOUNT,
        },
        originalError: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Throw immediately if the circuit is OPEN and the reset timeout hasn't elapsed.
   * Transitions OPEN → HALF_OPEN once the timeout passes, allowing one probe query.
   * @private
   */
  private checkCircuit(): void {
    if (this.circuitState === SnowflakeCircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS) {
        const secondsLeft = Math.ceil((SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - elapsed) / 1000);
        throw new MicroserviceError(`Snowflake circuit breaker OPEN — retrying in ${secondsLeft}s`, 503, 'SNOWFLAKE_CIRCUIT_OPEN', {
          operation: 'circuit_breaker_check',
          service: 'snowflake',
          errorBody: {
            state: this.circuitState,
            consecutive_failures: this.consecutiveFailures,
            seconds_until_probe: secondsLeft,
          },
        });
      }
      this.circuitState = SnowflakeCircuitState.HALF_OPEN;
      logger.info(undefined, 'snowflake_circuit_breaker', 'Circuit transitioned to HALF_OPEN — probing connection', {
        consecutive_failures: this.consecutiveFailures,
      });
    }

    // Allow only one concurrent probe in HALF_OPEN — reject additional callers until
    // the in-flight probe settles so we don't stampede Snowflake during recovery.
    if (this.circuitState === SnowflakeCircuitState.HALF_OPEN && this.probeInFlight) {
      throw new MicroserviceError('Snowflake circuit breaker HALF_OPEN — probe already in flight', 503, 'SNOWFLAKE_CIRCUIT_OPEN', {
        operation: 'circuit_breaker_check',
        service: 'snowflake',
        errorBody: { state: this.circuitState },
      });
    }

    if (this.circuitState === SnowflakeCircuitState.HALF_OPEN) {
      this.probeInFlight = true;
    }
  }

  /**
   * Record a successful query — close the circuit if it was HALF_OPEN.
   * @private
   */
  private recordSuccess(): void {
    if (this.circuitState !== SnowflakeCircuitState.CLOSED) {
      logger.info(undefined, 'snowflake_circuit_breaker', 'Circuit closed — Snowflake connection recovered', {
        consecutive_failures: this.consecutiveFailures,
      });
    }
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
    this.circuitState = SnowflakeCircuitState.CLOSED;
  }

  /**
   * Record a failed query — open the circuit after reaching the failure threshold,
   * or immediately if the circuit was already HALF_OPEN (probe failed).
   * @private
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.probeInFlight = false;

    const shouldOpen = this.circuitState === SnowflakeCircuitState.HALF_OPEN || this.consecutiveFailures >= SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD;

    if (shouldOpen) {
      this.circuitState = SnowflakeCircuitState.OPEN;
      logger.error(
        undefined,
        'snowflake_circuit_breaker',
        this.lastFailureTime,
        new Error('Snowflake circuit breaker OPENED — failing fast until recovery probe succeeds'),
        {
          consecutive_failures: this.consecutiveFailures,
          threshold: SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
          reset_timeout_ms: SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
        }
      );
    }
  }

  /**
   * Validate that a query is read-only
   * Blocks INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, MERGE anywhere in query
   * This includes write operations inside CTEs (Common Table Expressions)
   * @private
   */
  private validateReadOnlyQuery(sqlText: string): void {
    const normalizedSql = sqlText.trim().toUpperCase();

    // Block write operations ANYWHERE in the query (including inside CTEs)
    // Using \b for word boundaries to avoid false positives in identifiers
    const writePatterns = [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+/i,
      /\bDELETE\s+FROM\b/i,
      /\bDROP\s+/i,
      /\bCREATE\s+/i,
      /\bALTER\s+/i,
      /\bTRUNCATE\s+/i,
      /\bMERGE\s+INTO\b/i,
      /\bGRANT\s+/i,
      /\bREVOKE\s+/i,
      /\bEXECUTE\s+/i,
      /\bCALL\s+/i,
    ];

    for (const pattern of writePatterns) {
      if (pattern.test(normalizedSql)) {
        logger.warning(undefined, 'snowflake_validation', 'Blocked query with write operation (including CTEs)', {
          sql_preview: normalizedSql.substring(0, 100),
          matched_pattern: pattern.toString(),
        });
        throw new Error('Only SELECT queries are allowed. Write operations detected.');
      }
    }

    // Ensure query starts with SELECT or WITH (for CTEs)
    if (!/^\s*SELECT\b/i.test(normalizedSql) && !/^\s*WITH\b/i.test(normalizedSql)) {
      logger.warning(undefined, 'snowflake_validation', 'Blocked non-SELECT query (not starting with SELECT or WITH)', {
        sql_preview: normalizedSql.substring(0, 100),
      });
      throw new Error('Only SELECT queries are allowed');
    }
  }
}
