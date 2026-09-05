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
  AccessCheckRequest,
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
    const { resolved, loadedAt, isStaff, degraded } = await this.getAccessAwareOrgs(req, username);
    return this.toRoleGrantsResponse(resolved, username, loadedAt, isStaff, degraded);
  }

  /**
   * LFXV2-3029 — the single "editor from any source" check: true for a direct writer grant OR a
   * cascading (inherited) writer grant reachable through the connected component. Every
   * organization edit surface is meant to widen along with this feature, so a gate that needs a
   * hard "direct only" answer should not be added against this helper without a documented
   * exception; a missed call site that still inlines `writers.includes(uid)` silently stays
   * narrower than the platform authorizer now allows.
   */
  public static hasEditorAccess(grants: Pick<RoleGrantsResponse, 'writers' | 'cascadingWriters'>, orgUid: string): boolean {
    return grants.writers.includes(orgUid) || grants.cascadingWriters.some((entry) => entry.uid === orgUid);
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
      degraded: result.degraded,
    };
  }

  /** Rebuilds the Map-backed result from its serialized cache entry (insertion order preserved). `degraded` defaults to `false` for an entry cached before this field existed, rather than being validated by `isValidCacheEntry` — the pre-existing field carries the whole entry's freshness/correctness signal already. */
  private static deserializeAccessResult(entry: AccessAwareOrgsCacheEntry): AccessAwareOrgsResult {
    return {
      resolved: new Map(entry.resolved),
      orgDocByUid: new Map(entry.orgDocByUid),
      upstreamFailed: entry.upstreamFailed,
      loadedAt: entry.loadedAt,
      username: entry.username,
      isStaff: entry.isStaff,
      degraded: entry.degraded ?? false,
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
      degraded: false,
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
      return { resolved: new Map(), orgDocByUid: new Map(), upstreamFailed: false, loadedAt, username, isStaff, degraded: false };
    }

    const directUids = new Set<string>([...directWriters, ...directAuditors]);

    let directOrgDocs: Map<string, B2bOrgIndexedDoc>;
    try {
      directOrgDocs = await this.fetchOrgDetailsByUids(req, Array.from(directUids));
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream b2b_org details fetch failed', { err: error });
      return { ...empty, upstreamFailed: true, isStaff };
    }

    // LFXV2-3029 — discover every organization reachable from a direct grant by walking
    // `parent_uid` upward and the `parent_b2b_org_uid` tag downward to a fixed point. Discovery
    // only proposes candidates; nothing here grants a role — the authorizer decides that below.
    let walk: { candidates: Map<string, { rootUid: string; rootName: string }>; docByUid: Map<string, B2bOrgIndexedDoc>; truncated: boolean };
    try {
      walk = await this.expandConnectedComponents(req, directUids, directOrgDocs);
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Connected-component walk failed', { err: error });
      return { ...empty, upstreamFailed: true, isStaff };
    }

    // LFXV2-3029 — the authorizer, not the walk, decides who is actually granted.
    // `checkAccessStrict` is used (not the lenient `checkAccess`) so an unverifiable batch is
    // reported as `degraded: true` rather than silently reclassifying discovered organizations as
    // denied — see `classifyCandidates`.
    const { classified, degraded: classificationDegraded } = await this.classifyCandidates(req, walk.candidates);

    const resolved = this.buildResolvedMap(directWriters, directAuditors, classified);
    const orgDocByUid = this.mergeOrgDocs(directOrgDocs, classified, walk.docByUid);

    return { resolved, orgDocByUid, upstreamFailed: false, loadedAt, username, isStaff, degraded: classificationDegraded || walk.truncated };
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
   * `Promise.allSettled`, following the same pattern used in `committee.service.ts` and
   * `access-check.service.ts`. Failed chunks are logged and skipped — a partial result degrades
   * one caller's list rather than fail-closing the entire role-grants read.
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

    // Total-failure fail-closed: if EVERY chunk rejected, propagate so the caller sets
    // `upstreamFailed: true` — otherwise `computeAccessAwareOrgs` would cache an empty grant
    // list as successful for the ~30s TTL and hide a live outage from every caller that hits it.
    // Partial failures still degrade (some chunks land, some are lost) since a caller with
    // 400/500 grants shouldn't lose their entire session over one flaky chunk.
    const rejected = settled.filter((result) => result.status === 'rejected');
    if (rejected.length === settled.length) {
      throw new Error(`fetchOrgDetailsByUids: every chunk failed (${rejected.length}/${settled.length}); refusing to cache empty result`);
    }

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

  /**
   * LFXV2-3029 — bidirectional connected-component walk. For each direct-granted organization,
   * discovers every organization reachable by repeatedly following `parent_uid` upward and the
   * `parent_b2b_org_uid` tag downward, iterating to a fixed point (a visited set guards against a
   * cycle in the hierarchy data). Bounded per source grant by the existing (not a new)
   * `ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP` constant.
   *
   * Discovery only proposes candidates and records the root grant that reached them (used as the
   * provenance parent for the tooltip); `classifyCandidates` asks the authorizer before any role
   * is assigned. A root already reachable from another root's walk still runs its own walk
   * (simpler and correct, at the cost of some redundant upstream calls when two direct grants
   * share a component) — `docByUid` is shared across roots so a node discovered once is never
   * re-fetched.
   */
  private async expandConnectedComponents(
    req: Request,
    directUids: Set<string>,
    directOrgDocs: Map<string, B2bOrgIndexedDoc>
  ): Promise<{ candidates: Map<string, { rootUid: string; rootName: string }>; docByUid: Map<string, B2bOrgIndexedDoc>; truncated: boolean }> {
    const docByUid = new Map<string, B2bOrgIndexedDoc>(directOrgDocs);
    // Deterministic provenance: when a candidate is reached from more than one root grant, keep
    // the nearest (smallest BFS depth) root, tie-broken by root name so the choice never depends
    // on `Set` iteration order (which JS does not guarantee across engines for a Set built from
    // spread/union operations, even though V8 happens to preserve insertion order today).
    const depthByCandidate = new Map<string, number>();
    const candidates = new Map<string, { rootUid: string; rootName: string }>();
    let truncated = false;

    for (const rootUid of directUids) {
      const rootName = directOrgDocs.get(rootUid)?.name ?? '';
      const visited = new Set<string>([rootUid]);
      let frontier = [rootUid];
      let discovered = 0;
      let depth = 0;

      while (frontier.length > 0 && discovered < ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP) {
        depth++;
        // Ascend: each frontier node's own parent_uid (its doc is already known — either a direct
        // grant or discovered on a prior iteration of this walk).
        const parentUidsToFetch = [...new Set(frontier.map((uid) => docByUid.get(uid)?.parent_uid).filter((uid): uid is string => !!uid && !docByUid.has(uid)))];

        // Descend: children tagged `parent_b2b_org_uid:<uid>` for every frontier node that is
        // flagged `is_parent` — the same hint the direct-grant path below uses to skip a wasted
        // query for a node known to have no children.
        const descendFrom = frontier.filter((uid) => docByUid.get(uid)?.is_parent === true);
        const [parentDocs, childrenByParent] = await Promise.all([
          parentUidsToFetch.length > 0 ? this.fetchOrgDetailsByUids(req, parentUidsToFetch) : Promise.resolve(new Map<string, B2bOrgIndexedDoc>()),
          descendFrom.length > 0 ? this.fetchCascadingChildren(req, this.filterSafeUids(req, descendFrom, 'expand_connected_component')) : Promise.resolve(new Map<string, B2bOrgIndexedDoc[]>()),
        ]);

        const nextFrontier = new Set<string>();
        for (const [uid, doc] of parentDocs) {
          if (!docByUid.has(uid)) docByUid.set(uid, doc);
          nextFrontier.add(uid);
        }
        for (const [, children] of childrenByParent) {
          for (const child of children) {
            const childUid = (child as B2bOrgIndexedDoc & { uid?: string }).uid;
            if (!childUid) continue;
            if (!docByUid.has(childUid)) docByUid.set(childUid, child);
            nextFrontier.add(childUid);
          }
        }

        frontier = [];
        for (const uid of nextFrontier) {
          if (visited.has(uid)) continue;
          if (discovered >= ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP) {
            truncated = true;
            break;
          }
          visited.add(uid);
          discovered++;
          frontier.push(uid);
          if (!directUids.has(uid)) {
            const existingDepth = depthByCandidate.get(uid);
            const existing = candidates.get(uid);
            const isNearer = existingDepth === undefined || depth < existingDepth;
            const isTieBreakWinner = depth === existingDepth && !!existing && rootName.localeCompare(existing.rootName) < 0;
            if (isNearer || isTieBreakWinner) {
              depthByCandidate.set(uid, depth);
              candidates.set(uid, { rootUid, rootName });
            }
          }
        }
      }

      if (frontier.length > 0 && discovered >= ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP) {
        truncated = true;
      }
    }

    if (truncated) {
      logger.warning(req, 'expand_connected_component', 'Per-source-grant connected-component cap reached — traversal truncated', {
        cap: ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP,
      });
    }

    return { candidates, docByUid, truncated };
  }

  /**
   * LFXV2-3029 — asks the platform authorizer to classify traversal candidates; the walk never
   * assigns a role itself. Checks both `writer` and `auditor` per candidate in one batched call
   * (chunked internally at `ACCESS_CHECK_BATCH_SIZE`) — a writer candidate is also an auditor per
   * the FGA model, so the two checks are independent lookups, not a fallback chain. A candidate
   * that resolves to neither was reachable by the walk but is not actually granted (e.g. a stale
   * hierarchy edge) and is excluded entirely.
   *
   * Uses `checkAccessStrict`, not the lenient `checkAccess`, so an unverifiable batch reports
   * `degraded: true` instead of quietly reclassifying every candidate as denied — the
   * organization-list path must say "this list may be incomplete", never "you have no access
   * here" for an organization the caller held a moment ago.
   */
  private async classifyCandidates(
    req: Request,
    candidates: Map<string, { rootUid: string; rootName: string }>
  ): Promise<{ classified: Map<string, { role: 'writer' | 'auditor'; parentUid: string; parentName: string }>; degraded: boolean }> {
    const classified = new Map<string, { role: 'writer' | 'auditor'; parentUid: string; parentName: string }>();
    if (candidates.size === 0) return { classified, degraded: false };

    const uids = [...candidates.keys()];
    const requests: AccessCheckRequest[] = [];
    for (const uid of uids) {
      requests.push({ resource: 'b2b_org', id: uid, access: 'writer' });
      requests.push({ resource: 'b2b_org', id: uid, access: 'auditor' });
    }

    let results: Map<string, boolean>;
    try {
      results = await this.accessCheck.checkAccessStrict(req, requests);
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Authoritative classification of connected-component candidates failed; excluding them and reporting degraded', {
        candidate_count: uids.length,
        err: error,
      });
      return { classified, degraded: true };
    }

    for (const uid of uids) {
      const provenance = candidates.get(uid);
      if (!provenance) continue;
      const isWriter = results.get(`${uid}#writer`) === true;
      const isAuditor = results.get(`${uid}#auditor`) === true;
      if (isWriter) {
        classified.set(uid, { role: 'writer', parentUid: provenance.rootUid, parentName: provenance.rootName });
      } else if (isAuditor) {
        classified.set(uid, { role: 'auditor', parentUid: provenance.rootUid, parentName: provenance.rootName });
      }
    }

    return { classified, degraded: false };
  }

  /**
   * LFXV2-3029 — authority-first precedence: direct-writer, then inherited-writer, then
   * direct-auditor, then inherited-auditor. This replaces the previous directness-first order:
   * an inherited-writer now outranks a direct-auditor on the same organization ("editor wins" on
   * a mixed grant) — a viewer grant on a subsidiary must not shadow the editing authority a
   * roll-up grant confers on that same subsidiary.
   */
  private buildResolvedMap(
    directWriters: Set<string>,
    directAuditors: Set<string>,
    classified: Map<string, { role: 'writer' | 'auditor'; parentUid: string; parentName: string }>
  ): Map<string, ResolvedOrgRole> {
    const rank: Record<OrgRolePersona, number> = { 'direct-writer': 4, 'inherited-writer': 3, 'direct-auditor': 2, 'inherited-auditor': 1 };
    const resolved = new Map<string, ResolvedOrgRole>();

    const setIfHigher = (uid: string, entry: ResolvedOrgRole): void => {
      const existing = resolved.get(uid);
      if (!existing || rank[entry.roleSource] > rank[existing.roleSource]) {
        resolved.set(uid, entry);
      }
    };

    for (const uid of directWriters) {
      setIfHigher(uid, { roleSource: 'direct-writer' });
    }
    for (const uid of directAuditors) {
      setIfHigher(uid, { roleSource: 'direct-auditor' });
    }
    for (const [uid, entry] of classified) {
      const roleSource: OrgRolePersona = entry.role === 'writer' ? 'inherited-writer' : 'inherited-auditor';
      setIfHigher(uid, { roleSource, parentUid: entry.parentUid, parentName: entry.parentName });
    }

    return resolved;
  }

  /** Build a uid→doc lookup covering both direct and classified-inherited rows; direct entries win on collision. Only classified (authorizer-granted) candidates are included — a denied-on-recheck candidate never leaks its doc into the switcher. */
  private mergeOrgDocs(
    directOrgDocs: Map<string, B2bOrgIndexedDoc>,
    classified: Map<string, { role: 'writer' | 'auditor'; parentUid: string; parentName: string }>,
    docByUid: Map<string, B2bOrgIndexedDoc>
  ): Map<string, B2bOrgIndexedDoc> {
    const merged = new Map<string, B2bOrgIndexedDoc>();

    for (const uid of classified.keys()) {
      const doc = docByUid.get(uid);
      if (doc) merged.set(uid, doc);
    }
    for (const [uid, doc] of directOrgDocs) {
      merged.set(uid, doc);
    }

    return merged;
  }

  private toRoleGrantsResponse(resolved: Map<string, ResolvedOrgRole>, username: string, loadedAt: string, isStaff: boolean, degraded: boolean): RoleGrantsResponse {
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
          // No longer a dead branch: the FGA model change (LFXV2-3029) makes `writer` cascade,
          // and `buildResolvedMap` now asks the authorizer instead of hard-coding 'inherited-auditor'.
          cascadingWriters.push({ uid, parentUid: role.parentUid ?? '', parentName: role.parentName ?? '' });
          break;
        case 'inherited-auditor':
          cascadingAuditors.push({ uid, parentUid: role.parentUid ?? '', parentName: role.parentName ?? '' });
          break;
      }
    }

    return { writers, auditors, cascadingWriters, cascadingAuditors, username, loaded_at: loadedAt, isStaff, degraded };
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
