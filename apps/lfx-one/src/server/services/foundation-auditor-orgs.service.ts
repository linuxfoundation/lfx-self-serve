// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE,
  FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP,
  FOUNDATION_AUDITOR_SEARCH_CANDIDATE_CAP,
  FOUNDATION_AUDITOR_SEARCH_MIN_TERM_LENGTH,
  FOUNDATION_MEMBERSHIP_PAGE_SIZE,
} from '@lfx-one/shared/constants';
import { B2bOrgIndexedDoc, FoundationAuditorOrgEntry, ProjectMembershipDoc, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Env kill-switch for the LFXV2-2750 foundation-auditor org-selector path. Defaults **disabled**.
 * Set `FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED=true` to activate.
 */
export function isFoundationAuditorOrgSelectorEnabled(): boolean {
  return process.env['FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED'] === 'true';
}

/**
 * LFXV2-2750 — surfaces member organizations of foundations the caller audits, view-only, in the
 * org-selector typeahead.
 *
 * **Search-driven by design.** An earlier eager approach (enumerate every foundation → access-check each →
 * page every audited foundation's full membership roster) does not scale: for a caller who audits many
 * foundations it drove minute-long query-service pagination and blocked the dropdown. This implementation
 * inverts the lookup so cost scales with the *search term*, not with the caller's access breadth:
 *
 *   1. M2M: search `b2b_org` by name → a small candidate set (bounded by `FOUNDATION_AUDITOR_SEARCH_CANDIDATE_CAP`).
 *   2. M2M: fetch `project_membership` rows for **those candidates only** (batched by `b2b_org_uid` tag);
 *      keep active/purchased memberships and collect their distinct foundation uids.
 *   3. USER token: batch access-check `project:<uid>#auditor` on that small foundation set.
 *   4. Keep candidates with at least one active membership in an audited foundation.
 *
 * The M2M elevation covers only steps 1–2, because a project auditor does NOT inherit `auditor` on the
 * underlying `b2b_org` (and `b2b_org` has no public viewer), so the caller's own token cannot read member-org
 * display docs. Authorization is still decided on the **user** token in step 3 — M2M never widens what the
 * caller may see, it only fetches display data for orgs the user's own auditor grant already covers.
 *
 * Failure model: every step is fail-hard here; the caller (`OrgNavigationService`) catches and falls back to
 * the grants-only list. The access-check step fails closed in-band (`checkAccess` returns all-`false`).
 */
export class FoundationAuditorOrgsService {
  // Active membership statuses (case-insensitive) — mirrors OrgMembershipResolverService and
  // OrgPeopleKeyContactsService so terminated/expired memberships don't surface stale member orgs.
  private static readonly activeMembershipStatuses = new Set(['active', 'purchased']);

  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.accessCheck = new AccessCheckService();
  }

  /**
   * Resolve member orgs matching `searchTerm` that belong to a foundation the caller audits.
   * Returns an empty list for a too-short term (the typeahead is the only entry point — there is no
   * eager "list everything" mode, by design).
   */
  public async findAuditedMemberOrgs(req: Request, searchTerm: string | undefined): Promise<FoundationAuditorOrgEntry[]> {
    const term = searchTerm?.trim() ?? '';
    if (term.length < FOUNDATION_AUDITOR_SEARCH_MIN_TERM_LENGTH) {
      return [];
    }

    const originalToken = req.bearerToken;
    const m2mToken = await generateM2MToken(req);

    let candidates: FoundationAuditorOrgEntry[];
    let membershipsByOrgUid: Map<string, ProjectMembershipDoc[]>;
    req.bearerToken = m2mToken;
    try {
      candidates = await this.searchOrgCandidates(req, term);
      if (candidates.length === 0) return [];
      membershipsByOrgUid = await this.fetchMembershipsForOrgs(
        req,
        candidates.map((c) => c.uid)
      );
    } finally {
      // Restore before the access-check — authorization must be decided on the caller's own token.
      req.bearerToken = originalToken;
    }

    // Distinct foundation uids referenced by the candidates' ACTIVE memberships (small set).
    const foundationUids = new Set<string>();
    for (const memberships of membershipsByOrgUid.values()) {
      for (const membership of memberships) {
        const projectUid = membership.project_uid;
        if (!projectUid || !isFilterSafeIdentifier(projectUid)) continue;
        if (!FoundationAuditorOrgsService.isActiveMembership(membership)) continue;
        foundationUids.add(projectUid);
      }
    }
    if (foundationUids.size === 0) return [];

    const auditedFoundationUids = await this.filterAuditedFoundations(req, [...foundationUids]);
    if (auditedFoundationUids.size === 0) return [];

    // Keep candidates with >=1 active membership in an audited foundation.
    const matched = candidates.filter((candidate) =>
      (membershipsByOrgUid.get(candidate.uid) ?? []).some(
        (m) => FoundationAuditorOrgsService.isActiveMembership(m) && !!m.project_uid && auditedFoundationUids.has(m.project_uid)
      )
    );

    logger.debug(req, 'find_audited_member_orgs', 'Resolved foundation-auditor member orgs', {
      term_length: term.length,
      candidates: candidates.length,
      foundations_checked: foundationUids.size,
      foundations_audited: auditedFoundationUids.size,
      matched: matched.length,
    });

    return matched.slice(0, FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP);
  }

  private static isActiveMembership(membership: ProjectMembershipDoc): boolean {
    return FoundationAuditorOrgsService.activeMembershipStatuses.has((membership.status ?? '').toLowerCase());
  }

  /** M2M: name-search `b2b_org` for a bounded candidate set. */
  private async searchOrgCandidates(req: Request, term: string): Promise<FoundationAuditorOrgEntry[]> {
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'b2b_org',
      name: term,
      per_page: FOUNDATION_AUDITOR_SEARCH_CANDIDATE_CAP,
    });

    const entries: FoundationAuditorOrgEntry[] = [];
    const seen = new Set<string>();
    for (const resource of response?.resources ?? []) {
      const uid = this.extractUid(resource.id);
      if (!uid || seen.has(uid) || !isFilterSafeIdentifier(uid) || !resource.data) continue;
      seen.add(uid);
      entries.push({ uid, doc: resource.data });
    }
    return entries;
  }

  /** M2M: fetch project_membership rows for the candidate orgs only, batched by `b2b_org_uid` tag. */
  private async fetchMembershipsForOrgs(req: Request, orgUids: string[]): Promise<Map<string, ProjectMembershipDoc[]>> {
    const byOrgUid = new Map<string, ProjectMembershipDoc[]>();

    for (let i = 0; i < orgUids.length; i += FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE) {
      const chunk = orgUids.slice(i, i + FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE);
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<ProjectMembershipDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project_membership',
        tags: chunk.map((uid) => `b2b_org_uid:${uid}`),
        per_page: FOUNDATION_MEMBERSHIP_PAGE_SIZE,
      });

      for (const resource of response?.resources ?? []) {
        const membership = resource.data;
        const orgUid = membership?.b2b_org_uid;
        if (!orgUid) continue;
        const list = byOrgUid.get(orgUid);
        if (list) list.push(membership);
        else byOrgUid.set(orgUid, [membership]);
      }
    }
    return byOrgUid;
  }

  /** USER token: batch access-check `project:<uid>#auditor`; returns the subset the caller audits. */
  private async filterAuditedFoundations(req: Request, foundationUids: string[]): Promise<Set<string>> {
    const audited = new Set<string>();

    for (let i = 0; i < foundationUids.length; i += FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE) {
      const chunk = foundationUids.slice(i, i + FOUNDATION_AUDITOR_BATCH_CHUNK_SIZE);
      const results = await this.accessCheck.checkAccess(
        req,
        chunk.map((uid) => ({ resource: 'project', id: uid, access: 'auditor' }))
      );
      for (const uid of chunk) {
        if (results.get(uid) === true) audited.add(uid);
      }
    }
    return audited;
  }

  /** Strip the `<type>:` prefix query-service prepends on `resource.id` (SFIDs contain no `:`). */
  private extractUid(resourceId: string | undefined | null): string {
    if (!resourceId) return '';
    const colonIdx = resourceId.indexOf(':');
    return colonIdx === -1 ? resourceId : resourceId.substring(colonIdx + 1);
  }
}
