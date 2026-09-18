// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCOUNT_ID_PATTERN, ORG_SLUG_RESOLVE_NAMESPACE, ORG_SLUG_RESOLVE_TTL_SECONDS } from '@lfx-one/shared/constants';
import { B2bOrgIndexedDoc, OrgResolveResponse, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { isOrgAccountIdSegment, isOrgSlugSegment, normalizeOrgSegment } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ServiceValidationError } from '../errors/service-validation.error';
import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { withPerUserCache } from './valkey.service';

/** Outcome of resolving one address segment for one viewer (spec 050, contracts/bff-org-slug-transport.md §3). */
export type OrgSegmentResolution =
  | { outcome: 'hit'; org: OrgResolveResponse }
  /** No organization the caller can read carries this segment — "unknown" and "no access" are indistinguishable by design (DR-002). */
  | { outcome: 'miss' }
  /** Several organizations the caller can read share this slug and the caller's selection did not break the tie (DR-007 §4). */
  | { outcome: 'ambiguous' };

/** Cached shape: only unambiguous hits are stored, so a later call with a different `prefer` can never be answered from another call's tie-break. */
type CachedResolution = { outcome: 'hit'; org: OrgResolveResponse } | { outcome: 'miss' } | { outcome: 'ambiguous' };

const OPERATION = 'resolve_org_segment';

/**
 * Resolves a `/org/{segment}/…` address segment — an 18-char SFID or a lowercase slug — to the
 * organization it names, only when the caller can read that organization.
 *
 * Every lookup goes through query-service with the caller's context, so per-row `auditor`
 * filtering happens upstream (ADR-0012/0015) and this service never sees an organization the
 * caller may not: "no such org" and "no access" are the same `miss` (DR-002, FR-017).
 *
 * Slugs are derived from the organization name by member-service (DR-007), so a handful of
 * organizations share one. Resolution is per viewer, which removes most collisions; when several
 * readable organizations remain, the caller's current selection (`prefer`) breaks the tie through
 * a second bounded lookup of that uid whose published slug must equal the segment. `prefer` never
 * widens access — it only picks among rows query-service already returned as readable.
 *
 * Positive, unambiguous resolutions are cached per viewer (DR-003): key = (username, segment);
 * misses and tie-breaks are never cached.
 */
export class OrgSlugResolverService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor(microserviceProxy?: MicroserviceProxyService) {
    this.microserviceProxy = microserviceProxy ?? new MicroserviceProxyService();
  }

  public async resolveSegment(req: Request, rawSegment: string, prefer?: string): Promise<OrgSegmentResolution> {
    const segment = normalizeOrgSegment(rawSegment);
    const segmentKind = this.classify(segment, req.path);
    if (prefer !== undefined && !ORG_ACCOUNT_ID_PATTERN.test(prefer)) {
      throw ServiceValidationError.forField('prefer', 'Invalid organization identifier', {
        operation: OPERATION,
        service: 'org_slug_resolver_service',
        path: req.path,
      });
    }

    if (segmentKind === 'sfid') {
      const org = await this.lookupByUid(req, segment);
      return org ? { outcome: 'hit', org } : { outcome: 'miss' };
    }

    const username = getEffectiveUsername(req) ?? '';
    const cached = await withPerUserCache<CachedResolution>(
      ORG_SLUG_RESOLVE_NAMESPACE,
      username,
      segment,
      ORG_SLUG_RESOLVE_TTL_SECONDS,
      () => this.lookupBySlug(req, segment),
      // Cache only what is stable for this viewer: a single readable organization.
      (value) => isCacheableHit(value)
    );

    if (cached.outcome !== 'ambiguous') {
      return cached;
    }

    if (!prefer) {
      return { outcome: 'ambiguous' };
    }

    // Tie-break: the caller's current selection wins iff query-service confirms the caller can
    // read it and member-service published this very slug for it. Size-independent — it does not
    // depend on how many rows the first query returned.
    const preferred = await this.lookupByUid(req, prefer);
    if (preferred && preferred.slug === segment) {
      return { outcome: 'hit', org: preferred };
    }
    return { outcome: 'ambiguous' };
  }

  private classify(segment: string, path: string): 'sfid' | 'slug' {
    if (isOrgAccountIdSegment(segment)) return 'sfid';
    if (isOrgSlugSegment(segment)) return 'slug';
    throw ServiceValidationError.forField('segment', 'Invalid organization segment', {
      operation: OPERATION,
      service: 'org_slug_resolver_service',
      path,
    });
  }

  /** One readable org by uid, or null. `uid` is pattern-checked by the caller, so it is safe to interpolate into the tag. */
  private async lookupByUid(req: Request, uid: string): Promise<OrgResolveResponse | null> {
    const response = await this.query(req, [`b2b_org_uid:${uid}`], 1);
    for (const resource of response?.resources ?? []) {
      const resolvedUid = extractUid(resource.id);
      if (resolvedUid === uid && resource.data) {
        return toResolveResponse(resolvedUid, resource.data);
      }
    }
    return null;
  }

  /** Readable orgs carrying the slug tag: one → hit, none → miss, several → ambiguous (resolved by the caller's `prefer`, never cached). */
  private async lookupBySlug(req: Request, slug: string): Promise<CachedResolution> {
    const response = await this.query(req, [`slug:${slug}`], 2);
    const rows: OrgResolveResponse[] = [];
    for (const resource of response?.resources ?? []) {
      const uid = extractUid(resource.id);
      if (uid && resource.data) rows.push(toResolveResponse(uid, resource.data));
    }
    if (rows.length === 1) return { outcome: 'hit', org: rows[0] };
    if (rows.length === 0) return { outcome: 'miss' };
    logger.warning(req, OPERATION, 'Slug shared by several readable organizations', { slug, rows: rows.length });
    return { outcome: 'ambiguous' };
  }

  /** Query-service exact-tag lookup with the caller's context. `page_size` is the Goa parameter name; `per_page` is silently ignored upstream. */
  private query(req: Request, tags: string[], pageSize: number): Promise<QueryServiceResponse<B2bOrgIndexedDoc>> {
    return this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'b2b_org',
      tags,
      page_size: pageSize,
    });
  }
}

function isCacheableHit(value: unknown): value is CachedResolution {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CachedResolution> & { org?: Partial<OrgResolveResponse> };
  return candidate.outcome === 'hit' && typeof candidate.org?.uid === 'string' && ORG_ACCOUNT_ID_PATTERN.test(candidate.org.uid);
}

function toResolveResponse(uid: string, doc: B2bOrgIndexedDoc): OrgResolveResponse {
  return { uid, slug: doc.slug ?? null, name: doc.name ?? '' };
}

/** Strip the `<type>:` prefix query-service prepends on `resource.id`; account ids (SFIDs) contain no colon. */
function extractUid(resourceId: string | undefined | null): string {
  if (!resourceId) return '';
  const colonIdx = resourceId.indexOf(':');
  return colonIdx === -1 ? resourceId : resourceId.substring(colonIdx + 1);
}
