// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SNOWFLAKE_CONFIG } from '@lfx-one/shared/constants';
import { SnowflakeLockStrategy } from '@lfx-one/shared/enums';
import { LockStats, SnowflakePoolStats, SnowflakeQueryOptions, SnowflakeQueryResult } from '@lfx-one/shared/interfaces';
import snowflakeSdk from 'snowflake-sdk';

import { MicroserviceError } from '../errors';
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

    // Generate query hash for deduplication
    const queryHash = this.lockManager.hashQuery(sqlText, binds);

    // Execute with lock to prevent duplicate queries
    return this.lockManager.executeLocked(queryHash, async () => {
      const startTime = Date.now();
      logger.startOperation(undefined, 'snowflake_query', {
        query_hash: queryHash,
        sql_preview: sqlText.substring(0, 100),
        bind_count: binds?.length || 0,
      });

      const pool = await this.ensurePool();

      try {
        // Execute query with parameterized binds
        const result: any = await new Promise((resolve, reject) => {
          pool.use(async (connection: Connection) => {
            connection.execute({
              sqlText,
              binds: binds as any[],
              fetchAsString: options?.fetchAsString,
              complete: (err: SnowflakeError | undefined, stmt: RowStatement, rows: any[] | undefined) => {
                if (err) {
                  reject(err);
                } else {
                  resolve({
                    rows,
                    metadata: stmt.getColumns(),
                    statementHandle: stmt.getQueryId(),
                  });
                }
              },
            });
          });
        });

        const poolStats = this.getPoolStats();

        logger.success(undefined, 'snowflake_query', startTime, {
          query_hash: queryHash,
          row_count: result.rows.length,
          pool_active: poolStats.activeConnections,
          pool_idle: poolStats.idleConnections,
        });

        return result as SnowflakeQueryResult<T>;
      } catch (error) {
        logger.error(undefined, 'snowflake_query', startTime, error instanceof Error ? error : new Error(String(error)), {
          query_hash: queryHash,
          sql_preview: sqlText.substring(0, 100),
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
      }
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

    const privateKey = requiredEnvVars.SNOWFLAKE_API_KEY!;
    logger.debug(undefined, 'snowflake_pool_creation', 'Using SNOWFLAKE_API_KEY from environment variable', {});

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
