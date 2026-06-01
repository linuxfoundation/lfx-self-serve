// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_KEY_CONTACT_REQUIRED_ROLES } from '@lfx-one/shared/constants';
import type {
  KeyContactIndexedDoc,
  OrgKeyContactAssignment,
  OrgKeyContactsResponse,
  OrgKeyContactsStats,
  ProjectMembershipIndexedDoc,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** Org Lens — People → Key Contacts tab. V1 is org-wide and read-only; membership-scoped reads + writes live in OrgLensKeyContactsService (spec 024). */
export class OrgPeopleKeyContactsService {
  // Active membership statuses, case-insensitive — mirrors OrgMembershipResolverService so we don't silently drop 'purchased' or mixed-case 'active' memberships.
  private static readonly activeMembershipStatuses = new Set(['active', 'purchased']);
  // Match OrgMembershipResolverService's page size so org-wide reads aren't artificially fragmented into more round trips than necessary.
  private static readonly queryPageSize = 500;

  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** Bundled GET — joins active key_contact rows to their project_membership and computes the filter-independent stat strip (FR-004). Caller passes b2b_org UUID directly because the upstream b2b_org index has no indexed sfid field. */
  public async getKeyContacts(req: Request, orgUid: string): Promise<OrgKeyContactsResponse> {
    const tags = `b2b_org_uid:${orgUid}`;
    // failOnPartial: true on both fetches — stats are computed off the full active dataset, so a dropped page would silently produce wrong counts and missing-join filters.
    const [contacts, memberships] = await Promise.all([
      fetchAllQueryResources<KeyContactIndexedDoc>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<KeyContactIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'key_contact',
            tags,
            per_page: OrgPeopleKeyContactsService.queryPageSize,
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: true }
      ),
      fetchAllQueryResources<ProjectMembershipIndexedDoc>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<ProjectMembershipIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'project_membership',
            tags,
            per_page: OrgPeopleKeyContactsService.queryPageSize,
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: true }
      ),
    ]);

    // Case-insensitive membership status filter — same Set ('active', 'purchased') as OrgMembershipResolverService so we don't drop valid memberships.
    const membershipByUid = new Map<string, ProjectMembershipIndexedDoc>();
    for (const m of memberships) {
      if (!m.uid) continue;
      if (!OrgPeopleKeyContactsService.activeMembershipStatuses.has((m.status ?? '').toLowerCase())) continue;
      membershipByUid.set(m.uid, m);
    }

    const rawAssignments: OrgKeyContactAssignment[] = [];
    for (const c of contacts) {
      if (!c.uid || !c.membership_uid) continue;
      const membership = membershipByUid.get(c.membership_uid);
      if (!membership) continue;
      if (c.status && c.status.toLowerCase() !== 'active') continue;

      const email = (c.email ?? '').trim();
      const firstName = (c.first_name ?? '').trim();
      const lastName = (c.last_name ?? '').trim();
      const displayName = `${firstName} ${lastName}`.trim();
      if (!email || !displayName) continue;

      const foundationSlug = membership.project_slug ?? '';
      if (!foundationSlug) continue;

      const role = (c.role ?? '').trim();
      if (!role) continue;

      rawAssignments.push({
        contactUid: c.uid,
        membershipUid: c.membership_uid,
        email,
        firstName,
        lastName,
        displayName,
        title: (c.title ?? null) || null,
        role,
        foundationSlug,
        foundationName: this.resolveFoundationName(membership),
        canEdit: false,
      });
    }

    // T010 (PKC-4): if any assignment is missing a foundationName, kick off enrichment.
    // Today this is a stub that returns an empty map — see T041.
    const missingSlugs = new Set(rawAssignments.filter((a) => !a.foundationName).map((a) => a.foundationSlug));
    if (missingSlugs.size > 0) {
      const enriched = await this.enrichFoundationNames(req, [...missingSlugs]);
      for (const a of rawAssignments) {
        if (!a.foundationName && enriched.has(a.foundationSlug)) {
          a.foundationName = enriched.get(a.foundationSlug) ?? null;
        }
      }
    }

    // T027 writer-FGA check is deferred until LFXV2-1677 lands the edit affordances; `canEdit` stays `false`.
    return {
      assignments: rawAssignments,
      stats: this.computeStats(rawAssignments),
    };
  }

  /** Foundation display name lookup — prefers inline `project_name`, otherwise null. */
  private resolveFoundationName(membership: ProjectMembershipIndexedDoc): string | null {
    return membership.project_name ?? null;
  }

  /** T041 stub — Snowflake slug→name fallback if LFXV2-2003 doesn't land; today returns empty (callers tolerate null names). */
  private async enrichFoundationNames(req: Request, slugs: string[]): Promise<Map<string, string>> {
    void req;
    void slugs;
    return new Map<string, string>();
  }

  /** PKC-5 — account-level stat strip computed from the full active dataset (filter-independent). */
  private computeStats(assignments: OrgKeyContactAssignment[]): OrgKeyContactsStats {
    const emails = new Set<string>();
    const slugs = new Set<string>();
    const rolesHeld = new Set<string>();
    for (const a of assignments) {
      emails.add(a.email.toLowerCase());
      slugs.add(a.foundationSlug);
      rolesHeld.add(a.role);
    }
    const unfilled = ORG_KEY_CONTACT_REQUIRED_ROLES.filter((r) => !rolesHeld.has(r)).length;
    return {
      individualCount: emails.size,
      foundationsCovered: slugs.size,
      unfilledRequiredRoleCount: unfilled,
    };
  }
}
