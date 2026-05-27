// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_IDENTITY_CACHE_MAX_ENTRIES, ORG_IDENTITY_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import { B2bOrgIndexedDoc, OrgIdentityLookupResult, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** Process-wide LRU with TTL — re-insert on `get` to bump recency; lazy TTL check on read. Map preserves insertion order so we avoid pulling lru-cache for a 10k-entry use case. */
class LruWithTtl {
  // CacheEntry is implementation-private — no shared interface needed.
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  public constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number
  ) {}

  public get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  public set(key: string, value: string): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/** Resolves between b2b_org.uid (UUID) and the legacy Salesforce sfid. Cross-request LRU caches; FGA-respecting (uses caller's bearer token on miss). Per research.md D-004. */
export class OrgIdentityResolver {
  private static singletonInstance: OrgIdentityResolver | null = null;

  private readonly sfidToUid = new LruWithTtl(ORG_IDENTITY_CACHE_MAX_ENTRIES, ORG_IDENTITY_CACHE_TTL_MS);
  private readonly uidToSfid = new LruWithTtl(ORG_IDENTITY_CACHE_MAX_ENTRIES, ORG_IDENTITY_CACHE_TTL_MS);
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** Returns the shared singleton; static accessor keeps the constructor available for tests. */
  public static getInstance(): OrgIdentityResolver {
    if (!OrgIdentityResolver.singletonInstance) {
      OrgIdentityResolver.singletonInstance = new OrgIdentityResolver();
    }
    return OrgIdentityResolver.singletonInstance;
  }

  /** UUID → sfid. `sfid` is null when the caller can't see the org or it has no sfid; `cacheHit` reflects LRU vs upstream. */
  public async getSfidByUid(uid: string, req: Request): Promise<OrgIdentityLookupResult<'sfid'>> {
    const cached = this.uidToSfid.get(uid);
    if (cached !== null) return { sfid: cached, cacheHit: true };

    if (!isFilterSafeIdentifier(uid)) {
      logger.warning(req, 'org_identity_resolver_get_sfid', 'Refusing uid → sfid lookup for input outside filter-safe allowlist');
      return { sfid: null, cacheHit: false };
    }

    // Errors propagate so the controller can preserve the 5xx→502 / 404 distinction per FR-020.
    // The MicroserviceProxyService throws MicroserviceError on non-2xx upstream responses;
    // letting it bubble keeps the controller's catch authoritative for status-code mapping.
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'b2b_org',
      filters: [`uid:${uid}`],
    });
    const sfid = response?.resources?.[0]?.data?.sfid ?? null;
    if (sfid) {
      this.uidToSfid.set(uid, sfid);
      this.sfidToUid.set(sfid, uid);
    }
    return { sfid, cacheHit: false };
  }

  /** sfid → UUID. `uid` is null when the caller can't see the org; `cacheHit` reflects LRU vs upstream. */
  public async getUidBySfid(sfid: string, req: Request): Promise<OrgIdentityLookupResult<'uid'>> {
    const cached = this.sfidToUid.get(sfid);
    if (cached !== null) return { uid: cached, cacheHit: true };

    if (!isFilterSafeIdentifier(sfid)) {
      logger.warning(req, 'org_identity_resolver_get_uid', 'Refusing sfid → uid lookup for input outside filter-safe allowlist');
      return { uid: null, cacheHit: false };
    }

    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'b2b_org',
      filters: [`sfid:${sfid}`],
    });
    const uid = response?.resources?.[0]?.id ?? null;
    if (uid) {
      this.sfidToUid.set(sfid, uid);
      this.uidToSfid.set(uid, sfid);
    }
    return { uid, cacheHit: false };
  }
}
