// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgActiveMembership,
  OrgActiveMembershipsResponse,
  OrgDiscoverOpportunitiesResponse,
  OrgDiscoverOpportunity,
  OrgExpiredMembership,
  OrgExpiredMembershipsResponse,
  OrgMembershipDetailResponse,
  OrgMembershipFoundationHeader,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { OrgLensKeyContactsService } from './org-lens-key-contacts.service';
import { SnowflakeService } from './snowflake.service';

// Spec 024: key contacts are sourced live from the query-service indexer (real-time), replacing the
// spec-015 mock fixture. Only the foundation header is still derived from the Snowflake summary.

interface RawMembershipRow {
  ACCOUNT_ID: string;
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_LOGO_URL: string | null;
  MEMBERSHIP_TIER_DISPLAY_NAME: string;
  TIER_START_DATE: string | null;
  TIER_END_DATE: string | null;
  FIRST_MEMBERSHIP_STARTED_AT: string | null;
  BOARD_MEMBER_SEAT_COUNT: number;
  COMMITTEE_MEMBER_SEAT_COUNT: number;
  ORG_PROJECTS_COUNT: number;
  PROJECT_COUNT: number;
  MEMBER_COUNT: number;
  IS_RENEWING_WITHIN_90_DAYS: boolean;
}

interface RawExpiredRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
  FOUNDATION_LOGO_URL: string | null;
  MEMBERSHIP_TIER_DISPLAY_NAME: string;
  TIER_START_DATE: string | null;
  TIER_END_DATE: string | null;
  EXPIRATION_DATE: string | null;
  ACTION_TYPE: 'renew' | 'contact';
}

interface RawDiscoverRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
  FOUNDATION_LOGO_URL: string | null;
  PROJECT_TYPE: string | null;
  SUGGESTED_TIER: string | null;
  CONTRIBUTORS_COUNT: number;
  CONTRIBUTION_COUNT: number;
  RELEVANT_PROJECTS: number;
}

