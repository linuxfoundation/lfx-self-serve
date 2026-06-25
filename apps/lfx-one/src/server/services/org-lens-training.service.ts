// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { CERTIFICATION_PRODUCT_TYPE, MAX_ORG_CERT_EMPLOYEES, MAX_ORG_TRAINING_EMPLOYEES, VALKEY_CACHE } from '@lfx-one/shared/constants';
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
import { withOrgCache } from './valkey.service';

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
  TOTAL_MATCHES: number;
}

/** TI catalog dimension scoped to an org's engaged course IDs (avoids full TI catalog scan). */
const scopedCourseCatalogDimCte = (orgCourseIdsSql: string): string => `
  org_course_ids AS (
    ${orgCourseIdsSql}
  ),
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
        AND COURSE_ID IN (SELECT COURSE_ID FROM org_course_ids)
      UNION ALL
      SELECT COURSE_ID, LEVEL, LOGO_URL, PRODUCT_TYPE
      FROM ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
      WHERE COURSE_ID IS NOT NULL
        AND COURSE_ID IN (SELECT COURSE_ID FROM org_course_ids)
    )
    GROUP BY COURSE_ID
  )
`;

/** Aggregates training & certification counts for the Org Lens Training page stat strip. */
export class OrgLensTrainingService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  public async getTrainingStats(accountId: string): Promise<OrgTrainingStats> {
    const raw = await withOrgCache(
      accountId,
      'training-stats',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchTrainingStatsRows(accountId),
      isTrainingStatsRaw
    );

    const cert = raw.certRows[0];
    const training = raw.trainingRows[0];

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
      ${scopedCourseCatalogDimCte('SELECT DISTINCT b.COURSE_ID FROM base b')},
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

    const raw = await withOrgCache(
      accountId,
      `certifications:${paramSignature([searchQuery ?? null, level, pageSize, offset, sortField, sortOrder])}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () =>
        this.fetchPagedCourseRows<OrgCertificationRow>(req, 'get_org_certifications', filteredCte, {
          accountId,
          searchQuery,
          level,
          pageSize,
          offset,
          sortField,
          sortOrder,
          selectColumns: 'COURSE_ID, COURSE_NAME, FOUNDATION_NAME, LEVEL, LOGO_URL, CERTIFIED_COUNT, IN_PROGRESS_COUNT',
        }),
      isPagedCourseRaw
    );

    return { data: raw.rows.map((row) => this.mapRowToOrgCertification(row)), total: raw.total, pageSize, offset };
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

    const raw = await withOrgCache(
      accountId,
      `trainings:${paramSignature([searchQuery ?? null, level, pageSize, offset, sortField, sortOrder])}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () =>
        this.fetchPagedCourseRows<OrgTrainingRow>(req, 'get_org_trainings', filteredCte, {
          accountId,
          searchQuery,
          level,
          pageSize,
          offset,
          sortField,
          sortOrder,
          selectColumns: 'COURSE_ID, COURSE_NAME, FOUNDATION_NAME, LEVEL, IN_PROGRESS_COUNT, COMPLETED_COUNT',
        }),
      isPagedCourseRaw
    );

    return { data: raw.rows.map((row) => this.mapRowToOrgTraining(row)), total: raw.total, pageSize, offset };
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
      WITH ${scopedCourseCatalogDimCte('SELECT ? AS COURSE_ID')}
      SELECT
        p.PERSON_KEY        AS CONTACT_ID,
        p.NAME              AS NAME,
        p.TITLE             AS JOB_TITLE,
        MAX(t.COURSE_NAME)  AS COURSE_NAME,
        COUNT(*) OVER ()    AS TOTAL_MATCHES
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

