// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { CERTIFICATION_PRODUCT_TYPE, MAX_ORG_CERT_EMPLOYEES, MAX_ORG_TRAINING_EMPLOYEES } from '@lfx-one/shared/constants';
import type {
  GetOrgCertificationsOptions,
  GetOrgTrainingsOptions,
  OrgCertEmployee,
  OrgCertEmployeesResponse,
  OrgCertEmployeeStatus,
  OrgCertification,
  OrgCertificationsResponse,
  OrgTraining,
  OrgTrainingEmployeesResponse,
  OrgTrainingEmployeeStatus,
  OrgTrainingsResponse,
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

interface OrgCertificationRow {
  COURSE_ID: string;
  COURSE_NAME: string | null;
  FOUNDATION_NAME: string | null;
  LEVEL: string | null;
  LOGO_URL: string | null;
  CERTIFIED_COUNT: number;
  IN_PROGRESS_COUNT: number;
}

interface OrgTrainingRow {
  COURSE_ID: string;
  COURSE_NAME: string | null;
  FOUNDATION_NAME: string | null;
  LEVEL: string | null;
  IN_PROGRESS_COUNT: number;
  COMPLETED_COUNT: number;
}

interface OrgPagedCountRow {
  TOTAL_RECORDS: number;
}

interface OrgRosterEmployeeRow {
  CONTACT_ID: string;
  NAME: string | null;
  JOB_TITLE: string | null;
  COURSE_NAME: string | null;
}

interface OrgRosterEmployeesResult {
  courseId: string;
  courseName: string;
  total: number;
  data: readonly OrgCertEmployee[];
}

/** TI catalog dimension shared by certification queries (product_type split per standup 2026-06-08). */
const COURSE_CATALOG_DIM_CTE = `
  course_dim AS (
    SELECT
      COURSE_ID,
      ANY_VALUE(LEVEL) AS LEVEL,
      ANY_VALUE(LOGO_URL) AS LOGO_URL,
      ANY_VALUE(PRODUCT_TYPE) AS PRODUCT_TYPE
    FROM (
      SELECT COURSE_ID, LEVEL, LOGO_URL, PRODUCT_TYPE
      FROM ANALYTICS.PLATINUM_LFX_ONE.USER_CERTIFICATES
      WHERE COURSE_ID IS NOT NULL
      UNION ALL
      SELECT COURSE_ID, LEVEL, LOGO_URL, PRODUCT_TYPE
      FROM ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
      WHERE COURSE_ID IS NOT NULL
    )
    GROUP BY COURSE_ID
  )
`;

/** Aggregates training & certification counts for the Org Lens Training page stat strip. */
export class OrgLensTrainingService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  public async getTrainingStats(accountId: string): Promise<OrgTrainingStats> {
    const certSql = `
      WITH ${COURSE_CATALOG_DIM_CTE},
      scoped AS (
        SELECT
          t.PERSON_KEY,
          t.STATUS,
          d.PRODUCT_TYPE
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING t
        INNER JOIN course_dim d
          ON d.COURSE_ID = COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID)
        WHERE t.ACCOUNT_ID = ?
          AND d.PRODUCT_TYPE = '${CERTIFICATION_PRODUCT_TYPE}'
      )
      SELECT
        COUNT(DISTINCT CASE WHEN STATUS = 'Certified' THEN PERSON_KEY END) AS CERTIFIED_EMPLOYEES,
        COUNT_IF(STATUS = 'Certified')                                     AS CERTIFICATIONS_EARNED,
        0                                                                  AS EMPLOYEES_IN_TRAINING,
        0                                                                  AS TRAINING_COURSES_ENROLLED
      FROM scoped
    `;

    const trainingSql = `
      SELECT
        0                                                                                    AS CERTIFIED_EMPLOYEES,
        0                                                                                    AS CERTIFICATIONS_EARNED,
        COUNT(DISTINCT CASE WHEN TRAINING_STATUS = 'InProgress' THEN PERSON_KEY END)         AS EMPLOYEES_IN_TRAINING,
        COUNT(CASE WHEN TRAINING_STATUS = 'InProgress' THEN 1 END)                           AS TRAINING_COURSES_ENROLLED
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING_COURSES
      WHERE ACCOUNT_ID = ?
    `;

    const [certResult, trainingResult] = await Promise.all([
      this.snowflakeService.execute<OrgTrainingStatsRow>(certSql, [accountId]),
      this.snowflakeService.execute<OrgTrainingStatsRow>(trainingSql, [accountId]),
    ]);

    const cert = certResult.rows[0];
    const training = trainingResult.rows[0];

    return {
      certifiedEmployees: cert?.CERTIFIED_EMPLOYEES ?? 0,
      certificationsEarned: cert?.CERTIFICATIONS_EARNED ?? 0,
      employeesInTraining: training?.EMPLOYEES_IN_TRAINING ?? 0,
      trainingCoursesEnrolled: training?.TRAINING_COURSES_ENROLLED ?? 0,
    };
  }

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

    const filteredCte = `
      WITH base AS (
        SELECT
          COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID)        AS COURSE_ID,
          MAX(t.COURSE_NAME)                                AS COURSE_NAME,
          MAX(t.FOUNDATION_NAME)                            AS FOUNDATION_NAME,
          COUNT(DISTINCT CASE WHEN t.STATUS = 'Certified' THEN t.PERSON_KEY END)                  AS CERTIFIED_COUNT,
          COUNT(DISTINCT CASE WHEN t.STATUS IS DISTINCT FROM 'Certified' THEN t.PERSON_KEY END)   AS IN_PROGRESS_COUNT
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING t
        INNER JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL p
          ON p.ACCOUNT_ID = t.ACCOUNT_ID AND p.PERSON_KEY = t.PERSON_KEY
        WHERE t.ACCOUNT_ID = ?
          AND COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID) IS NOT NULL
        GROUP BY COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID)
      ),
      ${COURSE_CATALOG_DIM_CTE},
      filtered AS (
        SELECT
          b.COURSE_ID,
          b.COURSE_NAME,
          b.FOUNDATION_NAME,
          d.LEVEL     AS LEVEL,
          d.LOGO_URL  AS LOGO_URL,
          b.CERTIFIED_COUNT,
          b.IN_PROGRESS_COUNT
        FROM base b
        INNER JOIN course_dim d ON b.COURSE_ID = d.COURSE_ID
        WHERE d.PRODUCT_TYPE = '${CERTIFICATION_PRODUCT_TYPE}'
          ${searchFilter}
          ${levelFilter}
      )
    `;

    return this.fetchPagedCourseRows<OrgCertificationRow, OrgCertification>(req, 'get_org_certifications', filteredCte, {
      accountId,
      searchQuery,
      level,
      pageSize,
      offset,
      sortField,
      sortOrder,
      selectColumns: 'COURSE_ID, COURSE_NAME, FOUNDATION_NAME, LEVEL, LOGO_URL, CERTIFIED_COUNT, IN_PROGRESS_COUNT',
      mapRow: (row) => this.mapRowToOrgCertification(row),
    });
  }

  public async getOrgTrainings(req: Request, accountId: string, options: GetOrgTrainingsOptions): Promise<OrgTrainingsResponse> {
    const { searchQuery, level, pageSize, offset, sortField, sortOrder } = options;

    logger.debug(req, 'get_org_trainings', 'Building org trainings query', {
      account_id: accountId,
      has_search: !!searchQuery,
      level,
      sort_field: sortField,
      sort_order: sortOrder,
      page_size: pageSize,
      offset,
    });

    const searchFilter = searchQuery ? 'AND (b.COURSE_NAME ILIKE ? OR b.FOUNDATION_NAME ILIKE ?)' : '';
    const levelFilter = level ? 'AND UPPER(b.LEVEL) = ?' : '';

    const filteredCte = `
      WITH base AS (
        SELECT
          t.COURSE_ID,
          MAX(t.COURSE_NAME)      AS COURSE_NAME,
          MAX(t.FOUNDATION_NAME)  AS FOUNDATION_NAME,
          MAX(t.LEVEL)            AS LEVEL,
          COUNT(DISTINCT CASE WHEN t.TRAINING_STATUS = 'InProgress' THEN t.PERSON_KEY END) AS IN_PROGRESS_COUNT,
          COUNT(DISTINCT CASE WHEN t.TRAINING_STATUS = 'Completed' THEN t.PERSON_KEY END)  AS COMPLETED_COUNT
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING_COURSES t
        WHERE t.ACCOUNT_ID = ?
          AND t.COURSE_ID IS NOT NULL
        GROUP BY t.COURSE_ID
      ),
      filtered AS (
        SELECT
          b.COURSE_ID,
          b.COURSE_NAME,
          b.FOUNDATION_NAME,
          b.LEVEL,
          b.IN_PROGRESS_COUNT,
          b.COMPLETED_COUNT
        FROM base b
        WHERE 1=1
          ${searchFilter}
          ${levelFilter}
      )
    `;

    return this.fetchPagedCourseRows<OrgTrainingRow, OrgTraining>(req, 'get_org_trainings', filteredCte, {
      accountId,
      searchQuery,
      level,
      pageSize,
      offset,
      sortField,
      sortOrder,
      selectColumns: 'COURSE_ID, COURSE_NAME, FOUNDATION_NAME, LEVEL, IN_PROGRESS_COUNT, COMPLETED_COUNT',
      mapRow: (row) => this.mapRowToOrgTraining(row),
    });
  }

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
      WITH ${COURSE_CATALOG_DIM_CTE}
      SELECT
        p.PERSON_KEY        AS CONTACT_ID,
        p.NAME              AS NAME,
        p.TITLE             AS JOB_TITLE,
        MAX(t.COURSE_NAME)  AS COURSE_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING t
      INNER JOIN course_dim d
        ON d.COURSE_ID = COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID)
      JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL p
        ON p.ACCOUNT_ID = t.ACCOUNT_ID AND p.PERSON_KEY = t.PERSON_KEY
      WHERE t.ACCOUNT_ID = ?
        AND COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID) = ?
        AND d.PRODUCT_TYPE = '${CERTIFICATION_PRODUCT_TYPE}'
        AND ${statusCondition}
        ${searchFilter}
      GROUP BY p.PERSON_KEY, p.NAME, p.TITLE
      ORDER BY p.NAME ASC NULLS LAST
      LIMIT ${MAX_ORG_CERT_EMPLOYEES}
    `;

    const roster = await this.fetchRosterEmployees(req, 'get_certification_employees', sql, [accountId, courseId], searchQuery, {
      courseId,
    });

    return {
      courseId: roster.courseId,
      certificationName: roster.courseName,
      status,
      total: roster.total,
      data: roster.data,
    };
  }

  public async getTrainingEmployees(
    req: Request,
    accountId: string,
    courseId: string,
    status: OrgTrainingEmployeeStatus,
    searchQuery?: string
  ): Promise<OrgTrainingEmployeesResponse> {
    logger.debug(req, 'get_training_employees', 'Fetching training employees', {
      account_id: accountId,
      course_id: courseId,
      status,
    });

    const trainingStatus = status === 'completed' ? 'Completed' : 'InProgress';
    const searchFilter = searchQuery ? 'AND UPPER(p.NAME) LIKE UPPER(?)' : '';

    const sql = `
      SELECT
        p.PERSON_KEY        AS CONTACT_ID,
        p.NAME              AS NAME,
        p.TITLE             AS JOB_TITLE,
        MAX(t.COURSE_NAME)  AS COURSE_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING_COURSES t
      JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL p
        ON p.ACCOUNT_ID = t.ACCOUNT_ID AND p.PERSON_KEY = t.PERSON_KEY
      WHERE t.ACCOUNT_ID = ?
        AND t.COURSE_ID = ?
        AND t.TRAINING_STATUS = ?
        ${searchFilter}
      GROUP BY p.PERSON_KEY, p.NAME, p.TITLE
      ORDER BY p.NAME ASC NULLS LAST
      LIMIT ${MAX_ORG_TRAINING_EMPLOYEES}
    `;

    const roster = await this.fetchRosterEmployees(req, 'get_training_employees', sql, [accountId, courseId, trainingStatus], searchQuery, {
      courseId,
    });

    return {
      courseId: roster.courseId,
      trainingName: roster.courseName,
      status,
      total: roster.total,
      data: roster.data,
    };
  }

  private async fetchPagedCourseRows<TRow extends { COURSE_ID: string }, TItem>(
    req: Request,
    operation: string,
    filteredCte: string,
    options: {
      accountId: string;
      searchQuery?: string;
      level: string | null;
      pageSize: number;
      offset: number;
      sortField: string;
      sortOrder: 'ASC' | 'DESC';
      selectColumns: string;
      mapRow: (row: TRow) => TItem;
    }
  ): Promise<{ data: TItem[]; total: number; pageSize: number; offset: number }> {
    const { accountId, searchQuery, level, pageSize, offset, sortField, sortOrder, selectColumns, mapRow } = options;

    const countSql = `${filteredCte} SELECT COUNT(*) AS TOTAL_RECORDS FROM filtered`;
    const pageSql = `
      ${filteredCte}
      SELECT ${selectColumns}
      FROM filtered
      ORDER BY ${sortField} ${sortOrder}, COURSE_NAME ASC
      LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}
    `;

    const binds: string[] = [accountId];
    if (searchQuery) binds.push(`%${searchQuery}%`, `%${searchQuery}%`);
    if (level) binds.push(level.toUpperCase());

    const [countResult, pageResult] = await Promise.all([
      this.snowflakeService.execute<OrgPagedCountRow>(countSql, binds),
      this.snowflakeService.execute<TRow>(pageSql, binds),
    ]);

    const total = countResult.rows[0]?.TOTAL_RECORDS ?? 0;
    const data = pageResult.rows.map((row) => mapRow(row));

    logger.debug(req, operation, 'Fetched paged course rows', { count: data.length, total });

    return { data, total, pageSize, offset };
  }

  private async fetchRosterEmployees(
    req: Request,
    operation: string,
    sql: string,
    binds: string[],
    searchQuery: string | undefined,
    meta: { courseId: string }
  ): Promise<OrgRosterEmployeesResult> {
    const queryBinds = [...binds];
    if (searchQuery) queryBinds.push(`%${searchQuery}%`);

    const result = await this.snowflakeService.execute<OrgRosterEmployeeRow>(sql, queryBinds);
    const courseName = result.rows[0]?.COURSE_NAME ?? '';
    const data: OrgCertEmployee[] = result.rows.map((row) => ({
      contactId: row.CONTACT_ID,
      name: row.NAME ?? row.CONTACT_ID,
      jobTitle: row.JOB_TITLE ?? null,
    }));

    logger.debug(req, operation, 'Fetched roster employees', { count: data.length, course_id: meta.courseId });

    return {
      courseId: meta.courseId,
      courseName,
      total: data.length,
      data,
    };
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

  private mapRowToOrgTraining(row: OrgTrainingRow): OrgTraining {
    return {
      courseId: row.COURSE_ID,
      name: row.COURSE_NAME ?? row.COURSE_ID,
      foundation: row.FOUNDATION_NAME ?? null,
      level: row.LEVEL ?? null,
      imageUrl: null,
      inProgressCount: row.IN_PROGRESS_COUNT || 0,
      completedCount: row.COMPLETED_COUNT || 0,
    };
  }
}
