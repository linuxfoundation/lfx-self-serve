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
import { DEFAULT_ORG_COMMIT_FILTERS, ORG_LENS_DEFAULT_TIME_RANGE, ORG_OVERVIEW_MAINTAINER_ROLES_RANGE, VALKEY_CACHE } from '@lfx-one/shared/constants';

import { orgContributorsActivityPredicate } from '../helpers/org-contributors-sql.helper';
import { orgMaintainerRoleOverlap, readMaintainerRoles } from '../helpers/org-maintainer-roles-sql.helper';
import { orgProjectScopePredicate } from '../helpers/org-project-scope-sql.helper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

const formatMonthLabel = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/**
 * The 12 calendar months of the Overview trends, oldest first: the 11 before this one and this one to date
 * (lfx-self-serve#4694). The trends LEFT JOIN onto it, so every month is a bar, 0 when nothing counts.
 */
const OVERVIEW_TREND_MONTHS_SQL = `
  SELECT DATEADD(month, -(ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1), DATE_TRUNC('month', CURRENT_DATE())) AS MONTH_START_DATE
  FROM TABLE(GENERATOR(ROWCOUNT => 12))
`;

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
    // `contributors:v3`: the headline counts all projects over the last 2 years, the Org Lens default view, and the trend
    // every project (lfx-self-serve#4694). (`v2`: the headline became the live People -> Contributors default count.)
    return withOrgCache(
      accountId,
      'contributors:v3',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchContributorsMonthly(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getMaintainersMonthly(accountId: string): Promise<OrgInvolvementMaintainersMonthlyResponse> {
    // `maintainer-roles:v2`: the headline counts all projects over the last 2 years, the Org Lens default view
    // (lfx-self-serve#4694). (`v1`: maintainer roles replaced the people count, lfx-self-serve#4482.)
    // Set by the fetcher, read by `storable`: a card read while a roles table is missing is served, never stored.
    let rolesMissing = false;
    return withOrgCache(
      accountId,
      'maintainer-roles:v2',
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
   * same rule — distinct people with code at the Org Lens default view (all projects, the last 2 years to today) — so
   * the two agree. The trend counts the same people from the same table per calendar month, over the 12 months ending
   * with this one (to date), in the same projects. Either read failing fails the card, as before.
   */
  private async fetchContributorsMonthly(accountId: string): Promise<OrgInvolvementContributorsMonthlyResponse> {
    const headlineQuery = `
      SELECT COUNT(DISTINCT person_key) AS ACTIVE_CONTRIBUTORS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
      WHERE account_id = ?
        ${orgContributorsActivityPredicate(ORG_LENS_DEFAULT_TIME_RANGE)}
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope)}
    `;
    const trendQuery = `
      WITH months AS (${OVERVIEW_TREND_MONTHS_SQL})
      SELECT m.MONTH_START_DATE, COUNT(DISTINCT d.person_key) AS UNIQUE_CONTRIBUTORS
      FROM months m
      LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY d
        ON d.account_id = ?
        AND d.activity_date >= m.MONTH_START_DATE
        AND d.activity_date < DATEADD(month, 1, m.MONTH_START_DATE)
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope, 'd.is_lf_project')}
      GROUP BY m.MONTH_START_DATE
      ORDER BY m.MONTH_START_DATE ASC
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
   * Overview Maintainers card. The headline counts roles overlapping the Org Lens default view (all projects, the last
   * 2 years to today) with the same rule as People -> Contributors, so the two default views agree. The trend is the
   * roles in the same projects held in each calendar month, over the 12 months ending with this one (to date).
   */
  private async fetchMaintainersMonthly(accountId: string): Promise<{ response: OrgInvolvementMaintainersMonthlyResponse; rolesMissing: boolean }> {
    const overlap = orgMaintainerRoleOverlap(ORG_OVERVIEW_MAINTAINER_ROLES_RANGE);
    const headlineQuery = `
      SELECT COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES
      WHERE ACCOUNT_ID = ?
        AND ${overlap.sql}
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope, 'IS_LF_PROJECT')}
    `;
    const trendQuery = `
      WITH months AS (${OVERVIEW_TREND_MONTHS_SQL})
      SELECT m.MONTH_START_DATE AS METRIC_MONTH, COUNT(DISTINCT r.MEMBER_ID, r.SEGMENT_ID) AS ACTIVE_ROLES
      FROM months m
      LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES r
        ON r.ACCOUNT_ID = ?
        AND r.ROLE_START_DATE <= LEAST(LAST_DAY(m.MONTH_START_DATE), CURRENT_DATE())
        AND (r.ROLE_END_DATE IS NULL OR r.ROLE_END_DATE >= m.MONTH_START_DATE)
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope, 'r.IS_LF_PROJECT')}
      GROUP BY m.MONTH_START_DATE
      ORDER BY m.MONTH_START_DATE ASC
    `;

    // Each part degrades on its own: a missing roles table answers an unavailable (null) headline and an empty trend —
    // never an error.
    const [headline, trend] = await Promise.all([
      readMaintainerRoles<OrgMaintainerRolesCountRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLES', headlineQuery, [accountId, ...overlap.binds]),
      readMaintainerRoles<OrgMaintainerRolesMonthlyRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLES', trendQuery, [accountId]),
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
