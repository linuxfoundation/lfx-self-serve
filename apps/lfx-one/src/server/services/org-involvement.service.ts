// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  OrgInvolvementCertifiedEmployeesMonthlyResponse,
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgFoundationCoverageResponse,
  OrgInvolvementMaintainersMonthlyResponse,
  OrgTrainingEnrollmentsResponse,
} from '@lfx-one/shared';

import { ResourceNotFoundError } from '../errors';
import { SnowflakeService } from './snowflake.service';

interface FoundationCoverageRow {
  ACCOUNT_ID: string;
  FOUNDATION_ID: string;
  FOUNDATION_SLUG: string;
  FOUNDATION_NAME: string;
  FOUNDATION_COUNT: number;
}

interface ContributorsMonthlyRow {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  MONTH_START_DATE: Date;
  UNIQUE_CONTRIBUTORS: number;
  TOTAL_ACTIVE_CONTRIBUTORS: number;
}

interface MaintainersMonthlyRow {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  METRIC_MONTH: Date;
  ACTIVE_MAINTAINERS: number;
  ACTIVE_PROJECTS: number;
  TOTAL_MAINTAINERS_YEARLY: number;
  TOTAL_PROJECTS_YEARLY: number;
}

interface EventAttendanceMonthlyRow {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  MONTH_START_DATE: Date;
  REGISTRATION_COUNT: number;
  ATTENDED_COUNT: number;
  SPEAKER_COUNT: number;
  TOTAL_REGISTRATIONS: number;
  TOTAL_ATTENDED: number;
  TOTAL_SPEAKERS: number;
}

interface CertifiedEmployeesMonthlyRow {
  ACCOUNT_ID: string;
  MONTH_START_DATE: Date;
  MONTHLY_CERTIFICATIONS: number;
  MONTHLY_CERTIFIED_EMPLOYEES: number;
  TOTAL_CERTIFICATIONS: number;
  TOTAL_CERTIFIED_EMPLOYEES: number;
}

interface TrainingEnrollmentRow {
  ACCOUNT_ID: string;
  ENROLLMENT_DATE: string;
  DAILY_COUNT: number;
  CUMULATIVE_COUNT: number;
  TOTAL_ENROLLMENTS: number;
}

/**
 * Service for cross-foundation organization involvement analytics.
 * Queries the org_* platinum tables (account-level, no foundation filter).
 */
