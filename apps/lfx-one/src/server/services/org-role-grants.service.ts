// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_ACCESS_AWARE_CACHE_MAX_ENTRIES,
  ORG_ACCESS_AWARE_CACHE_TTL_MS,
  ORG_CASCADING_CHILDREN_FETCH_CONCURRENCY,
  ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP,
  ORG_ROLE_GRANTS_HARD_CAP,
} from '@lfx-one/shared/constants';
import {
  AccessAwareOrgsResult,
  B2bOrgIndexedDoc,
  B2bOrgSettingsDoc,
  CascadingRoleGrant,
  OrgRolePersona,
  QueryServiceResponse,
  ResolvedOrgRole,
  RoleGrantsResponse,
} from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier, isFilterSafeUsername } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** Loads caller role grants from b2b_org_settings (FR-018a "what can I see" pattern; spec 022 data-model.md). */
export class OrgRoleGrantsService {
  /** Process-wide short-TTL memo of the access-aware universe keyed by username. Avoids recomputing the full settings/details/cascading fan-out on every debounced typeahead request. */
  private static readonly accessCache = new Map<string, { value: AccessAwareOrgsResult; expiresAt: number }>();

  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** Spec 022 — single source of truth for the caller's access-aware org universe; mirrors `01-my-orgs-by-access.ipynb` per data-model.md D-001…D-005. Memoized per username for `ORG_ACCESS_AWARE_CACHE_TTL_MS` so repeated typeahead requests filter in-memory; only successful resolutions are cached. */
  public async getAccessAwareOrgs(req: Request, username: string): Promise<AccessAwareOrgsResult> {
    const cached = OrgRoleGrantsService.accessCache.get(username);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const result = await this.computeAccessAwareOrgs(req, username);

    // Cache only successful, filter-safe resolutions. Never cache upstream failures (they retry next
    // request) or unsafe usernames (avoids attacker-varied keys growing the map).
    if (!result.upstreamFailed && isFilterSafeUsername(username)) {
      OrgRoleGrantsService.cacheAccessResult(username, result);
    }
    return result;
  }

  /** Public wire-shape wrapper around `getAccessAwareOrgs` for `GET /api/orgs/me/role-grants`. */
  public async getRoleGrants(req: Request, username: string): Promise<RoleGrantsResponse> {
    const { resolved, loadedAt } = await this.getAccessAwareOrgs(req, username);
    return this.toRoleGrantsResponse(resolved, username, loadedAt);
  }

  /** Inserts into the per-username memo, pruning expired entries and evicting the oldest (insertion order) when over the cap. */
  private static cacheAccessResult(username: string, value: AccessAwareOrgsResult): void {
    const cache = OrgRoleGrantsService.accessCache;
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= ORG_ACCESS_AWARE_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    cache.set(username, { value, expiresAt: now + ORG_ACCESS_AWARE_CACHE_TTL_MS });
  }

