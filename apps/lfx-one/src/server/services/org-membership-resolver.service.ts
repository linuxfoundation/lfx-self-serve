// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectMembershipDoc, QueryServiceResponse, ResolvedMembershipContext } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveSub } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

// Resolves an org UUID + foundation slug to the active project_membership context.

export class OrgMembershipResolverService {
  // Membership statuses that count as active for this page (membership-level).
  private static readonly activeMembershipStatuses = new Set(['active', 'purchased']);
  // Slug-scoped project_membership queries fit in one page.
  private static readonly membershipsPageSize = 500;
  // Short per-(caller, org, slug) memo TTL to avoid bursty repeat fetches.
  private static readonly membershipsCacheTtlMs = 30_000;
  // Hard cap for in-process membership memo entries.
  private static readonly membershipsCacheMaxEntries = 2_000;

  // Per-caller memo of project_membership docs keyed by `${sub}:${b2bOrgUid}:${slug}`.
  private static readonly membershipsCache = new Map<string, { docs: ProjectMembershipDoc[]; expiresAt: number }>();

  // In-flight dedup for concurrent prefetch + resolve reads.
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

  // Fetches and memoizes slug-scoped project_membership documents for one org UUID.
  public async fetchMembershipsBySlug(req: Request, b2bOrgUid: string, foundationSlug: string): Promise<ProjectMembershipDoc[]> {
    const slug = (foundationSlug ?? '').trim();
    if (!b2bOrgUid || !isFilterSafeIdentifier(b2bOrgUid) || !slug || !isFilterSafeIdentifier(slug)) return [];

    const key = `${getEffectiveSub(req) ?? 'anon'}:${b2bOrgUid}:${slug.toLowerCase()}`;
    const cached = OrgMembershipResolverService.membershipsCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.docs;
    }
    const inFlight = OrgMembershipResolverService.membershipsInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
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
      OrgMembershipResolverService.setCache(key, docs);
      return docs;
    })();

    OrgMembershipResolverService.membershipsInFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      OrgMembershipResolverService.membershipsInFlight.delete(key);
    }
  }

  // Stores a cached org-membership list and evicts oldest-first when full.
  private static setCache(key: string, docs: ProjectMembershipDoc[]): void {
    const cache = OrgMembershipResolverService.membershipsCache;
    if (!cache.has(key) && cache.size >= OrgMembershipResolverService.membershipsCacheMaxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { docs, expiresAt: Date.now() + OrgMembershipResolverService.membershipsCacheTtlMs });
  }
}