export class OrgLensMembershipsService {
  private snowflakeService: SnowflakeService;
  private keyContactsService: OrgLensKeyContactsService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
    this.keyContactsService = new OrgLensKeyContactsService();
  }

  public async getActiveMemberships(accountId: string, search?: string, tier?: string, renewal?: string): Promise<OrgActiveMembershipsResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        FOUNDATION_LOGO_URL,
        MEMBERSHIP_TIER_DISPLAY_NAME,
        TIER_START_DATE,
        TIER_END_DATE,
        FIRST_MEMBERSHIP_STARTED_AT,
        BOARD_MEMBER_SEAT_COUNT,
        COMMITTEE_MEMBER_SEAT_COUNT,
        ORG_PROJECTS_COUNT,
        PROJECT_COUNT,
        MEMBER_COUNT,
        IS_RENEWING_WITHIN_90_DAYS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_MEMBERSHIPS_SUMMARY
      WHERE ACCOUNT_ID = ?
      ORDER BY FOUNDATION_NAME ASC
    `;

    const result = await this.snowflakeService.execute<RawMembershipRow>(query, [accountId]);

    if (result.rows.length === 0) {
      return { accountId, summary: { activeMemberships: 0, renewingWithin90Days: 0, governanceRoles: 0 }, memberships: [] };
    }

    const allMemberships = result.rows.map((raw) => this.shapeRow(raw));

    const summary = {
      activeMemberships: allMemberships.length,
      renewingWithin90Days: result.rows.filter((r) => r.IS_RENEWING_WITHIN_90_DAYS).length,
      governanceRoles: result.rows.reduce((sum, r) => sum + r.BOARD_MEMBER_SEAT_COUNT + r.COMMITTEE_MEMBER_SEAT_COUNT, 0),
    };

    let filtered = allMemberships;

    if (search) {
      const term = search.toLowerCase();
      filtered = filtered.filter((m) => m.foundationName.toLowerCase().includes(term));
    }

    if (tier) {
      filtered = filtered.filter((m) => m.membershipTier === tier);
    }

    if (renewal === '90' || renewal === '30') {
      const now = new Date();
      const days = Number(renewal);
      const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      filtered = filtered.filter((m) => {
        if (!m.tierEndDate) return false;
        return new Date(m.tierEndDate) <= cutoff;
      });
    }

    return { accountId, summary, memberships: filtered };
  }

  public async getExpiredMemberships(accountId: string, search?: string): Promise<OrgExpiredMembershipsResponse> {
    const query = `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_LOGO_URL,
        MEMBERSHIP_TIER_DISPLAY_NAME,
        TIER_START_DATE,
        TIER_END_DATE,
        EXPIRATION_DATE,
        ACTION_TYPE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_EXPIRED_MEMBERSHIPS
      WHERE ACCOUNT_ID = ?
      ORDER BY FOUNDATION_NAME ASC
    `;

    const result = await this.snowflakeService.execute<RawExpiredRow>(query, [accountId]);

    if (result.rows.length === 0) {
      return { accountId, memberships: [] };
    }

    let memberships: OrgExpiredMembership[] = result.rows.map((raw) => ({
      foundationId: raw.FOUNDATION_ID,
      foundationName: raw.FOUNDATION_NAME,
      foundationLogo: raw.FOUNDATION_LOGO_URL,
      membershipTier: raw.MEMBERSHIP_TIER_DISPLAY_NAME,
      tierStartDate: this.formatDate(raw.TIER_START_DATE),
      tierEndDate: this.formatDate(raw.TIER_END_DATE),
      expirationDate: this.formatDate(raw.EXPIRATION_DATE),
      actionType: raw.ACTION_TYPE,
    }));

    if (search) {
      const term = search.toLowerCase();
      memberships = memberships.filter((m) => m.foundationName.toLowerCase().includes(term));
    }

    return { accountId, memberships };
  }

  public async getDiscoverOpportunities(accountId: string): Promise<OrgDiscoverOpportunitiesResponse> {
    const query = `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_LOGO_URL,
        PROJECT_TYPE,
        SUGGESTED_TIER,
        CONTRIBUTORS_COUNT,
        CONTRIBUTION_COUNT,
        RELEVANT_PROJECTS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_DISCOVER_MEMBERSHIPS
      WHERE ACCOUNT_ID = ?
      ORDER BY CONTRIBUTION_COUNT DESC
    `;

    const result = await this.snowflakeService.execute<RawDiscoverRow>(query, [accountId]);

    if (result.rows.length === 0) {
      return { accountId, opportunities: [] };
    }

    const opportunities: OrgDiscoverOpportunity[] = result.rows.map((raw) => ({
      foundationId: raw.FOUNDATION_ID,
      foundationName: raw.FOUNDATION_NAME,
      foundationLogo: raw.FOUNDATION_LOGO_URL,
      category: raw.PROJECT_TYPE ?? '',
      suggestedTier: raw.SUGGESTED_TIER ?? '',
      relevantProjects: raw.RELEVANT_PROJECTS,
      contributors: raw.CONTRIBUTORS_COUNT,
      contributions: raw.CONTRIBUTION_COUNT,
    }));

    return { accountId, opportunities };
  }

  // GET /api/orgs/:orgUid/lens/memberships/:foundationSlug
  // Spec 024 (uuid-only): the foundation header is derived from the Snowflake summary (keyed by the
  // org `sfid`, resolved from the route uuid at the controller boundary) and matched by FOUNDATION_SLUG;
  // keyContacts are sourced live from the query-service indexer via OrgLensKeyContactsService, scoped to
  // the org's active membership for the foundation's slug (keyed by the org `b2bOrgUid`). Unknown slug ⇒
  // not-found (foundation: null, keyContacts: []) per FR-008.
  public async getMembershipDetail(req: Request, b2bOrgUid: string, sfid: string, foundationSlug: string): Promise<OrgMembershipDetailResponse> {
    const slug = (foundationSlug ?? '').trim().toLowerCase();
    // Perf: the Snowflake header and the slug-scoped project_membership fetch are independent, so run
    // them concurrently. `prefetchMembership` warms the resolver's per-(caller,org,slug) memo; the
    // key-contact read below then hits the warm cache. Timed as one parallel block.
    const tParallelStart = Date.now();
    const [activeResponse] = await Promise.all([this.getActiveMemberships(sfid), this.keyContactsService.prefetchMembership(req, b2bOrgUid, foundationSlug)]);
    const headerAndPrefetchMs = Date.now() - tParallelStart;
    const knownFoundation = activeResponse.memberships.find((m) => (m.foundationSlug ?? '').toLowerCase() === slug);

    if (!knownFoundation) {
      // No Snowflake summary row for this org+foundation slug — genuine not-found (FR-008).
      logger.info(req, 'get_org_membership_detail_timing', 'Membership detail timings (not-found)', {
        foundation_slug: slug,
        header_and_prefetch_ms: headerAndPrefetchMs,
        active_membership_count: activeResponse.memberships.length,
        key_contacts_ms: 0,
      });
      return { foundation: null, keyContacts: [] };
    }

    const foundation: OrgMembershipFoundationHeader = {
      foundationId: knownFoundation.foundationId,
      foundationName: knownFoundation.foundationName,
      foundationLogo: knownFoundation.foundationLogo,
      membershipTier: knownFoundation.membershipTier,
      tierStartDate: knownFoundation.tierStartDate || null,
      tierEndDate: knownFoundation.tierEndDate || null,
      memberSince: knownFoundation.memberSince,
      status: 'active',
    };

    const tKeyContactsStart = Date.now();
    const keyContacts = await this.keyContactsService.getKeyContacts(req, b2bOrgUid, knownFoundation.foundationSlug);
    const keyContactsMs = Date.now() - tKeyContactsStart;

    logger.info(req, 'get_org_membership_detail_timing', 'Membership detail timings', {
      foundation_slug: slug,
      header_and_prefetch_ms: headerAndPrefetchMs,
      active_membership_count: activeResponse.memberships.length,
      key_contacts_ms: keyContactsMs,
    });

    return { foundation, keyContacts };
  }

  /**
   * Spec 024: resolve a foundationId to its foundation slug from the Snowflake summary, scoped to the
   * account. Used by the key-contact write controller to bridge the route's foundationId to the slug
   * the indexer resolver needs (D-002). Returns null when the org has no summary row for that foundation.
   */
  public async getFoundationSlug(accountId: string, foundationId: string): Promise<string | null> {
    const active = await this.getActiveMemberships(accountId);
    const row = active.memberships.find((m) => m.foundationId === foundationId);
    return row ? row.foundationSlug : null;
  }

  private shapeRow(raw: RawMembershipRow): OrgActiveMembership {
    return {
      foundationId: raw.FOUNDATION_ID,
      foundationName: raw.FOUNDATION_NAME,
      foundationSlug: raw.FOUNDATION_SLUG ?? '',
      foundationLogo: raw.FOUNDATION_LOGO_URL,
      projectCount: raw.PROJECT_COUNT,
      memberCount: raw.MEMBER_COUNT,
      membershipTier: raw.MEMBERSHIP_TIER_DISPLAY_NAME,
      tierStartDate: this.formatDate(raw.TIER_START_DATE),
      tierEndDate: this.formatDate(raw.TIER_END_DATE),
      memberSince: this.formatDate(raw.FIRST_MEMBERSHIP_STARTED_AT),
      boardMembers: raw.BOARD_MEMBER_SEAT_COUNT,
      committeeMembers: raw.COMMITTEE_MEMBER_SEAT_COUNT,
      orgProjects: raw.ORG_PROJECTS_COUNT,
    };
  }

  private formatDate(dateValue: string | null): string | null {
    if (!dateValue) return null;
    const d = new Date(dateValue);
    return d.toISOString().split('T')[0];
  }
}
