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
import { VALKEY_CACHE } from '@lfx-one/shared/constants';

import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

const formatMonthLabel = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

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

/** Cross-foundation organization involvement analytics against the org_* platinum tables (account-level). */
export class OrgInvolvementService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Empty rows are a legitimate result (the org has zero coverage), not a not-found.
   * Endpoints in this service return a zero-shaped envelope so the client renders
   * an empty state instead of treating the call as an error.
   */
  public async getFoundationCoverage(accountId: string): Promise<OrgFoundationCoverageResponse> {
    return withOrgCache(
      accountId,
      'coverage',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchFoundationCoverage(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getContributorsMonthly(accountId: string): Promise<OrgInvolvementContributorsMonthlyResponse> {
    return withOrgCache(
      accountId,
      'contributors',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchContributorsMonthly(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getMaintainersMonthly(accountId: string): Promise<OrgInvolvementMaintainersMonthlyResponse> {
    return withOrgCache(
      accountId,
      'maintainers',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchMaintainersMonthly(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getEventAttendanceMonthly(accountId: string): Promise<OrgInvolvementEventAttendanceMonthlyResponse> {
    return withOrgCache(
      accountId,
      'events',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchEventAttendanceMonthly(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getCertifiedEmployeesMonthly(accountId: string): Promise<OrgInvolvementCertifiedEmployeesMonthlyResponse> {
    return withOrgCache(
      accountId,
      'certs',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchCertifiedEmployeesMonthly(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getTrainingEnrollments(accountId: string): Promise<OrgTrainingEnrollmentsResponse> {
    return withOrgCache(
      accountId,
      'training',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchTrainingEnrollments(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  // Rejects a corrupt/legacy entry (degrade to a miss); every response in this service carries `accountId`.
  private static hasAccountId(value: unknown): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { accountId?: unknown }).accountId === 'string';
  }

  private async fetchFoundationCoverage(accountId: string): Promise<OrgFoundationCoverageResponse> {
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
      return { accountId, foundationCount: 0, foundations: [] };
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

  private async fetchContributorsMonthly(accountId: string): Promise<OrgInvolvementContributorsMonthlyResponse> {
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
      return { accountId, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] };
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      totalActiveContributors: firstRow.TOTAL_ACTIVE_CONTRIBUTORS || 0,
      monthlyData: result.rows.map((row) => row.UNIQUE_CONTRIBUTORS || 0),
      monthlyLabels: result.rows.map((row) => formatMonthLabel(row.MONTH_START_DATE)),
    };
  }

  private async fetchMaintainersMonthly(accountId: string): Promise<OrgInvolvementMaintainersMonthlyResponse> {
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
      return { accountId, accountName: '', totalMaintainersYearly: 0, totalProjectsYearly: 0, monthlyData: [], monthlyLabels: [] };
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      totalMaintainersYearly: firstRow.TOTAL_MAINTAINERS_YEARLY || 0,
      totalProjectsYearly: firstRow.TOTAL_PROJECTS_YEARLY || 0,
      monthlyData: result.rows.map((row) => row.ACTIVE_MAINTAINERS || 0),
      monthlyLabels: result.rows.map((row) => formatMonthLabel(row.METRIC_MONTH)),
    };
  }

  private async fetchEventAttendanceMonthly(accountId: string): Promise<OrgInvolvementEventAttendanceMonthlyResponse> {
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
      return {
        accountId,
        accountName: '',
        totalAttended: 0,
        totalSpeakers: 0,
        attendeesMonthlyData: [],
        speakersMonthlyData: [],
        monthlyLabels: [],
      };
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      totalAttended: firstRow.TOTAL_ATTENDED || 0,
      totalSpeakers: firstRow.TOTAL_SPEAKERS || 0,
      attendeesMonthlyData: result.rows.map((row) => row.ATTENDED_COUNT || 0),
      speakersMonthlyData: result.rows.map((row) => row.SPEAKER_COUNT || 0),
      monthlyLabels: result.rows.map((row) => formatMonthLabel(row.MONTH_START_DATE)),
    };
  }

  private async fetchCertifiedEmployeesMonthly(accountId: string): Promise<OrgInvolvementCertifiedEmployeesMonthlyResponse> {
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
      return { accountId, totalCertifications: 0, totalCertifiedEmployees: 0, monthlyData: [], monthlyLabels: [] };
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      totalCertifications: firstRow.TOTAL_CERTIFICATIONS || 0,
      totalCertifiedEmployees: firstRow.TOTAL_CERTIFIED_EMPLOYEES || 0,
      monthlyData: result.rows.map((row) => row.MONTHLY_CERTIFICATIONS || 0),
      monthlyLabels: result.rows.map((row) => formatMonthLabel(row.MONTH_START_DATE)),
    };
  }

  private async fetchTrainingEnrollments(accountId: string): Promise<OrgTrainingEnrollmentsResponse> {
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
