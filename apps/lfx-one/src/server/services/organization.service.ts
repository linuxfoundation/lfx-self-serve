// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CertifiedEmployeesResponse,
  CertifiedEmployeesRow,
  MembershipTierResponse,
  MembershipTierRow,
  OrganizationContributorsResponse,
  OrganizationContributorsRow,
  OrganizationEventAttendanceRow,
  OrganizationEventsOverviewResponse,
  OrganizationMaintainersResponse,
  OrganizationMaintainersRow,
  OrganizationSuggestion,
  OrganizationSuggestionsResponse,
  TrainingEnrollmentDailyRow,
  TrainingEnrollmentsResponse,
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
   * Get certified employees data for an organization
   * @param accountId - Organization account ID
   * @param projectSlug - Project slug
   * @returns Certified employees data
   */
  public async getCertifiedEmployees(accountId: string, projectSlug: string): Promise<CertifiedEmployeesResponse> {
    const query = `
      SELECT CERTIFICATIONS, CERTIFIED_EMPLOYEES, ACCOUNT_ID, PROJECT_ID, PROJECT_SLUG
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_CERTIFIED_EMPLOYEES
      WHERE PROJECT_SLUG = ? AND ACCOUNT_ID = ?
    `;

    const result = await this.snowflakeService.execute<CertifiedEmployeesRow>(query, [projectSlug, accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Certified employees data', accountId, {
        operation: 'get_certified_employees',
      });
    }

    const row = result.rows[0];

    return {
      certifications: row.CERTIFICATIONS || 0,
      certifiedEmployees: row.CERTIFIED_EMPLOYEES || 0,
      accountId: row.ACCOUNT_ID,
      projectId: row.PROJECT_ID,
      projectSlug: row.PROJECT_SLUG,
    };
  }

  /**
   * Get membership tier data for an organization
   * @param accountId - Organization account ID
   * @param projectSlug - Project slug
   * @returns Membership tier data
   */
  public async getMembershipTier(accountId: string, projectSlug: string): Promise<MembershipTierResponse> {
    const query = `
      SELECT PROJECT_ID, PROJECT_NAME, PROJECT_SLUG, IS_PROJECT_ACTIVE, ACCOUNT_ID,
             ACCOUNT_NAME, MEMBERSHIP_TIER, MEMBERSHIP_PRICE, START_DATE, LAST_END_DATE,
             RENEWAL_PRICE, MEMBERSHIP_STATUS
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MEMBERSHIP_TIER
      WHERE PROJECT_SLUG = ? AND ACCOUNT_ID = ?
    `;

    const result = await this.snowflakeService.execute<MembershipTierRow>(query, [projectSlug, accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Membership tier data', accountId, {
        operation: 'get_membership_tier',
      });
    }

    const row = result.rows[0];

    // Extract tier name (remove " Membership" suffix if present)
    const tier = row.MEMBERSHIP_TIER ? row.MEMBERSHIP_TIER.replace(' Membership', '') : '';

    return {
      projectId: row.PROJECT_ID,
      projectName: row.PROJECT_NAME,
      projectSlug: row.PROJECT_SLUG,
      isProjectActive: row.IS_PROJECT_ACTIVE,
      accountId: row.ACCOUNT_ID,
      accountName: row.ACCOUNT_NAME,
      membershipTier: tier,
      membershipPrice: row.MEMBERSHIP_PRICE || 0,
      startDate: row.START_DATE || '',
      endDate: row.LAST_END_DATE || '',
      renewalPrice: row.RENEWAL_PRICE || 0,
      membershipStatus: row.MEMBERSHIP_STATUS || '',
    };
  }

  /**
   * Get maintainers data for an organization
   * @param accountId - Organization account ID
   * @returns Maintainers data
   */
  public async getOrganizationMaintainers(accountId: string): Promise<OrganizationMaintainersResponse> {
    const query = `
      SELECT MAINTAINERS, PROJECTS, ACCOUNT_ID, ACCOUNT_NAME
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MAINTAINERS
      WHERE ACCOUNT_ID = ?
    `;

    const result = await this.snowflakeService.execute<OrganizationMaintainersRow>(query, [accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Organization maintainers data', accountId, {
        operation: 'get_organization_maintainers',
      });
    }

    const row = result.rows[0];

    return {
      maintainers: row.MAINTAINERS || 0,
      projects: row.PROJECTS || 0,
      accountId: row.ACCOUNT_ID,
      accountName: row.ACCOUNT_NAME,
    };
  }

  /**
   * Get contributors data for an organization
   * @param accountId - Organization account ID
   * @returns Contributors data
   */
  public async getOrganizationContributors(accountId: string): Promise<OrganizationContributorsResponse> {
    const query = `
      SELECT CONTRIBUTORS, PROJECTS, ACCOUNT_ID, ACCOUNT_NAME
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_CONTRIBUTORS
      WHERE ACCOUNT_ID = ?
    `;

    const result = await this.snowflakeService.execute<OrganizationContributorsRow>(query, [accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Organization contributors data', accountId, {
        operation: 'get_organization_contributors',
      });
    }

    const row = result.rows[0];

    return {
      contributors: row.CONTRIBUTORS || 0,
      projects: row.PROJECTS || 0,
      accountId: row.ACCOUNT_ID,
      accountName: row.ACCOUNT_NAME,
    };
  }

  /**
   * Get training enrollments data for an organization
   * Returns count of enrollments this year with cumulative daily data for chart visualization
   * @param accountId - Organization account ID
   * @param projectSlug - Project slug
   * @returns Training enrollments data with daily cumulative counts
   */
  public async getTrainingEnrollments(accountId: string, projectSlug: string): Promise<TrainingEnrollmentsResponse> {
    const query = `
      WITH daily_enrollments AS (
        SELECT
          DATE(ENROLLMENT_TS) AS ENROLLMENT_DATE,
          COUNT(*) AS DAILY_COUNT
        FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_TRAINING_ENROLLMENTS
        WHERE PROJECT_SLUG = ? AND ACCOUNT_ID = ?
          AND YEAR(ENROLLMENT_TS) = YEAR(CURRENT_DATE())
        GROUP BY DATE(ENROLLMENT_TS)
      )
      SELECT
        ENROLLMENT_DATE,
        DAILY_COUNT,
        SUM(DAILY_COUNT) OVER (ORDER BY ENROLLMENT_DATE ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CUMULATIVE_COUNT
      FROM daily_enrollments
      ORDER BY ENROLLMENT_DATE ASC
    `;

    const result = await this.snowflakeService.execute<TrainingEnrollmentDailyRow>(query, [projectSlug, accountId]);

    // Calculate total from the last cumulative count or sum of daily counts
    const totalEnrollments = result.rows.length > 0 ? result.rows[result.rows.length - 1].CUMULATIVE_COUNT : 0;

    return {
      totalEnrollments,
      dailyData: result.rows.map((row) => ({
        date: row.ENROLLMENT_DATE,
        count: row.DAILY_COUNT,
        cumulativeCount: row.CUMULATIVE_COUNT,
      })),
      accountId,
      projectSlug,
    };
  }
}
