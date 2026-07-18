// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectFunding, ProjectStage } from '@lfx-one/shared/enums';
import {
  FOUNDATION_AUDITOR_ENUMERATION_HARD_CAP,
  FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP,
  FOUNDATION_AUDITOR_MEMBERSHIP_FETCH_CONCURRENCY,
  FOUNDATION_MEMBERSHIP_PAGE_SIZE,
  ORG_ROLE_GRANTS_HARD_CAP,
} from '@lfx-one/shared/constants';
import { AuditedFoundation, B2bOrgIndexedDoc, FoundationMemberOrgs, Project, ProjectMembershipDoc, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { computeIsFoundation, isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Env kill-switch for the LFXV2-2750 foundation-auditor org-selector path. Defaults **disabled** — this
 * augmentation adds an enumerate-all-foundations + batch `project:<uid>#auditor` access-check to the
 * org-selector hot path for every caller, so it is opt-in. Set `FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED=true`
 * to activate.
 */
export function isFoundationAuditorOrgSelectorEnabled(): boolean {
  return process.env['FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED'] === 'true';
}

/**
 * LFXV2-2750 — resolves the member organizations of every foundation the caller audits, so the org-selector
 * can list them view-only. All reads are fail-hard here (thrown errors bubble to the caller, which fails
 * closed to the grants-only list). The member-org display fetch is M2M-elevated because a project auditor
 * does NOT inherit `auditor` on the underlying `b2b_org` (and `b2b_org` has no public viewer), so the
 * caller's own token cannot see member-org display docs.
 */
export class FoundationAuditorOrgsService {
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly accessCheck: AccessCheckService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.accessCheck = new AccessCheckService();
  }

  /**
   * Enumerate all foundations (public `viewer` on projects makes this an access-blind list) and batch
   * access-check `project:<uid>#auditor` on the caller's USER token; return the ones that pass. The
   * access-check auto-folds ED / writer / parent-auditor inheritance per the FGA model.
   */
  public async discoverAuditedFoundations(req: Request): Promise<AuditedFoundation[]> {
    const foundations = await this.enumerateFoundations(req);
    if (foundations.length === 0) return [];

    const accessResults = await this.accessCheck.checkAccess(
      req,
      foundations.map((f) => ({ resource: 'project', id: f.uid, access: 'auditor' }))
    );

    return foundations.filter((f) => accessResults.get(f.uid) === true);
  }

  /**
   * M2M-elevated: for each audited foundation, page its `project_membership` roster by `project_slug`,
   * collect distinct member-org uids (bounded), then batch-fetch the `b2b_org` display docs. The user
   * token is swapped to an M2M token only for these reads and restored in `finally`.
   */
  public async fetchMemberOrgs(req: Request, foundations: AuditedFoundation[]): Promise<FoundationMemberOrgs> {
    if (foundations.length === 0) {
      return { orgUids: [], orgDocByUid: new Map() };
    }

    const originalToken = req.bearerToken;
    const m2mToken = await generateM2MToken(req);
    req.bearerToken = m2mToken;
    try {
      const orgUids = await this.collectMemberOrgUids(req, foundations);
      if (orgUids.length === 0) {
        return { orgUids: [], orgDocByUid: new Map() };
      }
      const orgDocByUid = await this.fetchOrgDocsByUids(req, orgUids);
      // Keep only uids that actually resolved to a display doc, preserving enumeration order.
      const resolvedUids = orgUids.filter((uid) => orgDocByUid.has(uid));
      return { orgUids: resolvedUids, orgDocByUid };
    } finally {
      req.bearerToken = originalToken;
    }
  }

  /** Foundation-lens enumeration (mirrors NavigationService's foundation query), paged to completion, then capped. */
  private async enumerateFoundations(req: Request): Promise<AuditedFoundation[]> {
    const projects = await fetchAllQueryResources<Project>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project',
        // Funding + membership required (AND); Active or Formation - Engaged accepted (OR).
        filters: [`funding:${ProjectFunding.Funded}`, 'funding_model:Membership'],
        filters_or: [`stage:${ProjectStage.Active}`, `stage:${ProjectStage.FormationEngaged}`],
        per_page: FOUNDATION_MEMBERSHIP_PAGE_SIZE,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    const seen = new Set<string>();
    const foundations: AuditedFoundation[] = [];
    for (const project of projects) {
      // legal_entity_type negation isn't filterable upstream — re-check locally.
      if (!computeIsFoundation(project)) continue;
      const uid = project.uid;
      // uid is interpolated into the access-check tuple `project:<uid>#auditor`.
      if (!uid || !isFilterSafeIdentifier(uid) || seen.has(uid)) continue;
      seen.add(uid);
      foundations.push({ uid, slug: project.slug });
      if (foundations.length >= FOUNDATION_AUDITOR_ENUMERATION_HARD_CAP) {
        logger.warning(req, 'enumerate_foundations', 'Foundation enumeration cap reached — truncating auditor check', {
          cap: FOUNDATION_AUDITOR_ENUMERATION_HARD_CAP,
        });
        break;
      }
    }
    return foundations;
  }

  /** Page each foundation's project_membership roster (bounded concurrency) and collect distinct member-org uids up to the cap. */
  private async collectMemberOrgUids(req: Request, foundations: AuditedFoundation[]): Promise<string[]> {
    // slug is interpolated into `filters_all: project_slug:<slug>` — drop foundations whose slug is unsafe.
    const safeFoundations = foundations.filter((f) => f.slug && isFilterSafeIdentifier(f.slug));

    const membershipsByIndex: ProjectMembershipDoc[][] = new Array(safeFoundations.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < safeFoundations.length) {
        const index = cursor++;
        membershipsByIndex[index] = await this.fetchFoundationMemberships(req, safeFoundations[index].slug);
      }
    };
    const poolSize = Math.min(FOUNDATION_AUDITOR_MEMBERSHIP_FETCH_CONCURRENCY, safeFoundations.length);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    const orderedUids: string[] = [];
    const seen = new Set<string>();
    let truncated = false;
    for (const memberships of membershipsByIndex) {
      for (const membership of memberships ?? []) {
        const uid = membership.b2b_org_uid;
        if (!uid || seen.has(uid) || !isFilterSafeIdentifier(uid)) continue;
        seen.add(uid);
        orderedUids.push(uid);
        if (orderedUids.length >= FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }

    if (truncated) {
      logger.warning(req, 'collect_member_org_uids', 'Member-org uid cap reached — truncating', {
        cap: FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP,
      });
    }
    return orderedUids;
  }

  /** Paginate one foundation's project_membership roster to completion (M2M token already in place). */
  private fetchFoundationMemberships(req: Request, slug: string): Promise<ProjectMembershipDoc[]> {
    return fetchAllQueryResources<ProjectMembershipDoc>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<ProjectMembershipDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project_membership',
        filters_all: `project_slug:${slug}`,
        per_page: FOUNDATION_MEMBERSHIP_PAGE_SIZE,
        ...(pageToken && { page_token: pageToken }),
      })
    );
  }

  /** Batch-fetch b2b_org display docs by uid tag; returns `uid → doc`. Uids are already filter-safe + bounded by the member-org cap. */
  private async fetchOrgDocsByUids(req: Request, uids: string[]): Promise<Map<string, B2bOrgIndexedDoc>> {
    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'b2b_org',
      tags: uids.map((uid) => `b2b_org_uid:${uid}`),
      per_page: Math.min(uids.length + 10, ORG_ROLE_GRANTS_HARD_CAP),
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

  /** Strip the `<type>:` prefix query-service prepends on `resource.id` (SFIDs contain no `:`). */
  private extractUid(resourceId: string | undefined | null): string {
    if (!resourceId) return '';
    const colonIdx = resourceId.indexOf(':');
    return colonIdx === -1 ? resourceId : resourceId.substring(colonIdx + 1);
  }
}
