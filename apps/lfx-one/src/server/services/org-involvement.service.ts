// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  OrgInvolvementCertifiedEmployeesMonthlyResponse,
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgFoundationCoverageResponse,
  OrgInvolvementMaintainersMonthlyResponse,
  OrgMaintainerRolesCountRow,
  OrgMaintainerRolesMonthlyRow,
  OrgTrainingEnrollmentsResponse,
} from '@lfx-one/shared';
import {
  DEFAULT_ORG_COMMIT_FILTERS,
  DEFAULT_ORG_TEAM_MEMBERS,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_OVERVIEW_MAINTAINER_ROLES_RANGE,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';

import { orgContributorsActivityPredicate } from '../helpers/org-contributors-sql.helper';
import { orgMaintainerRoleOverlap, readMaintainerRoles } from '../helpers/org-maintainer-roles-sql.helper';
import { orgProjectScopePredicate } from '../helpers/org-project-scope-sql.helper';
import { orgTeamMembersPredicate } from '../helpers/org-team-members.helper';
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
  MONTH_START_DATE: Date;
  UNIQUE_CONTRIBUTORS: number;
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
    // `contributors:v3`: the headline leaves out CDP team members, as the People -> Contributors default does
    // (lfx-self-serve#4685), so a `v2` entry (everyone) must not be read.
    return withOrgCache(
      accountId,
      'contributors:v3',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchContributorsMonthly(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getMaintainersMonthly(accountId: string): Promise<OrgInvolvementMaintainersMonthlyResponse> {
    // `maintainer-roles:v1`: maintainer roles replaced the people count (lfx-self-serve#4482), so a `maintainers` entry must not be read.
    // Set by the fetcher, read by `storable`: a card read while a roles table is missing is served, never stored.
    let rolesMissing = false;
    return withOrgCache(
      accountId,
      'maintainer-roles:v1',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const fetched = await this.fetchMaintainersMonthly(accountId);
        rolesMissing = fetched.rolesMissing;
        return fetched.response;
      },
      OrgInvolvementService.hasAccountId,
      () => !rolesMissing
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

  /**
   * Overview Active Contributors card. The headline is the People -> Contributors default tile, counted live with the
   * same rule — distinct people with code in LF projects, the past 365 days to today, CDP team members left out
   * (lfx-self-serve#4685) — so the two agree; the frozen
   * 12-month total of ORG_CONTRIBUTORS_MONTHLY (calendar months, built once a day) drifted from it. The trend stays the
   * monthly table's distinct contributors per month. Either read failing fails the card, as before.
   */
  private async fetchContributorsMonthly(accountId: string): Promise<OrgInvolvementContributorsMonthlyResponse> {
    const headlineQuery = `
      SELECT COUNT(DISTINCT person_key) AS ACTIVE_CONTRIBUTORS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
      WHERE account_id = ?
        ${orgContributorsActivityPredicate(ORG_LENS_DEFAULT_TIME_RANGE)}
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope)}
        ${orgTeamMembersPredicate(DEFAULT_ORG_TEAM_MEMBERS)}
    `;
    const trendQuery = `
      SELECT
        MONTH_START_DATE,
        UNIQUE_CONTRIBUTORS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_CONTRIBUTORS_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const [headline, trend] = await Promise.all([
      this.snowflakeService.execute<{ ACTIVE_CONTRIBUTORS: number | null }>(headlineQuery, [accountId]),
      this.snowflakeService.execute<ContributorsMonthlyRow>(trendQuery, [accountId]),
    ]);

    return {
      accountId,
      totalActiveContributors: headline.rows[0]?.ACTIVE_CONTRIBUTORS ?? 0,
      monthlyData: trend.rows.map((row) => row.UNIQUE_CONTRIBUTORS || 0),
      monthlyLabels: trend.rows.map((row) => formatMonthLabel(row.MONTH_START_DATE)),
    };
  }

  /**
   * Overview Maintainers card. The headline counts LF roles overlapping the past 365 days to today with the same rule
   * as People -> Contributors, so the two default views agree (the monthly table stops at the last complete month).
   * The trend is the roles held in each month.
   */
  private async fetchMaintainersMonthly(accountId: string): Promise<{ response: OrgInvolvementMaintainersMonthlyResponse; rolesMissing: boolean }> {
    const overlap = orgMaintainerRoleOverlap(ORG_OVERVIEW_MAINTAINER_ROLES_RANGE);
    const headlineQuery = `
      SELECT COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES
      WHERE ACCOUNT_ID = ?
        AND ${overlap.sql}
        ${orgProjectScopePredicate('lf', 'IS_LF_PROJECT')}
    `;
    const trendQuery = `
      SELECT
        METRIC_MONTH,
        ACTIVE_ROLES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY METRIC_MONTH ASC
    `;

    // Each part degrades on its own: a missing roles table answers an unavailable (null) headline, a missing monthly
    // table an empty trend — never an error.
    const [headline, trend] = await Promise.all([
      readMaintainerRoles<OrgMaintainerRolesCountRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLES', headlineQuery, [accountId, ...overlap.binds]),
      readMaintainerRoles<OrgMaintainerRolesMonthlyRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLES_MONTHLY', trendQuery, [accountId]),
    ]);

    return {
      response: {
        accountId,
        maintainerRoles: headline === null ? null : (headline[0]?.MAINTAINER_ROLES ?? 0),
        monthlyData: (trend ?? []).map((row) => row.ACTIVE_ROLES ?? 0),
        monthlyLabels: (trend ?? []).map((row) => formatMonthLabel(row.METRIC_MONTH)),
      },
      rolesMissing: headline === null || trend === null,
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
