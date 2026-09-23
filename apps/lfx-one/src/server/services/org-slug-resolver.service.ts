// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_ACCOUNT_ID_PATTERN,
  ORG_SLUG_RESOLVE_LOOKUP_TIMEOUT_MS,
  ORG_SLUG_RESOLVE_NAMESPACE,
  ORG_SLUG_RESOLVE_PAGE_CAP,
  ORG_SLUG_RESOLVE_PAGE_SIZE,
  ORG_SLUG_RESOLVE_TTL_SECONDS,
  ORG_SLUG_SEGMENT_PATTERN,
} from '@lfx-one/shared/constants';
import { B2bOrgIndexedDoc, OrgResolveResponse, QueryServiceResponse } from '@lfx-one/shared/interfaces';
// Deep import on purpose: the `@lfx-one/shared/utils` barrel pulls Angular-only utils into the Node
// server bundle and its specs; this module is pure (same precedent as `impersonation.utils`).
import { isOrgAccountIdSegment, isOrgSlugSegment, normalizeOrgSegment } from '@lfx-one/shared/utils/org-lens-url.utils';
import { Request } from 'express';

import { ServiceValidationError } from '../errors/service-validation.error';
import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { buildPerUserOrgKey, valkeyService } from './valkey.service';

/** Cached shape: only unambiguous hits are stored, so a later call with a different `prefer` can never be answered from another call's tie-break. */
type CachedResolution =
  | { outcome: 'hit'; org: OrgResolveResponse }
  /** No organization the caller can read carries this segment — "unknown" and "no access" are indistinguishable by design (DR-002). */
  | { outcome: 'miss' }
  /** Several organizations the caller can read share this slug and the caller's selection did not break the tie (DR-007 §4). */
  | { outcome: 'ambiguous' };

/** How the per-viewer cache took part (contracts/bff-org-slug-transport.md §5): `bypass` = not consulted (SFID path, or no principal-bound key). */
export type OrgSegmentCacheDisposition = 'hit' | 'miss' | 'bypass';

