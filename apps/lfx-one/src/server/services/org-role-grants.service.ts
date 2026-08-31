// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LF_STAFF_TEAM_ID,
  ORG_ACCESS_AWARE_CACHE_TTL_MS,
  ORG_CASCADING_CHILDREN_FETCH_CONCURRENCY,
  ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP,
  ORG_ROLE_GRANTS_HARD_CAP,
  QUERY_SERVICE_FILTERS_OR_BATCH_SIZE,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import {
  AccessAwareOrgsCacheEntry,
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

import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { cacheKeyNamespace, valkeyService } from './valkey.service';

/** Loads caller role grants from b2b_org_settings (FR-018a "what can I see" pattern; spec 022 data-model.md). */
export class OrgRoleGrantsService {
  // Per-process coalescing of concurrent identical reads, keyed by the username-bound cache key, so a
  // burst of cache misses for the same caller computes the fan-out once instead of thundering-herding
  // the upstream. The authoritative cross-instance cache remains the shared Valkey store.
  private static readonly accessInFlight = new Map<string, Promise<AccessAwareOrgsResult>>();

  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.accessCheck = new AccessCheckService();
  }

  /** Single source of truth for the caller's access-aware org universe. Served through the shared Valkey cache, keyed per caller username; only successful resolutions are cached and the cache is fail-soft. */
  public async getAccessAwareOrgs(req: Request, username: string): Promise<AccessAwareOrgsResult> {
    // Username is the caller's own identity (the "what can I see" principal), so keying by it is
    // per-user isolated. Only filter-safe usernames are cached; others bypass (compute directly).
    const cacheKey = OrgRoleGrantsService.buildCacheKey(username);

    if (cacheKey) {
      // The shape guard rejects a corrupt/legacy entry as a miss so deserialize can never throw a 500.
      const cached = await valkeyService.getJson<AccessAwareOrgsCacheEntry>(cacheKey, OrgRoleGrantsService.isValidCacheEntry);
      if (cached) {
        return OrgRoleGrantsService.deserializeAccessResult(cached);
      }
    }

    // No cache key (non-filter-safe username) → compute directly, no coalescing.
    if (!cacheKey) {
      return this.computeAccessAwareOrgs(req, username);
    }

    // Coalesce concurrent misses for the same username.
    const inFlight = OrgRoleGrantsService.accessInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      const result = await this.computeAccessAwareOrgs(req, username);
      // Cache only successful resolutions; never cache upstream failures (they retry next request).
      if (!result.upstreamFailed) {
        await valkeyService.setJson(cacheKey, OrgRoleGrantsService.serializeAccessResult(result), OrgRoleGrantsService.cacheTtlSeconds());
      }
      return result;
    })();

    OrgRoleGrantsService.accessInFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      OrgRoleGrantsService.accessInFlight.delete(cacheKey);
    }
  }

  /** Public wire-shape wrapper around `getAccessAwareOrgs` for `GET /api/orgs/me/role-grants`. */
  public async getRoleGrants(req: Request, username: string): Promise<RoleGrantsResponse> {
    const { resolved, loadedAt, isStaff } = await this.getAccessAwareOrgs(req, username);
    return this.toRoleGrantsResponse(resolved, username, loadedAt, isStaff);
  }

  /** Builds the username-bound, namespaced, versioned cache key, or null when the username is not filter-safe. */
  private static buildCacheKey(username: string): string | null {
    if (!isFilterSafeUsername(username)) return null;
    const ns = cacheKeyNamespace();
    const prefix = ns ? `${VALKEY_CACHE.APP_PREFIX}:${ns}` : VALKEY_CACHE.APP_PREFIX;
    return `${prefix}:${VALKEY_CACHE.ORG_ACCESS_NAMESPACE}:${username}`;
  }

  /** Shared-constant TTL converted from ms to whole seconds for the cache write. */
  private static cacheTtlSeconds(): number {
    return Math.floor(ORG_ACCESS_AWARE_CACHE_TTL_MS / 1000);
  }

  /**
   * Rejects a corrupt/legacy/partial cached entry (so deserialize never throws and the response contract
   * holds): both Maps must be present as arrays of `[key, value]` tuples, and the fields later surfaced on
   * the wire (`loadedAt`, `upstreamFailed`, `username`) must have their expected types — otherwise degrade
   * to a miss + recompute.
   */
  private static isValidCacheEntry(value: unknown): boolean {
    const entry = value as Partial<AccessAwareOrgsCacheEntry> | null;
    return (
      !!entry &&
      OrgRoleGrantsService.isEntryTupleArray(entry.resolved, OrgRoleGrantsService.isResolvedOrgRole) &&
      OrgRoleGrantsService.isEntryTupleArray(entry.orgDocByUid) &&
      typeof entry.username === 'string' &&
      typeof entry.loadedAt === 'string' &&
      typeof entry.upstreamFailed === 'boolean' &&
      // Entries written before `isStaff` existed fail here and are recomputed, rather than
      // deserializing to `undefined` and silently denying a staff caller for the rest of the TTL.
      typeof entry.isStaff === 'boolean'
    );
  }

  /**
   * True only when the value is an array of `[stringKey, objectValue]` tuples — the exact shape `new Map(...)`
   * consumes for both Maps here (`resolved` → ResolvedOrgRole objects, `orgDocByUid` → B2bOrgIndexedDoc objects).
   * Validating the element types (not just arity) rejects corrupt entries like `[[123, null]]` or array-valued
   * tuples like `[["uid", []]]` as a miss instead of rebuilding a Map with non-string uids / non-object docs that
   * would later surface as an invalid wire shape. An optional `valueGuard` additionally validates the tuple's
   * value object so a structurally-valid-but-semantically-corrupt value is also rejected as a miss.
   */
  private static isEntryTupleArray(value: unknown, valueGuard?: (value: object) => boolean): boolean {
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          Array.isArray(item) &&
          item.length === 2 &&
          typeof item[0] === 'string' &&
          typeof item[1] === 'object' &&
          item[1] !== null &&
          !Array.isArray(item[1]) &&
          (!valueGuard || valueGuard(item[1] as object))
      )
    );
  }

  /**
   * Validates a `resolved` tuple value carries a usable role: `roleSource` must be a non-empty string (it is
   * later branched on with `.startsWith(...)`, so a missing/non-string `roleSource` would turn a cache hit into
   * a thrown 500 instead of degrading to a miss), and the optional `parentUid`/`parentName` must be strings when
   * present. A corrupt entry like `["uid", {}]` is therefore rejected as a miss and recomputed.
   */
  private static isResolvedOrgRole(value: object): boolean {
    const role = value as Partial<ResolvedOrgRole>;
    return (
      typeof role.roleSource === 'string' &&
      role.roleSource.length > 0 &&
      (role.parentUid === undefined || typeof role.parentUid === 'string') &&
      (role.parentName === undefined || typeof role.parentName === 'string')
    );
  }

  /** Maps → ordered entry arrays for JSON storage (insertion order preserved). */
  private static serializeAccessResult(result: AccessAwareOrgsResult): AccessAwareOrgsCacheEntry {
    return {
      resolved: [...result.resolved],
      orgDocByUid: [...result.orgDocByUid],
      upstreamFailed: result.upstreamFailed,
      loadedAt: result.loadedAt,
      username: result.username,
      isStaff: result.isStaff,
    };
  }

  /** Rebuilds the Map-backed result from its serialized cache entry (insertion order preserved). */
  private static deserializeAccessResult(entry: AccessAwareOrgsCacheEntry): AccessAwareOrgsResult {
    return {
      resolved: new Map(entry.resolved),
      orgDocByUid: new Map(entry.orgDocByUid),
      upstreamFailed: entry.upstreamFailed,
      loadedAt: entry.loadedAt,
      username: entry.username,
      isStaff: entry.isStaff,
    };
  }

  private async computeAccessAwareOrgs(req: Request, username: string): Promise<AccessAwareOrgsResult> {
    const loadedAt = new Date().toISOString();
    const empty: AccessAwareOrgsResult = {
      resolved: new Map(),
      orgDocByUid: new Map(),
      upstreamFailed: false,
      loadedAt,
      username,
      isStaff: false,
    };

    if (!isFilterSafeUsername(username)) {
      logger.warning(req, 'get_org_role_grants', 'Refusing role-grants lookup for username outside filter-safe allowlist', {
        username_length: username.length,
      });
      return empty;
    }

    // Started here so it overlaps the roster query rather than serialising behind it, and
    // resolved on every path below: the staff grant is independent of the roster, so it must survive
    // both "no grants" (the defining staff case) and a roster lookup failure.
    const staffPromise = this.resolveIsStaff(req, username);

    let settingsResponse: QueryServiceResponse<B2bOrgSettingsDoc>;
    try {
      settingsResponse = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgSettingsDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'b2b_org_settings',
        // Spec 002 / member-service v0.7.0: settings are indexed with a `member:<username>` tag (the
        // union of accepted writers + auditors — b2b_org_settings.go Tags() → TagPrefixMember). The
        // query-service matches these via the `tags` param (the legacy `filters_or: writers.username:`
        // form matches nothing — verified against dev). Writer-vs-auditor is classified from the
        // flattened `data.members[]` shape (falling back to legacy `data.writers[]`/`data.auditors[]`) below.
        tags: [`member:${username}`],
        // Request one row above the hard cap so we can detect callers who have more direct
        // grants than the platform supports today. Upstream `MaxPageSize` is 1000
        // (`apps/lfx-v2-query-service/pkg/constants/query.go`), so 501 stays well within bounds and
        // no page_token fallback is required. Parameter is `page_size` — the query-service Goa DSL
        // binds this exact key (`apps/lfx-v2-query-service/design/query-svc.go`); a legacy
        // `per_page` here is silently ignored and the upstream defaults to `DefaultPageSize = 50`.
        page_size: ORG_ROLE_GRANTS_HARD_CAP + 1,
      });
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream b2b_org_settings query failed', { err: error });
      return { ...empty, upstreamFailed: true, isStaff: await staffPromise };
    }

    // Operator-visibility signal: when the caller has more direct grants than
    // ORG_ROLE_GRANTS_HARD_CAP, emit a single structured warning per response with a stable event
    // tag so ops can page-alert on it. The response is truncated to the cap before partitioning so
    // the DIRECT-grant portion of the resolver, cache, and wire response never exceeds the
    // supported ceiling. Cascading children expanded downstream by `buildResolvedMap` are bounded
    // separately by `ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP` per direct parent — the cap here
    // is not a global upper bound on the resolved-map size.
    const rawGrantCount = settingsResponse?.resources?.length ?? 0;
    if (rawGrantCount > ORG_ROLE_GRANTS_HARD_CAP) {
      logger.warning(req, 'get_org_role_grants', 'Raw direct-grant count exceeds supported maximum — truncating to hard cap', {
        username_length: username.length,
        raw_grant_count: rawGrantCount,
        hard_cap: ORG_ROLE_GRANTS_HARD_CAP,
        event: 'org_grant_cap_exceeded',
      });
      settingsResponse = { ...settingsResponse, resources: settingsResponse.resources!.slice(0, ORG_ROLE_GRANTS_HARD_CAP) };
    }

    const isStaff = await staffPromise;

    const { directWriters, directAuditors } = this.partitionDirectGrants(settingsResponse, username);
    if (directWriters.size === 0 && directAuditors.size === 0) {
      return { resolved: new Map(), orgDocByUid: new Map(), upstreamFailed: false, loadedAt, username, isStaff };
    }

    const directUids = new Set<string>([...directWriters, ...directAuditors]);

    let directOrgDocs: Map<string, B2bOrgIndexedDoc>;
    try {
      directOrgDocs = await this.fetchOrgDetailsByUids(req, Array.from(directUids));
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream b2b_org details fetch failed', { err: error });
      return { ...empty, upstreamFailed: true, isStaff };
    }

    let cascadingChildrenByParent: Map<string, B2bOrgIndexedDoc[]>;
    try {
      const parentUids = Array.from(directUids).filter((uid) => directOrgDocs.get(uid)?.is_parent === true);
      cascadingChildrenByParent = await this.fetchCascadingChildren(req, parentUids);
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream cascading-children fetch failed', { err: error });
      return { ...empty, upstreamFailed: true, isStaff };
    }

    const resolved = this.buildResolvedMap(directWriters, directAuditors, directOrgDocs, cascadingChildrenByParent);
    const orgDocByUid = this.mergeOrgDocs(directOrgDocs, cascadingChildrenByParent);

    return { resolved, orgDocByUid, upstreamFailed: false, loadedAt, username, isStaff };
  }

  /**
   * Asks the platform authorizer whether the caller belongs to the LF staff team, which carries
   * `auditor` on every `b2b_org` (member-service `docs/fga-contract.md`). Shares
   * `LF_STAFF_TEAM_ID` with `PersonaDetectionService.checkLFStaff`, so the two authorization paths
   * cannot drift onto different team names.
   *
   * No permission semantics live here: the relation is defined in the FGA model and this only reads the
   * authorizer's answer, which is why it does not conflict with the gateway-enforced-authorization
   * principle. Fails closed — `checkSingleAccess` already degrades to `false`, and the extra catch keeps
   * an unexpected throw from failing the whole role-grants resolution for a caller who simply is not staff.
   */
  private async resolveIsStaff(req: Request, username: string): Promise<boolean> {
    try {
      return await this.accessCheck.checkSingleAccess(req, { resource: 'team', id: LF_STAFF_TEAM_ID, access: 'member' });
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'LF staff membership check failed; treating caller as non-staff', {
        username_length: username.length,
        err: error,
      });
      return false;
    }
  }

  private partitionDirectGrants(
    response: QueryServiceResponse<B2bOrgSettingsDoc> | null,
    username: string
  ): { directWriters: Set<string>; directAuditors: Set<string> } {
    const directWriters = new Set<string>();
    const directAuditors = new Set<string>();

    for (const resource of response?.resources ?? []) {
      // query-service returns `resource.id` as `<type>:<sfid>` (e.g. `b2b_org_settings:0014100000Te2QjAAJ`).
      // We key on the bare account id (SFID) so it matches the b2b_org details lookup downstream.
      const orgUid = this.extractUid(resource.id);
      if (!orgUid) continue;

      const role = this.classifyDirectRole(resource.data, username);
      if (role === 'writer') {
        directWriters.add(orgUid);
      } else if (role === 'auditor') {
        directAuditors.add(orgUid);
      }
    }

    return { directWriters, directAuditors };
  }

  /**
   * Resolves the caller's direct role on one settings doc, preferring the current flattened
   * `members[]` indexer shape and falling back to the legacy `writers[]`/`auditors[]` arrays
   * (member-service `b2bOrgSettingsIndexerView`). Only `accepted` entries count, and writer
   * wins over auditor when the caller appears as both (matches the indexer's writer-first dedupe).
   */
  private classifyDirectRole(data: B2bOrgSettingsDoc | undefined, username: string): 'writer' | 'auditor' | null {
    const members = data?.members;
    if (members?.length) {
      let isAuditor = false;
      for (const entry of members) {
        if (entry?.username !== username || entry?.invite_status !== 'accepted') continue;
        if (entry.role === 'writer') return 'writer';
        if (entry.role === 'auditor') isAuditor = true;
      }
      if (isAuditor) return 'auditor';
    }

    // Legacy fallback for docs indexed before the members[] flatten.
    if ((data?.writers ?? []).some((entry) => entry?.username === username && entry?.invite_status === 'accepted')) {
      return 'writer';
    }
    if ((data?.auditors ?? []).some((entry) => entry?.username === username && entry?.invite_status === 'accepted')) {
      return 'auditor';
    }

    return null;
  }

  /** Strip the `<type>:` prefix that query-service prepends on `resource.id`. Account ids (SFIDs) don't contain `:`, so this is safe across all org types. */
  private extractUid(resourceId: string | undefined | null): string {
    if (!resourceId) return '';
    const colonIdx = resourceId.indexOf(':');
    return colonIdx === -1 ? resourceId : resourceId.substring(colonIdx + 1);
  }

  /**
   * D-003 — batch-fetch b2b_org indexed docs, returning `uid → doc`. Uids missing from the upstream
   * response are absent from the result.
   *
   * URL-length guard: `tags` is expanded into repeated query parameters (`api-client.service.ts`
   * line ~341) so `safeUids.length` at the ORG_ROLE_GRANTS_HARD_CAP ceiling (500) would produce a
   * ~19 KB GET — well past the repo's documented `QUERY_SERVICE_FILTERS_OR_BATCH_SIZE = 100` guard
   * (`packages/shared/src/constants/api.constants.ts`). Chunked and fanned out with
   * `Promise.allSettled`, following the same pattern used in `mailing-list.service.ts` and
   * `committee.service.ts`. Failed chunks are logged and skipped — a partial result degrades one
   * caller's list rather than fail-closing the entire role-grants read.
   */
  private async fetchOrgDetailsByUids(req: Request, uids: string[]): Promise<Map<string, B2bOrgIndexedDoc>> {
    const safeUids = this.filterSafeUids(req, uids, 'fetch_org_details_by_uids');
    if (safeUids.length === 0) return new Map();

    const chunks: string[][] = [];
    for (let i = 0; i < safeUids.length; i += QUERY_SERVICE_FILTERS_OR_BATCH_SIZE) {
      chunks.push(safeUids.slice(i, i + QUERY_SERVICE_FILTERS_OR_BATCH_SIZE));
    }

    const settled = await Promise.allSettled(
      chunks.map((chunk) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'b2b_org',
          tags: chunk.map((uid) => `b2b_org_uid:${uid}`),
          // Parameter is `page_size` — see the note on the settings fetch above. Every chunk is
          // <= QUERY_SERVICE_FILTERS_OR_BATCH_SIZE, so this is always well under the upstream
          // MaxPageSize of 1000.
          page_size: chunk.length,
        })
      )
    );

    const map = new Map<string, B2bOrgIndexedDoc>();
    for (const result of settled) {
      if (result.status === 'rejected') {
        logger.warning(req, 'fetch_org_details_by_uids', 'One chunk of b2b_org details fetch failed; degrading to partial result', {
          err: result.reason,
        });
        continue;
      }
      for (const resource of result.value?.resources ?? []) {
        const uid = this.extractUid(resource.id);
        if (uid && resource.data) {
          map.set(uid, resource.data);
        }
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
        // Parameter is `page_size` — see the note on the settings fetch above.
        page_size: 100,
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

  private toRoleGrantsResponse(resolved: Map<string, ResolvedOrgRole>, username: string, loadedAt: string, isStaff: boolean): RoleGrantsResponse {
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

    return { writers, auditors, cascadingWriters, cascadingAuditors, username, loaded_at: loadedAt, isStaff };
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
