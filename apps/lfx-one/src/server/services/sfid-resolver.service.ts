// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_IDENTITY_CACHE_MAX_ENTRIES,
  ORG_IDENTITY_CACHE_TTL_MS,
  ORG_SFID_LOOKUP_BATCH_CONCURRENCY,
  ORG_SFID_LOOKUP_NATS_SUBJECT,
  ORG_SFID_LOOKUP_NATS_TIMEOUT_MS,
  SALESFORCE_ID_SUFFIX_CHARS,
} from '@lfx-one/shared/constants';
import { UuidToSfidNatsResponse } from '@lfx-one/shared/interfaces';

import { logger } from './logger.service';
import { NatsService } from './nats.service';

/** Append the standard 3-char case-encoding suffix to produce the portable 18-char Salesforce ID. */
function sfid15To18(id15: string): string {
  if (id15.length !== 15) return id15;
  let result = id15;
  for (let group = 0; group < 3; group++) {
    let bits = 0;
    for (let j = 0; j < 5; j++) {
      const ch = id15.charCodeAt(group * 5 + j);
      if (ch >= 65 && ch <= 90) bits |= 1 << j;
    }
    result += SALESFORCE_ID_SUFFIX_CHARS[bits];
  }
  return result;
}

/** Resolves UUID v8 org uids to 18-char Salesforce IDs via the member-service NATS RPC `lfx.member.uuid-to-sfid.lookup`. */
export class SfidResolverService {
  /** Process-wide uid→sfid memo (sfids are stable; org renames don't change them). Spares typeahead `resolveBatch` from re-hitting NATS on every keystroke. Only successful resolutions are cached. */
  private static readonly sfidCache = new Map<string, { sfid: string; expiresAt: number }>();

  private readonly natsService: NatsService;

  public constructor() {
    this.natsService = new NatsService();
  }

  /** Resolve a single uid to its 18-char sfid via NATS RPC. Returns null on failure. */
  public async resolve(uid: string): Promise<string | null> {
    return this.resolveViaNats(uid);
  }

  /** Resolve a batch of uids via NATS RPC through a bounded worker pool (`ORG_SFID_LOOKUP_BATCH_CONCURRENCY`) so a large cascading set never bursts thousands of concurrent RPCs. Returns a uid→sfid lookup (failed/empty resolutions are omitted). */
  public async resolveBatch(uids: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    if (uids.length === 0) return results;

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < uids.length) {
        const uid = uids[cursor++];
        const sfid = await this.resolveViaNats(uid);
        if (sfid) results.set(uid, sfid);
      }
    };

    const poolSize = Math.min(ORG_SFID_LOOKUP_BATCH_CONCURRENCY, uids.length);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    return results;
  }

  private async resolveViaNats(uid: string): Promise<string | null> {
    const cached = SfidResolverService.getCached(uid);
    if (cached) return cached;

    try {
      const codec = this.natsService.getCodec();
      const payload = JSON.stringify({ uuid: uid });
      const response = await this.natsService.request(ORG_SFID_LOOKUP_NATS_SUBJECT, codec.encode(payload), {
        timeout: ORG_SFID_LOOKUP_NATS_TIMEOUT_MS,
      });
      const decoded = codec.decode(response.data);
      const parsed: UuidToSfidNatsResponse = JSON.parse(decoded);

      if (parsed.error || !parsed.sfid) {
        return null;
      }

      const sfid = sfid15To18(parsed.sfid);
      SfidResolverService.setCached(uid, sfid);
      return sfid;
    } catch (error) {
      logger.debug(undefined, 'sfid_resolver', 'NATS uuid-to-sfid lookup failed', {
        uid,
        err: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Returns the cached sfid for a uid, or null on miss/expiry (lazy TTL eviction). */
  private static getCached(uid: string): string | null {
    const entry = SfidResolverService.sfidCache.get(uid);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      SfidResolverService.sfidCache.delete(uid);
      return null;
    }
    return entry.sfid;
  }

  /** Stores a uid→sfid mapping, evicting the oldest entry (insertion order) when over the cap. */
  private static setCached(uid: string, sfid: string): void {
    const cache = SfidResolverService.sfidCache;
    if (!cache.has(uid) && cache.size >= ORG_IDENTITY_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(uid, { sfid, expiresAt: Date.now() + ORG_IDENTITY_CACHE_TTL_MS });
  }
}
