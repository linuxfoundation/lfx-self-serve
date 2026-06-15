// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { CachePort } from '@lfx-one/shared/interfaces';
import Redis from 'ioredis';

import { addShutdownHook } from '../utils/shutdown';
import { logger } from './logger.service';

/** Cross-instance, TTL read-through cache backed by Valkey. Fail-soft, lazy-connect; disabled when VALKEY_URL is unset. */
export class ValkeyService implements CachePort {
  private static instance: ValkeyService | null = null;

  private readonly client: Redis | null = null;
  private shutdownHookRegistered = false;

  private constructor() {
    const url = process.env['VALKEY_URL'];
    if (!url) {
      logger.info(undefined, 'valkey_init', 'VALKEY_URL not set — shared cache disabled (direct-fetch fallback)');
      return;
    }

    // Non-blocking: never delays startup/readiness or stalls a request. A rediss:// URL enables TLS.
    const useTls = url.startsWith('rediss://');
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: VALKEY_CACHE.CONNECT_TIMEOUT_MS,
      // TLS terminates at the managed cache endpoint reached through a Kubernetes ExternalName.
      // The server certificate is issued for the cloud provider's host (e.g. *.cache.amazonaws.com),
      // not the in-cluster service name in the URL, so strict hostname verification would always
      // fail and silently leave the cache disabled. Traffic stays inside the VPC (security-group
      // gated, no auth token), so we keep transit encryption but skip hostname verification —
      // mirroring the cluster's socat proxy (openssl-connect ... verify=0).
      ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
    });

    // Connection-level errors must never crash the process; log and continue (cache stays best-effort).
    this.client.on('error', (err: Error) => {
      logger.warning(undefined, 'valkey_client_error', 'Valkey client error — cache operating in degraded (fail-soft) mode', { err });
    });

    this.registerShutdown();
    logger.info(undefined, 'valkey_init', 'Shared Valkey cache enabled');
  }

  /** Singleton accessor — all services share one connection. */
  public static getInstance(): ValkeyService {
    if (!ValkeyService.instance) {
      ValkeyService.instance = new ValkeyService();
    }
    return ValkeyService.instance;
  }

  /** Reset the singleton (primarily for tests). */
  public static resetInstance(): void {
    if (ValkeyService.instance) {
      void ValkeyService.instance.shutdown();
      ValkeyService.instance = null;
    }
  }

  public isEnabled(): boolean {
    return this.client !== null;
  }

  public async getJson<T>(key: string, accept?: (value: unknown) => boolean): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.withTimeout(this.client.get(key));
      if (raw === null) return null;
      const parsed = JSON.parse(raw);
      // A corrupt/legacy/partial entry must degrade to a miss, never surface as a fault to the caller.
      if (accept && !accept(parsed)) {
        logger.warning(undefined, 'valkey_get', 'Cached value failed shape check — treating as miss', { cache_key: ValkeyService.redactKey(key) });
        return null;
      }
      return parsed as T;
    } catch (err) {
      logger.warning(undefined, 'valkey_get', 'Cache read failed — falling back to source', { err, cache_key: ValkeyService.redactKey(key) });
      return null;
    }
  }

  public async setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return false;
    try {
      const serialized = JSON.stringify(value);
      if (Buffer.byteLength(serialized, 'utf8') > VALKEY_CACHE.MAX_VALUE_BYTES) {
        logger.warning(undefined, 'valkey_set', 'Skipping cache write — value exceeds max size', { cache_key: ValkeyService.redactKey(key) });
        return false;
      }
      await this.withTimeout(this.client.set(key, serialized, 'EX', ttlSeconds));
      return true;
    } catch (err) {
      logger.warning(undefined, 'valkey_set', 'Cache write failed — continuing without caching', { err, cache_key: ValkeyService.redactKey(key) });
      return false;
    }
  }

  public async withCache<T>(key: string | null, ttlSeconds: number, fetcher: () => Promise<T>, accept?: (value: unknown) => boolean): Promise<T> {
    // Fail-closed (no principal-bound key) or disabled cache → direct fetch, no read/write.
    if (key === null || !this.client) {
      logger.debug(undefined, 'cache_bypass', 'Cache bypassed (no key or disabled) — fetching directly', {
        cache_key: key ? ValkeyService.redactKey(key) : undefined,
      });
      return fetcher();
    }

    const hit = await this.getJson<T>(key, accept);
    if (hit !== null) {
      logger.debug(undefined, 'cache_hit', 'Cache hit', { cache_key: ValkeyService.redactKey(key) });
      return hit;
    }

    logger.debug(undefined, 'cache_miss', 'Cache miss — fetching from source', { cache_key: ValkeyService.redactKey(key) });
    const result = await fetcher();
    await this.setJson(key, result, ttlSeconds);
    return result;
  }

  /** Closes the connection (best-effort). Registered as a shutdown hook. */
  public async shutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  /**
   * Redacts the per-user tail of a cache key for logging. Keys are `${APP_PREFIX}:${NAMESPACE}:${principal}:…`,
   * so we keep only the first two (non-user) segments and mask the rest — observability without leaking
   * JWT `sub`/usernames into infrastructure logs.
   */
  private static redactKey(key: string): string {
    const parts = key.split(':');
    return parts.length <= 2 ? key : `${parts[0]}:${parts[1]}:***`;
  }

  /** Races a cache op against the per-op cap; a lost race rejects and the caller treats it as a miss. */
  private async withTimeout<T>(op: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('valkey_op_timeout')), VALKEY_CACHE.OP_TIMEOUT_MS);
    });
    try {
      return await Promise.race([op, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private registerShutdown(): void {
    if (this.shutdownHookRegistered) return;
    addShutdownHook(() => this.shutdown());
    this.shutdownHookRegistered = true;
  }
}

/** Shared singleton for convenient usage across services. */
export const valkeyService = ValkeyService.getInstance();
