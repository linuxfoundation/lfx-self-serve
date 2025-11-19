// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BoardMemberDashboardConsolidatedRow,
  BoardMemberDashboardResponse,
  OrganizationContributionsConsolidatedRow,
  OrganizationContributionsOverviewResponse,
  OrganizationEventAttendanceRow,
  OrganizationEventsOverviewResponse,
  OrganizationSuggestion,
  OrganizationSuggestionsResponse,
} from '@lfx-one/shared';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Service for handling organization-related operations and analytics
 */
export class OrganizationService {
  private microserviceProxy: MicroserviceProxyService;
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.snowflakeService = new SnowflakeService();
  }

  /**
   * Search for organizations using the microservice proxy
   * @param req - Express request object (needed for authentication)
   * @param query - The search query
   * @returns Promise of organization suggestions
   */
  public async searchOrganizations(req: Request, query: string): Promise<OrganizationSuggestion[]> {
    const params = {
      v: 1,
      query,
    };

    const response = await this.microserviceProxy.proxyRequest<OrganizationSuggestionsResponse>(req, 'LFX_V2_SERVICE', '/query/orgs/suggest', 'GET', params);

    return response.suggestions || [];
  }

  /**
   * Get organization contributions overview (maintainers + contributors + technical committee)
   * @param accountId - Organization account ID
   * @returns Complete contributions overview
   */
  public async getContributionsOverview(accountId: string): Promise<OrganizationContributionsOverviewResponse> {
    const data = await this.getContributionsData(accountId);

    return {
      maintainers: {
        maintainers: data.MAINTAINERS || 0,
        projects: data.MAINTAINER_PROJECTS || 0,
      },
      contributors: {
        contributors: data.CONTRIBUTORS || 0,
        projects: data.CONTRIBUTOR_PROJECTS || 0,
      },
      technicalCommittee: {
        totalRepresentatives: data.TOTAL_REPRESENTATIVES || 0,
        totalProjects: data.TOTAL_TC_PROJECTS || 0,
      },
      accountId: data.ACCOUNT_ID,
      accountName: data.ACCOUNT_NAME,
    };
  }

  /**
   * Get board member dashboard (membership tier + certified employees)
   * @param accountId - Organization account ID
   * @param projectSlug - Project slug
   * @returns Complete board member dashboard
   */
  public async getBoardMemberDashboardData(accountId: string, projectSlug: string): Promise<BoardMemberDashboardResponse> {
    const data = await this.getDashboardData(accountId, projectSlug);

    // Extract tier name (remove " Membership" suffix if present)
    const tier = data.MEMBERSHIP_TIER ? data.MEMBERSHIP_TIER.replace(' Membership', '') : '';

    return {
      membershipTier: {
        tier,
        membershipStartDate: data.START_DATE || '',
        membershipEndDate: data.LAST_END_DATE || '',
        membershipStatus: data.MEMBERSHIP_STATUS || '',
      },
      certifiedEmployees: {
        certifications: data.CERTIFICATIONS || 0,
        certifiedEmployees: data.CERTIFIED_EMPLOYEES || 0,
      },
      accountId: data.ACCOUNT_ID,
      uid: data.PROJECT_ID,
    };
  }

  /**
   * Get organization events overview (event attendance + event sponsorships)
   * @param accountId - Organization account ID
   * @returns Events overview
   */
  public async getEventsOverview(accountId: string): Promise<OrganizationEventsOverviewResponse> {
    const attendanceQuery = `
      SELECT
        SUM(ATTENDEES) AS TOTAL_ATTENDEES,
        SUM(SPEAKERS) AS TOTAL_SPEAKERS,
        COUNT(*) AS TOTAL_EVENTS,
        MAX(ACCOUNT_ID) AS ACCOUNT_ID,
        MAX(ACCOUNT_NAME) AS ACCOUNT_NAME
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_EVENT_ATTENDANCE
      WHERE ACCOUNT_ID = ?
      GROUP BY ACCOUNT_ID
    `;

    const attendanceResult = await this.snowflakeService.execute<OrganizationEventAttendanceRow>(attendanceQuery, [accountId]);

    if (attendanceResult.rows.length === 0) {
      throw new ResourceNotFoundError('Organization event attendance data', accountId, {
        operation: 'get_organization_events_overview',
      });
    }

    const attendanceRow = attendanceResult.rows[0];

    return {
      eventAttendance: {
        totalAttendees: attendanceRow.TOTAL_ATTENDEES,
        totalSpeakers: attendanceRow.TOTAL_SPEAKERS,
        totalEvents: attendanceRow.TOTAL_EVENTS,
        accountName: attendanceRow.ACCOUNT_NAME,
      },
      accountId: attendanceRow.ACCOUNT_ID,
    };
  }

  /**
   * Get organization contributions data from database
   * @param accountId - Organization account ID
   * @returns Contributions data row
   */
  private async getContributionsData(accountId: string): Promise<OrganizationContributionsConsolidatedRow> {
    const query = `
      WITH base AS (SELECT ? AS ACCOUNT_ID)
      SELECT
        m.MAINTAINERS,
        m.PROJECTS AS MAINTAINER_PROJECTS,
        c.CONTRIBUTORS,
        c.PROJECTS AS CONTRIBUTOR_PROJECTS,
        tc.TOTAL_REPRESENTATIVES,
        tc.TOTAL_PROJECTS AS TOTAL_TC_PROJECTS,
        COALESCE(m.ACCOUNT_ID, c.ACCOUNT_ID, tc.ACCOUNT_ID, base.ACCOUNT_ID) AS ACCOUNT_ID,
        COALESCE(m.ACCOUNT_NAME, c.ACCOUNT_NAME) AS ACCOUNT_NAME
      FROM base
      LEFT JOIN ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MAINTAINERS m
        ON base.ACCOUNT_ID = m.ACCOUNT_ID
      LEFT JOIN ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_CONTRIBUTORS c
        ON base.ACCOUNT_ID = c.ACCOUNT_ID
      LEFT JOIN (
        SELECT
          SUM(COUNT) AS TOTAL_REPRESENTATIVES,
          COUNT(DISTINCT PROJECT_ID) AS TOTAL_PROJECTS,
          ACCOUNT_ID
        FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.TECHNICAL_COMMITTEE_MEMBER_COUNT
        WHERE ACCOUNT_ID = ?
        GROUP BY ACCOUNT_ID
      ) tc
        ON base.ACCOUNT_ID = tc.ACCOUNT_ID
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<OrganizationContributionsConsolidatedRow>(query, [accountId, accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Organization contributions data', accountId, {
        operation: 'get_contributions_data',
      });
    }

    return result.rows[0];
  }

  /**
   * Get board member dashboard data from database
   * @param accountId - Organization account ID
   * @param projectSlug - Project slug
   * @returns Dashboard data row
   */
  private async getDashboardData(accountId: string, projectSlug: string): Promise<BoardMemberDashboardConsolidatedRow> {
    const query = `
      WITH base AS (SELECT ? AS ACCOUNT_ID, ? AS PROJECT_SLUG)
      SELECT
        mt.MEMBERSHIP_TIER,
        mt.START_DATE,
        mt.LAST_END_DATE,
        mt.MEMBERSHIP_STATUS,
        ce.CERTIFICATIONS,
        ce.CERTIFIED_EMPLOYEES,
        COALESCE(mt.ACCOUNT_ID, ce.ACCOUNT_ID, base.ACCOUNT_ID) AS ACCOUNT_ID,
        COALESCE(mt.PROJECT_ID, ce.PROJECT_ID) AS PROJECT_ID
      FROM base
      LEFT JOIN ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MEMBERSHIP_TIER mt
        ON base.ACCOUNT_ID = mt.ACCOUNT_ID AND base.PROJECT_SLUG = mt.PROJECT_SLUG
      LEFT JOIN ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_CERTIFIED_EMPLOYEES ce
        ON base.ACCOUNT_ID = ce.ACCOUNT_ID AND base.PROJECT_SLUG = ce.PROJECT_SLUG
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<BoardMemberDashboardConsolidatedRow>(query, [accountId, projectSlug]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Board member dashboard data', accountId, {
        operation: 'get_dashboard_data',
      });
    }

    return result.rows[0];
  }
}
