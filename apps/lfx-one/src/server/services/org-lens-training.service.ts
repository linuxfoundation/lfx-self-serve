// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type {
  GetOrgCertificationsOptions,
  OrgCertEmployee,
  OrgCertEmployeeRow,
  OrgCertEmployeesResponse,
  OrgCertEmployeeStatus,
  OrgCertification,
  OrgCertificationRow,
  OrgCertificationsResponse,
  OrgTrainingStats,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

interface OrgTrainingStatsRow {
  CERTIFIED_EMPLOYEES: number;
  CERTIFICATIONS_EARNED: number;
  EMPLOYEES_IN_TRAINING: number;
  TRAINING_COURSES_ENROLLED: number;
}

/** Aggregates training & certification counts from ORG_PEOPLE_TRAINING for an org account. */
export class OrgLensTrainingService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  public async getTrainingStats(accountId: string): Promise<OrgTrainingStats> {
    // Two metric families, each split into a distinct-people count and a record count:
    //   CERTIFIED_EMPLOYEES       — distinct people who completed ≥1 certification
    //   CERTIFICATIONS_EARNED     — total certification records (ignores who earned them)
    //   EMPLOYEES_IN_TRAINING     — distinct people enrolled in ≥1 training (non-certified)
    //   TRAINING_COURSES_ENROLLED — total training enrollment records (ignores who enrolled)
    //
    // STATUS is nullable. Only the exact string 'Certified' counts as certified; every other
    // value — including NULL — is treated as training. `IS DISTINCT FROM` is used (rather than
    // `!=`) so NULL rows fall into the training branch instead of being silently dropped, which
    // matches the people-side convention (org-lens-people.service.ts: STATUS === 'Certified').
    const query = `
      SELECT
        COUNT(DISTINCT CASE WHEN STATUS = 'Certified' THEN PERSON_KEY END)              AS CERTIFIED_EMPLOYEES,
        COUNT_IF(STATUS = 'Certified')                                                  AS CERTIFICATIONS_EARNED,
        COUNT(DISTINCT CASE WHEN STATUS IS DISTINCT FROM 'Certified' THEN PERSON_KEY END) AS EMPLOYEES_IN_TRAINING,
        COUNT_IF(STATUS IS DISTINCT FROM 'Certified')                                   AS TRAINING_COURSES_ENROLLED
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
    `;

    const result = await this.snowflakeService.execute<OrgTrainingStatsRow>(query, [accountId]);
    const row = result.rows[0];

