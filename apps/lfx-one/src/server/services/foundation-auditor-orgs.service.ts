// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE,
  FOUNDATION_AUDITOR_MAX_FOUNDATIONS,
  FOUNDATION_AUDITOR_MEMBER_CACHE_TTL_MS,
  FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP,
  FOUNDATION_AUDITOR_ROSTER_FETCH_CONCURRENCY,
  FOUNDATION_AUDITOR_ROSTER_PAGE_SIZE,
  FOUNDATION_AUDITOR_SEARCH_MIN_TERM_LENGTH,
  ORG_ROLE_GRANTS_HARD_CAP,
} from '@lfx-one/shared/constants';
import { ProjectFunding, ProjectStage } from '@lfx-one/shared/enums';
import {
  AuditedFoundation,
  B2bOrgIndexedDoc,
  FoundationAuditorOrgEntry,
  Project,
  ProjectMembershipDoc,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation, isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** Memoized per-caller member-org set. */
interface MemberOrgsMemo {
  expiresAt: number;
  orgs: FoundationAuditorOrgEntry[];
}

/**
 * Env kill-switch for the LFXV2-2750 foundation-auditor org-selector path. Defaults **disabled**.
 * Set `FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED=true` to activate.
 */
export function isFoundationAuditorOrgSelectorEnabled(): boolean {
  return process.env['FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED'] === 'true';
}

/**
 * LFXV2-2750 — surfaces member organizations of foundations the caller audits, view-only, in the org-selector.
 *
 * **Foundation-scoped and strictly bounded.** An earlier design failed on real data:
 *  - *Eager, fully paginated*: deep-paginated every audited foundation's roster (page 12+, query-service 500s)
 *    and hung the dropdown for minutes on a broad-access caller.
 *
 * The roster read itself was blocked until LFXV2-2752: `project_membership` docs carried no usable
 * foundation-pivot tag (root cause LFXV2-2733 — docs were indexed with an empty `project_uid`). That's
 * fixed and reindexed; `tags:project_uid:<foundation-uid>` is now the supported pivot (see `collectMemberOrgUids`).
 *
 * So the shape here is: foundations are a small set (~56), which makes enumerate + one batched
 * `project:<uid>#auditor` check cheap. The expensive part — roster reads — is bounded hard:
 *
 *   1. Enumerate foundations (single query, locally re-checked with `computeIsFoundation`).
 *   2. USER token: batched `project:<uid>#auditor` access-check → the audited subset.
 *   3. M2M: **first page only** per audited foundation (never deep pagination), bounded concurrency,
 *      capped at `FOUNDATION_AUDITOR_MAX_FOUNDATIONS` foundations and `FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP` orgs.
 *   4. M2M: batch-fetch the `b2b_org` display docs for the collected uids.
 *
 * The result is memoized per caller (`FOUNDATION_AUDITOR_MEMBER_CACHE_TTL_MS`) so a typeahead doesn't refetch
 * rosters on every keystroke; the caller filters the memoized set by search term in-memory.
 *
 * M2M elevation covers only the roster/display reads — a project auditor does NOT inherit `auditor` on the
 * underlying `b2b_org` (which has no public viewer), so the caller's own token cannot read those docs.
 * Authorization is still decided on the **user** token in step 2; M2M never widens what the caller may see.
 *
 * Known limit: with only the first roster page per foundation, a very large foundation's membership is
 * truncated, so some member orgs won't surface. Documented trade-off — the alternative hangs the dropdown.
 */
export class FoundationAuditorOrgsService {
  // Active membership statuses (case-insensitive) — mirrors OrgMembershipResolverService and
  // OrgPeopleKeyContactsService so terminated/expired memberships don't surface stale member orgs.
  private static readonly activeMembershipStatuses = new Set(['active', 'purchased']);

  // Per-process memo keyed by caller username. Short TTL; a miss just costs one bounded refetch.
  // Swept on an interval below since expiresAt only blocks reuse — it doesn't reclaim the entry.
  private static readonly memberOrgsMemo = new Map<string, MemberOrgsMemo>();

  // Per-process coalescing of concurrent cold-cache resolutions for the same username, mirroring
  // OrgRoleGrantsService.accessInFlight — a typeahead burst shares one upstream fan-out instead of
  // each request repeating foundation enumeration, access-checks, and roster reads.
  private static readonly memberOrgsInFlight = new Map<string, Promise<FoundationAuditorOrgEntry[]>>();

  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.accessCheck = new AccessCheckService();

    // Reclaims expired memo entries; expiresAt alone only prevents reuse, it never frees the Map slot.
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of FoundationAuditorOrgsService.memberOrgsMemo) {
        if (now >= entry.expiresAt) {
          FoundationAuditorOrgsService.memberOrgsMemo.delete(key);
        }
      }
    }, 60_000).unref();
  }

  /**
   * Member orgs of the caller's audited foundations, filtered by `searchTerm`. Returns empty for a
   * too-short term so the default dropdown stays on the grants-only fast path.
   */
  public async findAuditedMemberOrgs(req: Request, username: string, searchTerm: string | undefined): Promise<FoundationAuditorOrgEntry[]> {
    const term = searchTerm?.trim().toLowerCase() ?? '';
    if (term.length < FOUNDATION_AUDITOR_SEARCH_MIN_TERM_LENGTH) {
      logger.debug(req, 'find_audited_member_orgs', 'Skipped — search term below minimum length', { term_length: term.length });
      return [];
    }

    const all = await this.resolveMemberOrgs(req, username);
    const matched = all.filter((entry) => (entry.doc.name ?? '').toLowerCase().includes(term));

    logger.debug(req, 'find_audited_member_orgs', 'Filtered memoized member orgs by search term', {
      term_length: term.length,
      pool: all.length,
      matched: matched.length,
    });
    return matched.slice(0, FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP);
  }

  /** Resolve (and memoize) the caller's full audited member-org pool. Coalesces concurrent cold-cache callers. */
  private async resolveMemberOrgs(req: Request, username: string): Promise<FoundationAuditorOrgEntry[]> {
    const memo = FoundationAuditorOrgsService.memberOrgsMemo.get(username);
    if (memo && memo.expiresAt > Date.now()) {
      return memo.orgs;
    }

    const inFlight = FoundationAuditorOrgsService.memberOrgsInFlight.get(username);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.computeMemberOrgs(req, username);
    FoundationAuditorOrgsService.memberOrgsInFlight.set(username, promise);
    try {
      return await promise;
    } finally {
      FoundationAuditorOrgsService.memberOrgsInFlight.delete(username);
    }
  }

  /** Cold-cache resolution: foundation enumeration → audited subset → M2M roster/display reads. */
  private async computeMemberOrgs(req: Request, username: string): Promise<FoundationAuditorOrgEntry[]> {
    const foundations = await this.enumerateFoundations(req);
    if (foundations.length === 0) {
      logger.debug(req, 'resolve_member_orgs', 'No foundations enumerated', {});
      return this.memoize(username, []);
    }

    const auditedUids = await this.filterAuditedFoundations(req, foundations);
    if (auditedUids.length === 0) {
      logger.debug(req, 'resolve_member_orgs', 'Caller audits none of the enumerated foundations', {
        foundations_checked: foundations.length,
      });
      return this.memoize(username, []);
    }

    const capped = auditedUids.slice(0, FOUNDATION_AUDITOR_MAX_FOUNDATIONS);
    const originalToken = req.bearerToken;
    const m2mToken = await generateM2MToken(req);
    let orgs: FoundationAuditorOrgEntry[];
    req.bearerToken = m2mToken;
    try {
      const orgUids = await this.collectMemberOrgUids(req, capped);
      orgs = orgUids.length === 0 ? [] : await this.fetchOrgDocs(req, orgUids);
    } finally {
      req.bearerToken = originalToken;
    }

    logger.debug(req, 'resolve_member_orgs', 'Resolved audited member-org pool', {
      foundations_checked: foundations.length,
      foundations_audited: auditedUids.length,
      foundations_pulled: capped.length,
      member_orgs: orgs.length,
    });
    return this.memoize(username, orgs);
  }

  private memoize(username: string, orgs: FoundationAuditorOrgEntry[]): FoundationAuditorOrgEntry[] {
    FoundationAuditorOrgsService.memberOrgsMemo.set(username, { expiresAt: Date.now() + FOUNDATION_AUDITOR_MEMBER_CACHE_TTL_MS, orgs });
    return orgs;
  }

  /** Foundation enumeration (mirrors NavigationService's foundation query). Single page — foundations are a small set. */
  private async enumerateFoundations(req: Request): Promise<AuditedFoundation[]> {
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'project',
      filters: [`funding:${ProjectFunding.Funded}`, 'funding_model:Membership'],
      filters_or: [`stage:${ProjectStage.Active}`, `stage:${ProjectStage.FormationEngaged}`],
      page_size: ORG_ROLE_GRANTS_HARD_CAP,
    });

    const foundations: AuditedFoundation[] = [];
    const seen = new Set<string>();
    for (const resource of response?.resources ?? []) {
      const project = resource.data;
      // legal_entity_type negation isn't filterable upstream — re-check locally.
      if (!project || !computeIsFoundation(project)) continue;
      const uid = project.uid;
      // uid feeds both the access-check tuple and the `project_uid:` membership pivot tag.
      if (!uid || !isFilterSafeIdentifier(uid) || seen.has(uid)) continue;
      seen.add(uid);
      foundations.push({ uid });
    }
    return foundations;
  }

  /** USER token: batched `project:<uid>#auditor`; returns the audited subset (order preserved). */
  private async filterAuditedFoundations(req: Request, foundations: AuditedFoundation[]): Promise<AuditedFoundation[]> {
    const audited: AuditedFoundation[] = [];

    for (let i = 0; i < foundations.length; i += FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE) {
      const chunk = foundations.slice(i, i + FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE);
      const results = await this.accessCheck.checkAccess(
        req,
        chunk.map((f) => ({ resource: 'project', id: f.uid, access: 'auditor' }))
      );
      for (const foundation of chunk) {
        if (results.get(`${foundation.uid}#auditor`) === true) audited.push(foundation);
      }
    }
    return audited;
  }

  /**
   * M2M: FIRST PAGE ONLY of each audited foundation's roster, through a bounded-concurrency pool.
   * Pivots by `tags:project_uid:<uid>` (LFXV2-2752) — the supported foundation→members lookup on
   * `project_membership` docs.
   *
   * Accumulates into the shared cap as each page lands (rather than after every foundation has been
   * fetched) so a satisfied cap stops the pool from claiming further foundations — the read cost is
   * bounded, not just the result. Order is preserved within each concurrent batch of
   * `FOUNDATION_AUDITOR_ROSTER_FETCH_CONCURRENCY` in-flight foundations, but — since pages land in
   * completion order, not strict index order — is only approximately, not strictly, index-ordered
   * across the full list once concurrency is in play.
   *
   * Workers are run to completion via `Promise.allSettled`, not `Promise.all`: the caller (`computeMemberOrgs`)
   * restores the original bearer token in a `finally` immediately after this resolves/rejects, so every
   * worker's M2M-scoped requests must have actually finished first — an early `Promise.all` rejection would
   * let straggler workers fire their next request under the already-restored user token.
   */
  private async collectMemberOrgUids(req: Request, foundations: AuditedFoundation[]): Promise<string[]> {
    const orderedUids: string[] = [];
    const seen = new Set<string>();
    let truncated = false;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (!truncated && cursor < foundations.length) {
        const index = cursor++;
        const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<ProjectMembershipDoc>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'project_membership',
            tags: `project_uid:${foundations[index].uid}`,
            page_size: FOUNDATION_AUDITOR_ROSTER_PAGE_SIZE,
          }
        );
        if (truncated) return; // cap satisfied while this request was in flight — discard the page.

        const roster = (response?.resources ?? []).map((r) => r.data).filter(Boolean);
        for (const membership of roster) {
          const uid = membership?.b2b_org_uid;
          if (!uid || !isFilterSafeIdentifier(uid) || seen.has(uid)) continue;
          if (!FoundationAuditorOrgsService.activeMembershipStatuses.has((membership.status ?? '').toLowerCase())) continue;
          seen.add(uid);
          orderedUids.push(uid);
          if (orderedUids.length >= FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP) {
            truncated = true;
            break;
          }
        }
      }
    };

    const poolSize = Math.min(FOUNDATION_AUDITOR_ROSTER_FETCH_CONCURRENCY, foundations.length);
    const settled = await Promise.allSettled(Array.from({ length: poolSize }, () => worker()));
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) {
      throw failure.reason;
    }

    if (truncated) {
      logger.warning(req, 'collect_member_org_uids', 'Member-org cap reached — truncating', { cap: FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP });
    }
    return orderedUids;
  }

  /** M2M: batch-fetch b2b_org display docs by uid tag (chunked to bound request size). */
  private async fetchOrgDocs(req: Request, uids: string[]): Promise<FoundationAuditorOrgEntry[]> {
    const entries: FoundationAuditorOrgEntry[] = [];

    for (let i = 0; i < uids.length; i += FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE) {
      const chunk = uids.slice(i, i + FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE);
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'b2b_org',
        tags: chunk.map((uid) => `b2b_org_uid:${uid}`),
        page_size: Math.min(chunk.length + 10, ORG_ROLE_GRANTS_HARD_CAP),
      });

      for (const resource of response?.resources ?? []) {
        const uid = this.extractUid(resource.id);
        if (uid && resource.data) entries.push({ uid, doc: resource.data });
      }
    }
    return entries;
  }

  /** Strip the `<type>:` prefix query-service prepends on `resource.id` (SFIDs contain no `:`). */
  private extractUid(resourceId: string | undefined | null): string {
    if (!resourceId) return '';
    const colonIdx = resourceId.indexOf(':');
    return colonIdx === -1 ? resourceId : resourceId.substring(colonIdx + 1);
  }
}
