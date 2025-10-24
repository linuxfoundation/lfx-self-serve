// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SNOWFLAKE_CONFIG } from '@lfx-one/shared/constants';
import { SnowflakeLockStrategy } from '@lfx-one/shared/enums';
import { LockEntry, LockStats } from '@lfx-one/shared/interfaces';
import crypto from 'crypto';
import type { Bind } from 'snowflake-sdk';

import { serverLogger } from '../server';

/**
 * Lock manager for query deduplication (fetch lock pattern)
 * Prevents multiple concurrent executions of identical queries
 *
 * Supports two strategies:
 * - memory: In-memory Map for single-instance deployments
 * - redis: Distributed locking for multi-instance deployments (future)
 */
export class LockManager {
  private strategy: SnowflakeLockStrategy;
  private memoryLocks: Map<string, LockEntry>;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private totalHits = 0;
  private totalMisses = 0;

  // Future Redis integration
  // private redisClient?: Redis;

  public constructor(strategy: SnowflakeLockStrategy = SnowflakeLockStrategy.MEMORY) {
    this.strategy = strategy;
    this.memoryLocks = new Map();

    if (strategy === SnowflakeLockStrategy.MEMORY) {
      this.startCleanup();
      serverLogger.info({ strategy: 'memory' }, 'LockManager initialized with in-memory strategy');
    }

    // Future Redis integration
    // if (strategy === SnowflakeLockStrategy.REDIS) {
    //   this.redisClient = new Redis(process.env['REDIS_URL']);
    //   serverLogger.info({ strategy: 'redis' }, 'LockManager initialized with Redis strategy');
    // }
  }

  /**
   * Execute a function with locking to prevent duplicate executions
   * If the same key is already locked, returns the existing Promise
   *
   * @param key - Unique identifier for the operation (typically query hash)
   * @param executor - Function to execute if lock is acquired
   * @returns Result of the executor function
   */
  public async executeLocked<T>(key: string, executor: () => Promise<T>): Promise<T> {
    if (this.strategy === SnowflakeLockStrategy.MEMORY) {
      return this.executeLockedMemory(key, executor);
    }

    // Future Redis implementation
    // if (this.strategy === SnowflakeLockStrategy.REDIS) {
    //   return this.executeLockedRedis(key, executor);
    // }

    throw new Error(`Unsupported lock strategy: ${this.strategy}`);
  }

  /**
   * Generate a deterministic hash for query + binds
   * Used as the key for deduplication
   *
   * @param sqlText - SQL query text
   * @param binds - Query bind parameters (supports Date objects for normalization)
   * @returns SHA256 hash of normalized query
   */
  public hashQuery(sqlText: string, binds?: (Bind | Date)[]): string {
    const normalized = {
      sql: sqlText.trim().toLowerCase().replace(/\s+/g, ' '),
      binds: this.normalizeBinds(binds),
    };

    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  /**
   * Get lock manager statistics
   */
  public getStats(): LockStats {
    const total = this.totalHits + this.totalMisses;

    return {
      activeLocks: this.memoryLocks.size,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      deduplicationRate: total > 0 ? (this.totalHits / total) * 100 : 0,
    };
  }

  /**
   * Cleanup resources
   */
  public shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.memoryLocks.clear();

    // Future Redis cleanup
    // if (this.redisClient) {
    //   this.redisClient.quit();
    // }

    serverLogger.info('LockManager shutdown complete');
  }

  /**
   * Execute with in-memory locking
   * @private
   */
  private async executeLockedMemory<T>(key: string, executor: () => Promise<T>): Promise<T> {
    const existing = this.memoryLocks.get(key);

    if (existing) {
      // Query already executing - wait for it (deduplication hit)
      existing.waiters++;
      this.totalHits++;

      serverLogger.info(
        {
          query_hash: key,
          waiters: existing.waiters,
          is_dedupe_hit: true,
        },
        'Query deduplication hit - reusing existing execution'
      );

      return existing.promise;
    }

    // New query - execute and store (deduplication miss)
    this.totalMisses++;

    const promise = executor();
    const lockEntry: LockEntry = {
      promise,
      timestamp: Date.now(),
      waiters: 0,
    };

    this.memoryLocks.set(key, lockEntry);

    serverLogger.info(
      {
        query_hash: key,
        is_dedupe_hit: false,
      },
      'Executing new query'
    );

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up lock after execution with buffer time
      setTimeout(() => {
        this.memoryLocks.delete(key);
      }, SNOWFLAKE_CONFIG.LOCK_TTL_BUFFER);
    }
  }

  /**
   * Future: Execute with Redis distributed locking
   * @private
   */
  // private async executeLockedRedis<T>(key: string, executor: () => Promise<T>): Promise<T> {
  //   const lockKey = `snowflake:query:${key}`;
  //   const lockValue = uuidv4();
  //   const ttl = SNOWFLAKE_CONFIG.DEFAULT_QUERY_TIMEOUT + SNOWFLAKE_CONFIG.LOCK_TTL_BUFFER;
  //
  //   // Try to acquire lock with SET NX
  //   const acquired = await this.redisClient.set(lockKey, lockValue, 'NX', 'PX', ttl);
  //
  //   if (!acquired) {
  //     // Lock held by another instance - implement wait/poll logic
  //     return this.waitForRedisLock(lockKey, executor);
  //   }
  //
  //   try {
  //     const result = await executor();
  //     return result;
  //   } finally {
  //     // Release lock if we still own it (compare-and-delete)
  //     const script = `
  //       if redis.call("get", KEYS[1]) == ARGV[1] then
  //         return redis.call("del", KEYS[1])
  //       else
  //         return 0
  //       end
  //     `;
  //     await this.redisClient.eval(script, 1, lockKey, lockValue);
  //   }
  // }

  /**
   * Normalize bind parameters for deterministic hashing
   * Converts Date objects to ISO strings for consistent comparison
   * @private
   */
  private normalizeBinds(binds?: (Bind | Date)[]): Bind[] {
    if (!binds) return [];

    return binds.map((bind) => {
      // Convert dates to ISO strings for consistent comparison
      if (bind instanceof Date) {
        return bind.toISOString();
      }
      return bind;
    });
  }

  /**
   * Start periodic cleanup of stale locks
   * @private
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const maxAge = SNOWFLAKE_CONFIG.DEFAULT_QUERY_TIMEOUT + SNOWFLAKE_CONFIG.LOCK_TTL_BUFFER;

      for (const [key, entry] of this.memoryLocks.entries()) {
        if (now - entry.timestamp > maxAge) {
          this.memoryLocks.delete(key);
          serverLogger.info(
            {
              query_hash: key,
              age_ms: now - entry.timestamp,
            },
            'Cleaned up stale lock'
          );
        }
      }
    }, SNOWFLAKE_CONFIG.LOCK_CLEANUP_INTERVAL);
  }
}
