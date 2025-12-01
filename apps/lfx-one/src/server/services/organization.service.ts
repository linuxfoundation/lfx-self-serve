// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CertifiedEmployeesMonthlyRow,
  CertifiedEmployeesResponse,
  FoundationCompanyBusFactorResponse,
  FoundationCompanyBusFactorRow,
  MembershipTierResponse,
  MembershipTierRow,
  OrganizationContributorsMonthlyRow,
  OrganizationContributorsResponse,
  OrganizationEventAttendanceMonthlyResponse,
  OrganizationEventAttendanceMonthlyRow,
  OrganizationMaintainersMonthlyRow,
  OrganizationMaintainersResponse,
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
    this.snowflakeService = SnowflakeService.getInstance();
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
   * Get certified employees data for an organization with monthly trend data
   * Queries the monthly certified employees table for board member dashboard charts
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Certified employees data with monthly trend for chart visualization (12 months)
   */
  public async getCertifiedEmployees(accountId: string, foundationSlug: string): Promise<CertifiedEmployeesResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        MONTH_START_DATE,
        MONTHLY_CERTIFICATIONS,
        MONTHLY_CERTIFIED_EMPLOYEES,
        TOTAL_CERTIFICATIONS,
        TOTAL_CERTIFIED_EMPLOYEES,
        SUM(MONTHLY_CERTIFICATIONS) OVER (
          ORDER BY MONTH_START_DATE ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS CUMULATIVE_CERTIFICATIONS
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_CERTIFIED_EMPLOYEES_ORG_MONTHLY
      WHERE ACCOUNT_ID = ? AND FOUNDATION_SLUG = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<CertifiedEmployeesMonthlyRow>(query, [accountId, foundationSlug]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Certified employees data', accountId, {
        operation: 'get_certified_employees',
      });
    }

    // Get yearly totals from the first row (same across all rows)
    const firstRow = result.rows[0];

    // Build cumulative monthly trend data and labels from SQL window function
    const monthlyData = result.rows.map((row) => row.CUMULATIVE_CERTIFICATIONS || 0);
    const monthlyLabels = result.rows.map((row) => row.MONTH_START_DATE.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));

    return {
      certifications: firstRow.TOTAL_CERTIFICATIONS || 0,
      certifiedEmployees: firstRow.TOTAL_CERTIFIED_EMPLOYEES || 0,
      accountId: firstRow.ACCOUNT_ID,
      monthlyData,
      monthlyLabels,
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
   * Get maintainers data for an organization with monthly trend data
   * Queries the monthly maintainers table for board member dashboard charts
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Maintainers data with monthly trend for chart visualization (12 months)
   */
  public async getOrganizationMaintainers(accountId: string, foundationSlug: string): Promise<OrganizationMaintainersResponse> {
    const query = `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        ACCOUNT_ID,
        ACCOUNT_NAME,
        METRIC_MONTH,
        ACTIVE_MAINTAINERS,
        ACTIVE_PROJECTS,
        TOTAL_MAINTAINERS_YEARLY,
        TOTAL_PROJECTS_YEARLY,
        AVG_MAINTAINERS_YEARLY
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_MAINTAINERS_ORG_MONTHLY
      WHERE ACCOUNT_ID = ? AND FOUNDATION_SLUG = ?
      ORDER BY METRIC_MONTH ASC
    `;

    const result = await this.snowflakeService.execute<OrganizationMaintainersMonthlyRow>(query, [accountId, foundationSlug]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Organization maintainers data', accountId, {
        operation: 'get_organization_maintainers',
      });
    }

    // Get yearly totals from the first row (same across all rows)
    const firstRow = result.rows[0];

    // Build monthly trend data and labels
    const monthlyData = result.rows.map((row) => row.ACTIVE_MAINTAINERS || 0);
    const monthlyLabels = result.rows.map((row) => row.METRIC_MONTH.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));

    return {
      maintainers: firstRow.TOTAL_MAINTAINERS_YEARLY || 0,
      projects: firstRow.TOTAL_PROJECTS_YEARLY || 0,
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      monthlyData,
      monthlyLabels,
    };
  }

  /**
   * Get contributors data for an organization with monthly trend data
   * Queries the monthly contributors table for board member dashboard charts
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Contributors data with monthly trend for chart visualization (12 months)
   */
  public async getOrganizationContributors(accountId: string, foundationSlug: string): Promise<OrganizationContributorsResponse> {
    const query = `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        ORGANIZATION_ID,
        ACCOUNT_ID,
        ACCOUNT_NAME,
        MONTH_START_DATE,
        UNIQUE_CONTRIBUTORS,
        TOTAL_ACTIVE_CONTRIBUTORS
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_UNIQUE_CONTRIBUTORS_ORG_MONTHLY
      WHERE ACCOUNT_ID = ? AND FOUNDATION_SLUG = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<OrganizationContributorsMonthlyRow>(query, [accountId, foundationSlug]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Organization contributors data', accountId, {
        operation: 'get_organization_contributors',
      });
    }

    // Get yearly totals from the first row (same across all rows)
    const firstRow = result.rows[0];

    // Build monthly trend data and labels
    const monthlyData = result.rows.map((row) => row.UNIQUE_CONTRIBUTORS || 0);
    const monthlyLabels = result.rows.map((row) => row.MONTH_START_DATE.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));

    return {
      contributors: firstRow.TOTAL_ACTIVE_CONTRIBUTORS || 0,
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      monthlyData,
      monthlyLabels,
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

  /**
   * Get event attendance monthly data for an organization
   * Queries the monthly event attendance table for board member dashboard charts
   * Returns cumulative attendees and speakers data for chart visualization
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Event attendance data with monthly cumulative counts for attendees and speakers
   */
  public async getEventAttendanceMonthly(accountId: string, foundationSlug: string): Promise<OrganizationEventAttendanceMonthlyResponse> {
    const query = `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        ACCOUNT_ID,
        ACCOUNT_NAME,
        MONTH_START_DATE,
        REGISTRATION_COUNT,
        ATTENDED_COUNT,
        SPEAKER_COUNT,
        TOTAL_REGISTRATIONS,
        TOTAL_ATTENDED,
        TOTAL_SPEAKERS,
        SUM(ATTENDED_COUNT) OVER (
          ORDER BY MONTH_START_DATE ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS CUMULATIVE_ATTENDED,
        SUM(SPEAKER_COUNT) OVER (
          ORDER BY MONTH_START_DATE ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS CUMULATIVE_SPEAKERS
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_EVENT_ATTENDANCE_ORG_MONTHLY
      WHERE ACCOUNT_ID = ? AND FOUNDATION_SLUG = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<OrganizationEventAttendanceMonthlyRow>(query, [accountId, foundationSlug]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Organization event attendance data', accountId, {
        operation: 'get_event_attendance_monthly',
      });
    }

    // Get yearly totals from the first row (same across all rows)
    const firstRow = result.rows[0];

    // Build cumulative monthly trend data and labels from SQL window function
    const attendeesMonthlyData = result.rows.map((row) => row.CUMULATIVE_ATTENDED || 0);
    const speakersMonthlyData = result.rows.map((row) => row.CUMULATIVE_SPEAKERS || 0);
    const monthlyLabels = result.rows.map((row) => row.MONTH_START_DATE.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));

    return {
      totalAttended: firstRow.TOTAL_ATTENDED || 0,
      totalSpeakers: firstRow.TOTAL_SPEAKERS || 0,
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      attendeesMonthlyData,
      speakersMonthlyData,
      monthlyLabels,
    };
  }

  /**
   * Get company bus factor data for a foundation
   * Shows concentration risk from top contributing companies
   * @param foundationSlug - Foundation slug to filter by
   * @returns Company bus factor data with top companies percentage breakdown
   */
  public async getCompanyBusFactor(foundationSlug: string): Promise<FoundationCompanyBusFactorResponse> {
    const query = `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        BUS_FACTOR_COMPANY_COUNT,
        ROUND(BUS_FACTOR_CONTRIBUTION_PCT, 2) AS BUS_FACTOR_CONTRIBUTION_PCT,
        TOTAL_COMPANIES,
        TOTAL_CONTRIBUTIONS,
        BUS_FACTOR_CONTRIBUTIONS,
        (TOTAL_COMPANIES - BUS_FACTOR_COMPANY_COUNT) AS OTHER_COMPANIES_COUNT,
        ROUND(100 - BUS_FACTOR_CONTRIBUTION_PCT, 2) AS OTHER_COMPANIES_PCT
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_COMPANY_BUS_FACTOR
      WHERE FOUNDATION_SLUG = ?
    `;

    const result = await this.snowflakeService.execute<FoundationCompanyBusFactorRow>(query, [foundationSlug]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Company bus factor data', foundationSlug, {
        operation: 'get_company_bus_factor',
      });
    }

    const row = result.rows[0];

    return {
      topCompaniesCount: row.BUS_FACTOR_COMPANY_COUNT,
      topCompaniesPercentage: row.BUS_FACTOR_CONTRIBUTION_PCT,
      otherCompaniesCount: row.OTHER_COMPANIES_COUNT,
      otherCompaniesPercentage: row.OTHER_COMPANIES_PCT,
    };
  }
}