    const rows = await withOrgCache(
      accountId,
      `certification-employees:${paramSignature([courseId, status, searchQuery ?? null])}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchRosterRows(req, 'get_certification_employees', sql, [courseId, accountId, courseId], searchQuery, { courseId }),
      isRosterRowArray
    );

    return {
      courseId,
      certificationName: rows[0]?.COURSE_NAME ?? '',
      status,
      total: rows[0]?.TOTAL_MATCHES ?? 0,
      data: mapRosterRows(rows),
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
        MAX(t.COURSE_NAME)  AS COURSE_NAME,
        COUNT(*) OVER ()    AS TOTAL_MATCHES
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

    const rows = await withOrgCache(
      accountId,
      `training-employees:${paramSignature([courseId, status, searchQuery ?? null])}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchRosterRows(req, 'get_training_employees', sql, [accountId, courseId, trainingStatus], searchQuery, { courseId }),
      isRosterRowArray
    );

    return {
      courseId,
      trainingName: rows[0]?.COURSE_NAME ?? '',
      status,
      total: rows[0]?.TOTAL_MATCHES ?? 0,
      data: mapRosterRows(rows),
    };
  }

  private async fetchTrainingStatsRows(accountId: string): Promise<{ certRows: OrgTrainingStatsRow[]; trainingRows: OrgTrainingStatsRow[] }> {
    const certSql = `
      WITH ${scopedCourseCatalogDimCte(`
        SELECT DISTINCT COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID) AS COURSE_ID
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING t
        WHERE t.ACCOUNT_ID = ?
          AND COALESCE(t.COURSE_ID, t.COURSE_OR_CERT_ID) IS NOT NULL
      `)},
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
      this.snowflakeService.execute<OrgTrainingStatsRow>(certSql, [accountId, accountId]),
      this.snowflakeService.execute<OrgTrainingStatsRow>(trainingSql, [accountId]),
    ]);

    return { certRows: certResult.rows, trainingRows: trainingResult.rows };
  }

  private async fetchPagedCourseRows<TRow extends { COURSE_ID: string }>(
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
    }
  ): Promise<{ rows: TRow[]; total: number }> {
    const { accountId, searchQuery, level, pageSize, offset, sortField, sortOrder, selectColumns } = options;

    const countSql = `${filteredCte} SELECT COUNT(*) AS TOTAL_RECORDS FROM filtered`;
    // sortField/sortOrder are validated against allow-lists in the controller before reaching
    // here, so they are safe to interpolate; user-supplied values are always passed as binds.
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

    logger.debug(req, operation, 'Fetched paged course rows', { count: pageResult.rows.length, total });

    return { rows: pageResult.rows, total };
  }

  private async fetchRosterRows(
    req: Request,
    operation: string,
    sql: string,
    binds: string[],
    searchQuery: string | undefined,
    meta: { courseId: string }
  ): Promise<OrgRosterEmployeeRow[]> {
    const queryBinds = [...binds];
    if (searchQuery) queryBinds.push(`%${searchQuery}%`);

    const result = await this.snowflakeService.execute<OrgRosterEmployeeRow>(sql, queryBinds);

    logger.debug(req, operation, 'Fetched roster employees', { count: result.rows.length, course_id: meta.courseId });

    return result.rows;
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

/** Deterministic, key-safe sub-resource suffix for the result-changing query params (base64url → only `[A-Za-z0-9_-]`). */
function paramSignature(parts: readonly (string | number | boolean | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function mapRosterRows(rows: readonly OrgRosterEmployeeRow[]): OrgCertEmployee[] {
  return rows.map((row) => ({
    contactId: row.CONTACT_ID,
    name: row.NAME ?? row.CONTACT_ID,
    jobTitle: row.JOB_TITLE ?? null,
  }));
}

function isTrainingStatsRaw(value: unknown): boolean {
  const v = value as { certRows?: unknown; trainingRows?: unknown } | null;
  return !!v && Array.isArray(v.certRows) && Array.isArray(v.trainingRows);
}

function isPagedCourseRaw(value: unknown): boolean {
  const v = value as { rows?: unknown; total?: unknown } | null;
  return !!v && Array.isArray(v.rows) && typeof v.total === 'number';
}

function isRosterRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => el !== null && typeof el === 'object' && !Array.isArray(el));
}