/** Outcome of resolving one address segment for one viewer (spec 050, contracts/bff-org-slug-transport.md §3), with the cache disposition for the operation log. */
export type OrgSegmentResolution = CachedResolution & { cache: OrgSegmentCacheDisposition };

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
      return org ? { outcome: 'hit', org, cache: 'bypass' } : { outcome: 'miss', cache: 'bypass' };
    }

    const username = getEffectiveUsername(req) ?? '';
    // Read AND write are gated on the same predicate: only a single readable organization is
    // stored. A miss or a tie is never written, so probing unknown slugs cannot fill per-user keys
    // and a later call with a different `prefer` is never answered from another call's tie-break —
    // which is also why `prefer` is not part of the key (contracts/bff-org-slug-transport.md §4).
    // The key builder accepts identifiers up to 64 chars; a longer slug (the segment pattern allows
    // 128) yields a null key, which `withCache` treats as "fetch directly" — correct, just uncached.
    const key = buildPerUserOrgKey(ORG_SLUG_RESOLVE_NAMESPACE, username, segment);
    let fetched = false;
    const cached = await valkeyService.withCache<CachedResolution>(
      key,
      ORG_SLUG_RESOLVE_TTL_SECONDS,
      () => {
        fetched = true;
        return this.lookupBySlug(req, segment);
      },
      isCacheableHit,
      isCacheableHit
    );
    // A disabled cache also runs the fetcher and reports here as `miss`; `bypass` is the no-key case.
    let cache: OrgSegmentCacheDisposition = 'hit';
    if (key === null) cache = 'bypass';
    else if (fetched) cache = 'miss';

    if (cached.outcome !== 'ambiguous') {
      return { ...cached, cache };
    }

    if (!prefer) {
      return { outcome: 'ambiguous', cache };
    }

    // Tie-break: the caller's current selection wins iff query-service confirms the caller can
    // read it and member-service published this very slug for it. Size-independent — it does not
    // depend on how many rows the first query returned.
    const preferred = await this.lookupByUid(req, prefer);
    if (preferred && preferred.slug === segment) {
      return { outcome: 'hit', org: preferred, cache };
    }
    return { outcome: 'ambiguous', cache };
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

  /**
   * Readable orgs carrying the slug tag: one → hit, none → miss, several → ambiguous (resolved by the
   * caller's `prefer`, never cached). Query-service pages the raw OpenSearch hits **before** the
   * access check, so one page can hold zero or one readable row and still carry a cursor while
   * another readable same-slug organization sits on the next page — deciding on a single page could
   * turn a tie into a cached "unique" hit or a real match into a miss. The cursor is followed until
   * two readable rows are in hand or it is exhausted, within a hard page cap.
   */
  private async lookupBySlug(req: Request, slug: string): Promise<CachedResolution> {
    const rows: OrgResolveResponse[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < ORG_SLUG_RESOLVE_PAGE_CAP; page += 1) {
      const response = await this.query(req, [`slug:${slug}`], ORG_SLUG_RESOLVE_PAGE_SIZE, pageToken);
      for (const resource of response?.resources ?? []) {
        const uid = extractUid(resource.id);
        if (uid && resource.data) rows.push(toResolveResponse(uid, resource.data));
      }
      if (rows.length >= 2) {
        logger.warning(req, OPERATION, 'Slug shared by several readable organizations', { slug, rows: rows.length, pages: page + 1 });
        return { outcome: 'ambiguous' };
      }
      pageToken = response?.page_token || undefined;
      if (!pageToken) {
        return rows.length === 1 ? { outcome: 'hit', org: rows[0] } : { outcome: 'miss' };
      }
    }

    // Cap reached with a cursor still pending. No readable row so far is a miss — the same answer an
    // unknown slug gets, so the status never reveals that unreadable rows exist (DR-002). One readable
    // row cannot be called unique, so fail closed as ambiguous; `prefer` can still confirm the
    // caller's own selection.
    logger.warning(req, OPERATION, 'Slug lookup page cap reached with cursor pending', {
      slug,
      rows: rows.length,
      pages: ORG_SLUG_RESOLVE_PAGE_CAP,
      outcome: rows.length === 0 ? 'miss' : 'ambiguous',
    });
    return rows.length === 0 ? { outcome: 'miss' } : { outcome: 'ambiguous' };
  }

  /**
   * Query-service exact-tag lookup with the caller's context. `page_size` is the Goa parameter name;
   * `per_page` is silently ignored upstream. Short per-call budget: the SSR guard run blocks the
   * whole page render on this, so a stalled query-service must surface as a fast 408 (→ 502, FR-020)
   * rather than the client's 30 s default.
   */
  private query(req: Request, tags: string[], pageSize: number, pageToken?: string): Promise<QueryServiceResponse<B2bOrgIndexedDoc>> {
    const params: Record<string, unknown> = { type: 'b2b_org', tags, page_size: pageSize };
    if (pageToken) params['page_token'] = pageToken;
    return this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params,
      undefined,
      undefined,
      {
        timeoutMs: ORG_SLUG_RESOLVE_LOOKUP_TIMEOUT_MS,
      }
    );
  }
}

/** The one shape the cache may serve or store: a complete, well-formed unambiguous hit. Anything else — a miss, a tie, or a drifted/partial record — is neither read back nor written. */
function isCacheableHit(value: unknown): value is CachedResolution {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CachedResolution> & { org?: Partial<OrgResolveResponse> };
  if (candidate.outcome !== 'hit' || !candidate.org || typeof candidate.org !== 'object') return false;
  const { uid, name, slug } = candidate.org;
  return (
    typeof uid === 'string' &&
    ORG_ACCOUNT_ID_PATTERN.test(uid) &&
    typeof name === 'string' &&
    (slug === null || (typeof slug === 'string' && ORG_SLUG_SEGMENT_PATTERN.test(slug)))
  );
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
