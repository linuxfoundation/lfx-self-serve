// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BoardMemberDashboardConsolidatedRow,
  BoardMemberDashboardResponse,
  OrganizationContributionsConsolidatedRow,
  OrganizationContributionsOverviewResponse,
  OrganizationEventAttendanceRow,
  OrganizationEventsOverviewResponse,
  OrganizationEventSponsorshipsAggregateRow,
  OrganizationSegmentOverviewResponse,
  OrganizationSuggestion,
  OrganizationSuggestionsResponse,
  SegmentContributionsConsolidatedRow,
} from '@lfx-one/shared';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Service for handling organization-related operations and analytics
 *
 * Generated with [Claude Code](https://claude.ai/code)
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
   * Get board member dashboard (membership tier + certified employees + board meeting attendance)
   * @param accountId - Organization account ID
   * @param projectId - Project ID
   * @returns Complete board member dashboard
   */
  public async getBoardMemberDashboardData(accountId: string, projectId: string): Promise<BoardMemberDashboardResponse> {
    const data = await this.getDashboardData(accountId, projectId);

    // Extract tier name (remove " Membership" suffix if present)
    const tier = data.MEMBERSHIP_TIER ? data.MEMBERSHIP_TIER.replace(' Membership', '') : '';

    return {
      membershipTier: {
        tier,
        membershipStartDate: data.CURRENT_MEMBERSHIP_START_DATE || '',
        membershipEndDate: data.CURRENT_MEMBERSHIP_END_DATE || '',
        membershipStatus: data.MEMBERSHIP_STATUS || '',
      },
      certifiedEmployees: {
        certifications: data.CERTIFICATIONS || 0,
        certifiedEmployees: data.CERTIFIED_EMPLOYEES || 0,
      },
      boardMeetingAttendance: {
        totalMeetings: data.TOTAL_MEETINGS || 0,
        attendedMeetings: data.ATTENDED_MEETINGS || 0,
        notAttendedMeetings: data.NOT_ATTENDED_MEETINGS || 0,
        attendancePercentage: data.ATTENDANCE_PERCENTAGE || 0,
      },
      accountId: data.ACCOUNT_ID,
      projectId: data.PROJECT_ID,
    };
  }

  /**
   * Get organization segment overview (projects participating + total commits)
   * @param accountId - Organization account ID
   * @param segmentId - Segment ID
   * @returns Segment overview
   */
  public async getSegmentOverview(accountId: string, segmentId: string): Promise<OrganizationSegmentOverviewResponse> {
    const data = await this.getSegmentData(accountId, segmentId);

    return {
      projectsParticipating: data.PROJECTS_PARTICIPATING || 0,
      totalCommits: data.TOTAL_COMMITS || 0,
      accountId: data.ACCOUNT_ID,
      segmentId: data.SEGMENT_ID,
    };
  }

  /**
   * Get organization events overview (event attendance + event sponsorships)
   * @param accountId - Organization account ID
   * @param projectId - Project ID
   * @returns Events overview
   */
  public async getEventsOverview(accountId: string, projectId: string): Promise<OrganizationEventsOverviewResponse> {
    const attendanceQuery = `
      SELECT
        SUM(ATTENDEES) AS TOTAL_ATTENDEES,
        SUM(SPEAKERS) AS TOTAL_SPEAKERS,
        COUNT(*) AS TOTAL_EVENTS,
        MAX(ACCOUNT_ID) AS ACCOUNT_ID,
        MAX(ACCOUNT_NAME) AS ACCOUNT_NAME
      FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_EVENT_ATTENDANCE
      WHERE ACCOUNT_ID = ?
      GROUP BY ACCOUNT_ID
    `;

    const sponsorshipsQuery = `
      SELECT
        SUM(PRICE) AS TOTAL_AMOUNT,
        CURRENCY_CODE,
        MAX(ACCOUNT_ID) AS ACCOUNT_ID,
        (SELECT COUNT(DISTINCT EVENT_ID)
         FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_EVENT_SPONSORSHIPS
         WHERE ACCOUNT_ID = ? AND PROJECT_ID = ?) AS TOTAL_EVENTS
      FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_EVENT_SPONSORSHIPS
      WHERE ACCOUNT_ID = ?
        AND PROJECT_ID = ?
      GROUP BY CURRENCY_CODE
      ORDER BY CURRENCY_CODE
    `;

    const [attendanceResult, sponsorshipsResult] = await Promise.all([
      this.snowflakeService.execute<OrganizationEventAttendanceRow>(attendanceQuery, [accountId]),
      this.snowflakeService.execute<OrganizationEventSponsorshipsAggregateRow>(sponsorshipsQuery, [accountId, projectId, accountId, projectId]),
    ]);

    if (attendanceResult.rows.length === 0) {
      throw new ResourceNotFoundError('Organization event attendance data', accountId, {
        operation: 'get_organization_events_overview',
      });
    }

    if (sponsorshipsResult.rows.length === 0) {
      throw new ResourceNotFoundError('Organization event sponsorships data', accountId, {
        operation: 'get_organization_events_overview',
      });
    }

    const attendanceRow = attendanceResult.rows[0];
    const currencySummaries = sponsorshipsResult.rows.map((row) => ({
      amount: row.TOTAL_AMOUNT,
      currencyCode: row.CURRENCY_CODE,
    }));

    return {
      eventAttendance: {
        totalAttendees: attendanceRow.TOTAL_ATTENDEES,
        totalSpeakers: attendanceRow.TOTAL_SPEAKERS,
        totalEvents: attendanceRow.TOTAL_EVENTS,
        accountName: attendanceRow.ACCOUNT_NAME,
      },
      eventSponsorships: {
        currencySummaries,
        totalEvents: sponsorshipsResult.rows[0].TOTAL_EVENTS,
      },
      accountId: attendanceRow.ACCOUNT_ID,
      projectId,
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
      LEFT JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MAINTAINERS m
        ON base.ACCOUNT_ID = m.ACCOUNT_ID
      LEFT JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_CONTRIBUTORS c
        ON base.ACCOUNT_ID = c.ACCOUNT_ID
      LEFT JOIN (
        SELECT
          SUM(COUNT) AS TOTAL_REPRESENTATIVES,
          COUNT(DISTINCT PROJECT_ID) AS TOTAL_PROJECTS,
          ACCOUNT_ID
        FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.TECHNICAL_COMMITTEE_MEMBER_COUNT
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
   * Get segment contributions data from database
   * @param accountId - Organization account ID
   * @param segmentId - Segment ID
   * @returns Segment contributions data row
   */
  private async getSegmentData(accountId: string, segmentId: string): Promise<SegmentContributionsConsolidatedRow> {
    const query = `
      WITH base AS (SELECT ? AS ACCOUNT_ID, ? AS SEGMENT_ID)
      SELECT
        pp.PROJECTS_PARTICIPATING,
        tc.TOTAL_COMMITS,
        COALESCE(pp.ACCOUNT_ID, tc.ACCOUNT_ID, base.ACCOUNT_ID) AS ACCOUNT_ID,
        COALESCE(pp.SEGMENT_ID, tc.SEGMENT_ID, base.SEGMENT_ID) AS SEGMENT_ID
      FROM base
      LEFT JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_PROJECTS_PARTICIPATING pp
        ON base.ACCOUNT_ID = pp.ACCOUNT_ID AND base.SEGMENT_ID = pp.SEGMENT_ID
      LEFT JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_TOTAL_COMMITS tc
        ON base.ACCOUNT_ID = tc.ACCOUNT_ID AND base.SEGMENT_ID = tc.SEGMENT_ID
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<SegmentContributionsConsolidatedRow>(query, [accountId, segmentId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Segment contributions data', accountId, {
        operation: 'get_segment_data',
      });
    }

    return result.rows[0];
  }

  /**
   * Get board member dashboard data from database
   * @param accountId - Organization account ID
   * @param projectId - Project ID
   * @returns Dashboard data row
   */
  private async getDashboardData(accountId: string, projectId: string): Promise<BoardMemberDashboardConsolidatedRow> {
    const query = `
      WITH base AS (SELECT ? AS ACCOUNT_ID, ? AS PROJECT_ID)
      SELECT
        mt.MEMBERSHIP_TIER,
        mt.CURRENT_MEMBERSHIP_START_DATE,
        mt.CURRENT_MEMBERSHIP_END_DATE,
        mt.MEMBERSHIP_STATUS,
        ce.CERTIFICATIONS,
        ce.CERTIFIED_EMPLOYEES,
        bma.TOTAL_MEETINGS,
        bma.ATTENDED_MEETINGS,
        bma.NOT_ATTENDED_MEETINGS,
        CASE
          WHEN bma.TOTAL_MEETINGS > 0 THEN (bma.ATTENDED_MEETINGS::FLOAT / bma.TOTAL_MEETINGS::FLOAT) * 100
          ELSE 0
        END AS ATTENDANCE_PERCENTAGE,
        COALESCE(mt.ACCOUNT_ID, ce.ACCOUNT_ID, bma.ACCOUNT_ID, base.ACCOUNT_ID) AS ACCOUNT_ID,
        COALESCE(mt.PROJECT_ID, ce.PROJECT_ID, bma.PROJECT_ID, base.PROJECT_ID) AS PROJECT_ID
      FROM base
      LEFT JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MEMBERSHIP_TIER mt
        ON base.ACCOUNT_ID = mt.ACCOUNT_ID AND base.PROJECT_ID = mt.PROJECT_ID
      LEFT JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_CERTIFIED_EMPLOYEES ce
        ON base.ACCOUNT_ID = ce.ACCOUNT_ID AND base.PROJECT_ID = ce.PROJECT_ID
      LEFT JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_BOARD_MEETING_ATTENDANCE bma
        ON base.ACCOUNT_ID = bma.ACCOUNT_ID AND base.PROJECT_ID = bma.PROJECT_ID
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<BoardMemberDashboardConsolidatedRow>(query, [accountId, projectId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Board member dashboard data', accountId, {
        operation: 'get_dashboard_data',
      });
    }

    return result.rows[0];
  }
}