export class OrgInvolvementService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  public async getFoundationCoverage(accountId: string): Promise<OrgFoundationCoverageResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        FOUNDATION_ID,
        FOUNDATION_SLUG,
        FOUNDATION_NAME,
        FOUNDATION_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_FOUNDATION_COVERAGE
      WHERE ACCOUNT_ID = ?
      ORDER BY FOUNDATION_NAME ASC
    `;

    const result = await this.snowflakeService.execute<FoundationCoverageRow>(query, [accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Foundation coverage data', accountId, {
        operation: 'get_foundation_coverage',
      });
    }

    return {
      accountId: result.rows[0].ACCOUNT_ID,
      foundationCount: result.rows[0].FOUNDATION_COUNT || 0,
      foundations: result.rows.map((row) => ({
        foundationId: row.FOUNDATION_ID,
        foundationSlug: row.FOUNDATION_SLUG,
        foundationName: row.FOUNDATION_NAME,
      })),
    };
  }

  public async getContributorsMonthly(accountId: string): Promise<OrgInvolvementContributorsMonthlyResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        MONTH_START_DATE,
        UNIQUE_CONTRIBUTORS,
        TOTAL_ACTIVE_CONTRIBUTORS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_CONTRIBUTORS_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<ContributorsMonthlyRow>(query, [accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Contributors monthly data', accountId, {
        operation: 'get_contributors_monthly',
      });
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      totalActiveContributors: firstRow.TOTAL_ACTIVE_CONTRIBUTORS || 0,
      monthlyData: result.rows.map((row) => row.UNIQUE_CONTRIBUTORS || 0),
      monthlyLabels: result.rows.map((row) => row.MONTH_START_DATE.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })),
    };
  }

  public async getMaintainersMonthly(accountId: string): Promise<OrgInvolvementMaintainersMonthlyResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        METRIC_MONTH,
        ACTIVE_MAINTAINERS,
        ACTIVE_PROJECTS,
        TOTAL_MAINTAINERS_YEARLY,
        TOTAL_PROJECTS_YEARLY
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINERS_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY METRIC_MONTH ASC
    `;

    const result = await this.snowflakeService.execute<MaintainersMonthlyRow>(query, [accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Maintainers monthly data', accountId, {
        operation: 'get_maintainers_monthly',
      });
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      totalMaintainersYearly: firstRow.TOTAL_MAINTAINERS_YEARLY || 0,
      totalProjectsYearly: firstRow.TOTAL_PROJECTS_YEARLY || 0,
      monthlyData: result.rows.map((row) => row.ACTIVE_MAINTAINERS || 0),
      monthlyLabels: result.rows.map((row) => row.METRIC_MONTH.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })),
    };
  }

  public async getEventAttendanceMonthly(accountId: string): Promise<OrgInvolvementEventAttendanceMonthlyResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        MONTH_START_DATE,
        REGISTRATION_COUNT,
        ATTENDED_COUNT,
        SPEAKER_COUNT,
        TOTAL_REGISTRATIONS,
        TOTAL_ATTENDED,
        TOTAL_SPEAKERS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_ATTENDANCE_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<EventAttendanceMonthlyRow>(query, [accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Event attendance monthly data', accountId, {
        operation: 'get_event_attendance_monthly',
      });
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      totalAttended: firstRow.TOTAL_ATTENDED || 0,
      totalSpeakers: firstRow.TOTAL_SPEAKERS || 0,
      attendeesMonthlyData: result.rows.map((row) => row.ATTENDED_COUNT || 0),
      speakersMonthlyData: result.rows.map((row) => row.SPEAKER_COUNT || 0),
      monthlyLabels: result.rows.map((row) => row.MONTH_START_DATE.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })),
    };
  }

  public async getCertifiedEmployeesMonthly(accountId: string): Promise<OrgInvolvementCertifiedEmployeesMonthlyResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        MONTH_START_DATE,
        MONTHLY_CERTIFICATIONS,
        MONTHLY_CERTIFIED_EMPLOYEES,
        TOTAL_CERTIFICATIONS,
        TOTAL_CERTIFIED_EMPLOYEES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_CERTIFIED_EMPLOYEES_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<CertifiedEmployeesMonthlyRow>(query, [accountId]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Certified employees monthly data', accountId, {
        operation: 'get_certified_employees_monthly',
      });
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      totalCertifications: firstRow.TOTAL_CERTIFICATIONS || 0,
      totalCertifiedEmployees: firstRow.TOTAL_CERTIFIED_EMPLOYEES || 0,
      monthlyData: result.rows.map((row) => row.MONTHLY_CERTIFICATIONS || 0),
      monthlyLabels: result.rows.map((row) => row.MONTH_START_DATE.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })),
    };
  }

  public async getTrainingEnrollments(accountId: string): Promise<OrgTrainingEnrollmentsResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        ENROLLMENT_DATE,
        DAILY_COUNT,
        CUMULATIVE_COUNT,
        TOTAL_ENROLLMENTS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_TRAINING_ENROLLMENTS
      WHERE ACCOUNT_ID = ?
      ORDER BY ENROLLMENT_DATE ASC
    `;

    const result = await this.snowflakeService.execute<TrainingEnrollmentRow>(query, [accountId]);

    const totalEnrollments = result.rows.length > 0 ? result.rows[result.rows.length - 1].TOTAL_ENROLLMENTS || 0 : 0;

    return {
      accountId,
      totalEnrollments,
      dailyData: result.rows.map((row) => ({
        date: row.ENROLLMENT_DATE,
        count: row.DAILY_COUNT,
        cumulativeCount: row.CUMULATIVE_COUNT,
      })),
    };
  }
}