  private async computeAccessAwareOrgs(req: Request, username: string): Promise<AccessAwareOrgsResult> {
    const loadedAt = new Date().toISOString();
    const empty: AccessAwareOrgsResult = {
      resolved: new Map(),
      orgDocByUid: new Map(),
      upstreamFailed: false,
      loadedAt,
      username,
    };

    if (!isFilterSafeUsername(username)) {
      logger.warning(req, 'get_org_role_grants', 'Refusing role-grants lookup for username outside filter-safe allowlist', {
        username_length: username.length,
      });
      return empty;
    }

    let settingsResponse: QueryServiceResponse<B2bOrgSettingsDoc>;
    try {
      settingsResponse = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgSettingsDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'b2b_org_settings',
        filters_or: [`writers.username:${username}`, `auditors.username:${username}`],
        per_page: ORG_ROLE_GRANTS_HARD_CAP,
      });
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream b2b_org_settings query failed', { err: error });
      return { ...empty, upstreamFailed: true };
    }

    const { directWriters, directAuditors } = this.partitionDirectGrants(settingsResponse, username);
    if (directWriters.size === 0 && directAuditors.size === 0) {
      return { resolved: new Map(), orgDocByUid: new Map(), upstreamFailed: false, loadedAt, username };
    }

    const directUids = new Set<string>([...directWriters, ...directAuditors]);

    let directOrgDocs: Map<string, B2bOrgIndexedDoc>;
    try {
      directOrgDocs = await this.fetchOrgDetailsByUids(req, Array.from(directUids));
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream b2b_org details fetch failed', { err: error });
      return { ...empty, upstreamFailed: true };
    }

    let cascadingChildrenByParent: Map<string, B2bOrgIndexedDoc[]>;
    try {
      const parentUids = Array.from(directUids).filter((uid) => directOrgDocs.get(uid)?.is_parent === true);
      cascadingChildrenByParent = await this.fetchCascadingChildren(req, parentUids);
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream cascading-children fetch failed', { err: error });
      return { ...empty, upstreamFailed: true };
    }

    const resolved = this.buildResolvedMap(directWriters, directAuditors, directOrgDocs, cascadingChildrenByParent);
    const orgDocByUid = this.mergeOrgDocs(directOrgDocs, cascadingChildrenByParent);

    return { resolved, orgDocByUid, upstreamFailed: false, loadedAt, username };
  }

  private partitionDirectGrants(
    response: QueryServiceResponse<B2bOrgSettingsDoc> | null,
    username: string
  ): { directWriters: Set<string>; directAuditors: Set<string> } {
    const directWriters = new Set<string>();
    const directAuditors = new Set<string>();

    for (const resource of response?.resources ?? []) {
      // query-service returns `resource.id` as `<type>:<UUID>` (e.g. `b2b_org_settings:4c46585f-…`).
      // We key on the bare UUID so it matches the b2b_org details lookup downstream.
      const orgUid = this.extractUid(resource.id);
      if (!orgUid) continue;

      const isWriter = (resource.data?.writers ?? []).some((entry) => entry?.username === username && entry?.invite_status === 'accepted');
      if (isWriter) {
        directWriters.add(orgUid);
        continue;
      }

      const isAuditor = (resource.data?.auditors ?? []).some((entry) => entry?.username === username && entry?.invite_status === 'accepted');
      if (isAuditor) {
        directAuditors.add(orgUid);
      }
    }

    return { directWriters, directAuditors };
  }

  /** Strip the `<type>:` prefix that query-service prepends on `resource.id`. UUIDs don't contain `:`, so this is safe across all org types. */
  private extractUid(resourceId: string | undefined | null): string {
    if (!resourceId) return '';
    const colonIdx = resourceId.indexOf(':');
    return colonIdx === -1 ? resourceId : resourceId.substring(colonIdx + 1);
  }

  /** D-003 — batch-fetch b2b_org indexed docs via a single multi-tag query; returns `uid → doc`. Uids missing from the upstream response are absent from the result. */
  private async fetchOrgDetailsByUids(req: Request, uids: string[]): Promise<Map<string, B2bOrgIndexedDoc>> {
    const safeUids = this.filterSafeUids(req, uids, 'fetch_org_details_by_uids');
    if (safeUids.length === 0) return new Map();

    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'b2b_org',
      tags: safeUids.map((uid) => `b2b_org_uid:${uid}`),
      // +10 buffer for safety, capped at the hard cap so we never request a page larger than
      // the upstream max-page-size (safeUids is already bounded by ORG_ROLE_GRANTS_HARD_CAP).
      per_page: Math.min(safeUids.length + 10, ORG_ROLE_GRANTS_HARD_CAP),
    });

    const map = new Map<string, B2bOrgIndexedDoc>();
    for (const resource of response?.resources ?? []) {
      const uid = this.extractUid(resource.id);
      if (uid && resource.data) {
        map.set(uid, resource.data);
      }
    }
    return map;
  }

  /** D-004 — fetch of cascading children (one query per direct-granted parent), paginated to completion. Per-parent paginator stops at `ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP` (FR-017). Parents are processed through a bounded pool (`ORG_CASCADING_CHILDREN_FETCH_CONCURRENCY`) so we never burst hundreds of concurrent `/query/resources` requests. */
  private async fetchCascadingChildren(req: Request, parentUids: string[]): Promise<Map<string, B2bOrgIndexedDoc[]>> {
    const safeParentUids = this.filterSafeUids(req, parentUids, 'fetch_cascading_children');
    if (safeParentUids.length === 0) return new Map();

    // Collect by original index so the materialised Map preserves parentUids order
    // (direct-first, then cascading per parent) regardless of worker completion order.
    const childrenByIndex: B2bOrgIndexedDoc[][] = new Array(safeParentUids.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < safeParentUids.length) {
        const index = cursor++;
        childrenByIndex[index] = await this.fetchChildrenForParent(req, safeParentUids[index]);
      }
    };

    const poolSize = Math.min(ORG_CASCADING_CHILDREN_FETCH_CONCURRENCY, safeParentUids.length);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    const results = new Map<string, B2bOrgIndexedDoc[]>();
    for (let i = 0; i < safeParentUids.length; i++) {
      results.set(safeParentUids[i], childrenByIndex[i]);
    }

    return results;
  }

  /** Paginates a single direct-granted parent's cascading children to completion (or the per-parent hard cap). */
  private async fetchChildrenForParent(req: Request, parentUid: string): Promise<B2bOrgIndexedDoc[]> {
    const children: B2bOrgIndexedDoc[] = [];
    let pageToken: string | undefined;
    let truncated = false;

    do {
      const query: Record<string, unknown> = {
        type: 'b2b_org',
        tags: [`parent_b2b_org_uid:${parentUid}`],
        per_page: 100,
      };
      if (pageToken) query['page_token'] = pageToken;

      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        query
      );

      for (const resource of response?.resources ?? []) {
        const childUid = this.extractUid(resource.id);
        if (childUid && resource.data) {
          children.push({ ...resource.data, uid: childUid } as B2bOrgIndexedDoc & { uid: string });
          if (children.length >= ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP) {
            truncated = true;
            break;
          }
        }
      }

      if (truncated) break;
      pageToken = response?.page_token;
    } while (pageToken);

    if (truncated) {
      logger.warning(req, 'fetch_cascading_children', 'Per-parent children cap reached — truncating', {
        parent_uid: parentUid,
        cap: ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP,
      });
    }

    return children;
  }

  /** D-005 — direct first (writer-wins on duplicate-direct), then cascading with highest-privilege-wins; direct-source preserved on tie to keep FR-011a's `canEdit` direct-only check intact. */
  private buildResolvedMap(
    directWriters: Set<string>,
    directAuditors: Set<string>,
    directOrgDocs: Map<string, B2bOrgIndexedDoc>,
    cascadingChildrenByParent: Map<string, B2bOrgIndexedDoc[]>
  ): Map<string, ResolvedOrgRole> {
    const resolved = new Map<string, ResolvedOrgRole>();

    for (const uid of directWriters) {
      resolved.set(uid, { roleSource: 'direct-writer' });
    }
    for (const uid of directAuditors) {
      if (!resolved.has(uid)) {
        resolved.set(uid, { roleSource: 'direct-auditor' });
      }
    }

    for (const [parentUid, children] of cascadingChildrenByParent) {
      const parentDoc = directOrgDocs.get(parentUid);
      const parentName = parentDoc?.name ?? '';
      // FGA model (model.yaml line 369): "writer does NOT cascade — edit scope stays on the
      // directly-assigned org only". Only `auditor` cascades via parent/child relations.
      // Regardless of whether the parent grant is writer or auditor, children inherit auditor.
      const inheritedRoleSource: OrgRolePersona = 'inherited-auditor';

      for (const child of children) {
        const childUid = (child as B2bOrgIndexedDoc & { uid?: string }).uid;
        if (!childUid) continue;

        const existing = resolved.get(childUid);
        if (!existing) {
          resolved.set(childUid, { roleSource: inheritedRoleSource, parentUid, parentName });
          continue;
        }
        // Direct grants (writer or auditor) always take precedence over inherited-auditor.
        // If the child already has a direct or inherited entry, keep the existing one.
      }
    }

    return resolved;
  }

  /** Build a uid→doc lookup covering both direct and cascading rows; direct entries win on collision. */
  private mergeOrgDocs(
    directOrgDocs: Map<string, B2bOrgIndexedDoc>,
    cascadingChildrenByParent: Map<string, B2bOrgIndexedDoc[]>
  ): Map<string, B2bOrgIndexedDoc> {
    const merged = new Map<string, B2bOrgIndexedDoc>();

    for (const [, children] of cascadingChildrenByParent) {
      for (const child of children) {
        const childUid = (child as B2bOrgIndexedDoc & { uid?: string }).uid;
        if (childUid && !merged.has(childUid)) {
          merged.set(childUid, child);
        }
      }
    }

    for (const [uid, doc] of directOrgDocs) {
      merged.set(uid, doc);
    }

    return merged;
  }

  private toRoleGrantsResponse(resolved: Map<string, ResolvedOrgRole>, username: string, loadedAt: string): RoleGrantsResponse {
    const writers: string[] = [];
    const auditors: string[] = [];
    const cascadingWriters: CascadingRoleGrant[] = [];
    const cascadingAuditors: CascadingRoleGrant[] = [];

    for (const [uid, role] of resolved) {
      switch (role.roleSource) {
        case 'direct-writer':
          writers.push(uid);
          break;
        case 'direct-auditor':
          auditors.push(uid);
          break;
        case 'inherited-writer':
          // Dead branch — the FGA model prevents writer from cascading (buildResolvedMap hard-codes
          // 'inherited-auditor' for all cascading children); kept for OrgRolePersona exhaustiveness.
          cascadingWriters.push({ uid, parentUid: role.parentUid ?? '', parentName: role.parentName ?? '' });
          break;
        case 'inherited-auditor':
          cascadingAuditors.push({ uid, parentUid: role.parentUid ?? '', parentName: role.parentName ?? '' });
          break;
      }
    }

    return { writers, auditors, cascadingWriters, cascadingAuditors, username, loaded_at: loadedAt };
  }

  /** Strip uids that would break query-service tag grammar before interpolating into `b2b_org_uid:` / `parent_b2b_org_uid:` tags. */
  private filterSafeUids(req: Request, uids: string[], operation: string): string[] {
    return uids.filter((uid) => {
      if (isFilterSafeIdentifier(uid)) return true;
      logger.warning(req, operation, 'Skipping uid outside filter-safe allowlist', { uid_length: uid.length });
      return false;
    });
  }
}
