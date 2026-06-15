// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { ProjectMembershipDoc, QueryServiceResponse, ResolvedMembershipContext } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier, isFilterSafeUsername } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { valkeyService } from './valkey.service';

// Resolves an org UUID + foundation slug to the active project_membership context.

export class OrgMembershipResolverService {
  // Membership statuses that count as active for this page (membership-level).
  private static readonly activeMembershipStatuses = new Set(['active', 'purchased']);
  // Slug-scoped project_membership queries fit in one page.
  private static readonly membershipsPageSize = 500;

  // Per-process in-flight de-dup, keyed by the principal-bound cache key so it never shares a result
  // across users. The authoritative cross-instance cache is the shared Valkey store.
  private static readonly membershipsInFlight = new Map<string, Promise<ProjectMembershipDoc[]>>();

  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  // Resolves active membership context for a specific org UUID and foundation slug.
  public async resolveContext(req: Request, b2bOrgUid: string, foundationSlug: string): Promise<ResolvedMembershipContext | null> {
    const slug = (foundationSlug ?? '').trim();
    if (!slug) return null;

    if (!b2bOrgUid || !isFilterSafeIdentifier(b2bOrgUid)) {
      logger.warning(req, 'resolve_membership_context', 'Refusing membership lookup for missing/non-filter-safe b2b_org_uid');
      return null;
    }
    if (!isFilterSafeIdentifier(slug)) {
      logger.warning(req, 'resolve_membership_context', 'Refusing membership lookup for non-filter-safe foundation slug');
      return null;
    }

    const memberships = await this.fetchMembershipsBySlug(req, b2bOrgUid, slug);

    const candidates = memberships.filter((m) => OrgMembershipResolverService.activeMembershipStatuses.has((m.status ?? '').toLowerCase()));

    if (candidates.length === 0) {
      logger.info(req, 'resolve_membership_context', 'No active membership for org+foundation slug', {
        b2b_org_uid: b2bOrgUid,
        foundation_slug: slug,
        membership_count: memberships.length,
      });
      return null;
    }

    candidates.sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''));
    const chosen = candidates[0];

    if (!chosen.uid || !isFilterSafeIdentifier(chosen.uid)) {
      logger.warning(req, 'resolve_membership_context', 'Refusing membership context for non-filter-safe membership uid');
      return null;
    }

    return {
      b2bOrgUid,
      membershipUid: chosen.uid,
      projectUid: chosen.project_uid ? chosen.project_uid : null,
    };
  }

  // Fetches slug-scoped project_membership documents for one org UUID, served through the shared
  // Valkey cache keyed by the authorization principal (the effective username/nickname from
  // getEffectiveUsername(req)) so entries are strictly per-user. When the principal can't be
  // resolved we fail closed: fetch fresh with no cache read/write.
  public async fetchMembershipsBySlug(req: Request, b2bOrgUid: string, foundationSlug: string): Promise<ProjectMembershipDoc[]> {
    const slug = (foundationSlug ?? '').trim();
    if (!b2bOrgUid || !isFilterSafeIdentifier(b2bOrgUid) || !slug || !isFilterSafeIdentifier(slug)) return [];

    const cacheKey = OrgMembershipResolverService.buildCacheKey(req, b2bOrgUid, slug);

    // Fail-closed: without a principal-bound key we never touch a shared cache entry.
    if (!cacheKey) {
      return this.runMembershipFetch(req, b2bOrgUid, slug);
    }

    // Per-process coalescing of concurrent identical reads (keyed by the principal-bound key).
    const inFlight = OrgMembershipResolverService.membershipsInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    // Shared, cross-instance read-through cache; fail-soft (cache faults fall back to a direct fetch).
    // The shape guard rejects a corrupt/legacy cache entry as a miss so a bad value can never reach
    // resolveContext()'s .filter() (e.g. a `null` element throwing on `.status`) and turn a cache hit
    // into a 500.
    const promise = valkeyService.withCache(
      cacheKey,
      VALKEY_CACHE.ORG_MEMBERSHIP_TTL_SECONDS,
      () => this.runMembershipFetch(req, b2bOrgUid, slug),
      OrgMembershipResolverService.isMembershipDocArray
    );

    OrgMembershipResolverService.membershipsInFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      OrgMembershipResolverService.membershipsInFlight.delete(cacheKey);
    }
  }

  // Accepts only a clean array of non-null membership objects. A malformed cache entry (nullish or
  // non-object elements) degrades to a miss + refetch instead of throwing downstream in resolveContext().
  private static isMembershipDocArray(value: unknown): value is ProjectMembershipDoc[] {
    return Array.isArray(value) && value.every((el) => el !== null && typeof el === 'object');
  }

  // Builds the principal-bound, namespaced, versioned cache key, or null when the caller's identity
  // cannot be resolved (fail-closed). The effective username is impersonation-aware and matches the
  // principal the query-service FGA-filters on downstream, so cache identity == authz identity.
  private static buildCacheKey(req: Request, b2bOrgUid: string, slug: string): string | null {
    const username = getEffectiveUsername(req);
    // Fail-closed: an unresolved or non-filter-safe username (one that could corrupt the
    // `:`-delimited key namespace) bypasses the shared cache instead of risking key collisions.
    if (!username || !isFilterSafeUsername(username)) return null;
    return `${VALKEY_CACHE.APP_PREFIX}:${VALKEY_CACHE.ORG_MEMBERSHIP_NAMESPACE}:${username}:${b2bOrgUid}:${slug.toLowerCase()}`;
  }

  // Performs the actual paginated, FGA-filtered project_membership fetch (the cache fetcher).
  private async runMembershipFetch(req: Request, b2bOrgUid: string, slug: string): Promise<ProjectMembershipDoc[]> {
    const tScanStart = Date.now();
    const docs = await fetchAllQueryResources<ProjectMembershipDoc>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<ProjectMembershipDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project_membership',
        tags: `b2b_org_uid:${b2bOrgUid}`,
        filters_all: `project_slug:${slug}`,
        per_page: OrgMembershipResolverService.membershipsPageSize,
        ...(pageToken && { page_token: pageToken }),
      })
    );
    logger.info(req, 'resolve_membership_context_timing', 'project_membership slug-scoped fetch complete', {
      b2b_org_uid: b2bOrgUid,
      foundation_slug: slug,
      membership_count: docs.length,
      scan_ms: Date.now() - tScanStart,
    });
    return docs;
  }
}