    return {
      certifiedEmployees: row?.CERTIFIED_EMPLOYEES ?? 0,
      certificationsEarned: row?.CERTIFICATIONS_EARNED ?? 0,
      employeesInTraining: row?.EMPLOYEES_IN_TRAINING ?? 0,
      trainingCoursesEnrolled: row?.TRAINING_COURSES_ENROLLED ?? 0,
    };
  }

  /**
   * GET /api/orgs/:orgUid/lens/training/certifications — paginated list of distinct
   * certifications the org's people have engaged with, each with certified / in-progress counts.
   *
   * ORG_PEOPLE_TRAINING is one row per person-course; grouping by the course id collapses it to
   * one row per certification. STATUS is nullable — only the exact string 'Certified' counts as
   * certified; every other value (including NULL) falls into in-progress via `IS DISTINCT FROM`,
   * matching getTrainingStats above. LEVEL / LOGO_URL don't exist on the org table, so they're
   * sourced from a per-course dimension built from USER_CERTIFICATES + USER_COURSE_ENROLLMENTS.
   */
  public async getOrgCertifications(req: Request, accountId: string, options: GetOrgCertificationsOptions): Promise<OrgCertificationsResponse> {
    const { searchQuery, level, pageSize, offset, sortField, sortOrder } = options;

    logger.debug(req, 'get_org_certifications', 'Building org certifications query', {
      account_id: accountId,
      has_search: !!searchQuery,
      level,
      sort_field: sortField,
      sort_order: sortOrder,
      page_size: pageSize,
      offset,
    });

    const searchFilter = searchQuery ? 'AND (b.COURSE_NAME ILIKE ? OR b.FOUNDATION_NAME ILIKE ?)' : '';
    const levelFilter = level ? 'AND UPPER(d.LEVEL) = ?' : '';

    // sortField and sortOrder are validated against allow-lists in the controller before reaching
    // here, so they are safe to interpolate; user-supplied values are always passed as binds.
    const sql = `
      WITH base AS (
        SELECT
          COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID)        AS COURSE_ID,
          MAX(t.COURSE_NAME)                                AS COURSE_NAME,
          MAX(t.FOUNDATION_NAME)                            AS FOUNDATION_NAME,
          COUNT_IF(t.STATUS = 'Certified')                  AS CERTIFIED_COUNT,
          COUNT_IF(t.STATUS IS DISTINCT FROM 'Certified')   AS IN_PROGRESS_COUNT
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING t
        WHERE t.ACCOUNT_ID = ?
          AND COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID) IS NOT NULL
        GROUP BY COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID)
      ),
      course_dim AS (
        SELECT COURSE_ID, ANY_VALUE(LEVEL) AS LEVEL, ANY_VALUE(LOGO_URL) AS LOGO_URL
        FROM (
          SELECT COURSE_ID, LEVEL, LOGO_URL
          FROM ANALYTICS.PLATINUM_LFX_ONE.USER_CERTIFICATES
          WHERE COURSE_ID IS NOT NULL
          UNION ALL
          SELECT COURSE_ID, LEVEL, LOGO_URL
          FROM ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
          WHERE COURSE_ID IS NOT NULL
        )
        GROUP BY COURSE_ID
      )
      SELECT
        b.COURSE_ID,
        b.COURSE_NAME,
        b.FOUNDATION_NAME,
        d.LEVEL                AS LEVEL,
        d.LOGO_URL             AS LOGO_URL,
        b.CERTIFIED_COUNT,
        b.IN_PROGRESS_COUNT,
        COUNT(*) OVER()        AS TOTAL_RECORDS
      FROM base b
      LEFT JOIN course_dim d ON b.COURSE_ID = d.COURSE_ID
      WHERE 1=1
        ${searchFilter}
        ${levelFilter}
      ORDER BY ${sortField} ${sortOrder}, b.COURSE_NAME ASC
      LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}
    `;

    const binds: string[] = [accountId];
    if (searchQuery) binds.push(`%${searchQuery}%`, `%${searchQuery}%`);
    if (level) binds.push(level.toUpperCase());

    let result;
    try {
      result = await this.snowflakeService.execute<OrgCertificationRow>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_org_certifications', 'Snowflake query failed, returning empty certifications', {
        error: error instanceof Error ? error.message : String(error),
        account_id: accountId,
      });
      return { data: [], total: 0, pageSize, offset };
    }

    const total = result.rows.length > 0 ? result.rows[0].TOTAL_RECORDS : 0;
    const data = result.rows.map((row) => this.mapRowToOrgCertification(row));

    logger.debug(req, 'get_org_certifications', 'Fetched org certifications', { count: data.length, total });

    return { data, total, pageSize, offset };
  }

  /**
   * GET /api/orgs/:orgUid/lens/training/certifications/:courseId/employees — roster of org employees
   * for a single certification, scoped to the certified or in-progress branch. Joins ORG_PEOPLE_TRAINING
   * to ORG_PEOPLE_ALL on (ACCOUNT_ID, PERSON_KEY) for display name + job title.
   */
  public async getCertificationEmployees(
    req: Request,
    accountId: string,
    courseId: string,
    status: OrgCertEmployeeStatus,
    searchQuery?: string
  ): Promise<OrgCertEmployeesResponse> {
    logger.debug(req, 'get_certification_employees', 'Fetching certification employees', {
      account_id: accountId,
      course_id: courseId,
      status,
    });

    const statusCondition = status === 'certified' ? "t.STATUS = 'Certified'" : "t.STATUS IS DISTINCT FROM 'Certified'";
    const searchFilter = searchQuery ? 'AND UPPER(p.NAME) LIKE UPPER(?)' : '';

    const sql = `
      SELECT
        p.PERSON_KEY        AS CONTACT_ID,
        p.NAME              AS NAME,
        p.TITLE             AS JOB_TITLE,
        MAX(t.COURSE_NAME)  AS CERTIFICATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING t
      JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL p
        ON p.ACCOUNT_ID = t.ACCOUNT_ID AND p.PERSON_KEY = t.PERSON_KEY
      WHERE t.ACCOUNT_ID = ?
        AND COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID) = ?
        AND ${statusCondition}
        ${searchFilter}
      GROUP BY p.PERSON_KEY, p.NAME, p.TITLE
      ORDER BY p.NAME ASC NULLS LAST
    `;

    const binds: string[] = [accountId, courseId];
    if (searchQuery) binds.push(`%${searchQuery}%`);

    let result;
    try {
      result = await this.snowflakeService.execute<OrgCertEmployeeRow>(sql, binds);
    } catch (error) {
      logger.warning(req, 'get_certification_employees', 'Snowflake query failed, returning empty roster', {
        error: error instanceof Error ? error.message : String(error),
        account_id: accountId,
        course_id: courseId,
      });
      return { courseId, certificationName: '', status, total: 0, data: [] };
    }

    const certificationName = result.rows[0]?.CERTIFICATION_NAME ?? '';
    const data: OrgCertEmployee[] = result.rows.map((row) => ({
      contactId: row.CONTACT_ID,
      name: row.NAME ?? row.CONTACT_ID,
      jobTitle: row.JOB_TITLE ?? null,
    }));

    logger.debug(req, 'get_certification_employees', 'Fetched certification employees', { count: data.length, course_id: courseId });

    return { courseId, certificationName, status, total: data.length, data };
  }

  private mapRowToOrgCertification(row: OrgCertificationRow): OrgCertification {
    return {
      courseId: row.COURSE_ID,
      name: row.COURSE_NAME ?? row.COURSE_ID,
      foundation: row.FOUNDATION_NAME ?? null,
      level: row.LEVEL ?? null,
      imageUrl: row.LOGO_URL ?? null,
      certifiedCount: row.CERTIFIED_COUNT || 0,
      inProgressCount: row.IN_PROGRESS_COUNT || 0,
    };
  }
}
