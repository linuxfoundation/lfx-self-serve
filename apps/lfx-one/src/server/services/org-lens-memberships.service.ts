// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgActiveMembership,
  OrgActiveMembershipsResponse,
  OrgDiscoverOpportunitiesResponse,
  OrgDiscoverOpportunity,
  OrgExpiredMembership,
  OrgExpiredMembershipsResponse,
} from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';

interface RawMembershipRow {
  ACCOUNT_ID: string;
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
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

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getActiveMemberships(accountId: string, search?: string, tier?: string, renewal?: string): Promise<OrgActiveMembershipsResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        FOUNDATION_ID,
        FOUNDATION_NAME,
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

  private shapeRow(raw: RawMembershipRow): OrgActiveMembership {
    return {
      foundationId: raw.FOUNDATION_ID,
      foundationName: raw.FOUNDATION_NAME,
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
