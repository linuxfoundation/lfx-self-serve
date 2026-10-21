// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_TRAINING_COURSES_MAX_PAGE_SIZE,
  HEALTH_METRICS_TRAINING_COURSES_PAGE_SIZE,
  HEALTH_METRICS_TRAINING_COURSES_TYPE_DELIVERY_TYPES,
  HEALTH_METRICS_TRAINING_ENROLLMENT_COMPARED_RANGES,
  HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
} from '@lfx-one/shared/constants';

import { isHealthMetricsL2Range } from '../helpers/health-metrics-l2.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { clampInteger, escapeSqlLikePattern } from '../helpers/validation.helper';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsTrainingCourse,
  HealthMetricsTrainingCourses,
  HealthMetricsTrainingCoursesQuery,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentPeriod,
  HealthMetricsTrainingEnrollmentQuery,
  HealthMetricsTrainingEnrollmentTotals,
  HealthMetricsTrainingPresence,
  HealthMetricsTrainingPresenceQuery,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const TRAINING_SUMMARY_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.TRAINING_SUMMARY';
const TRAINING_ENROLLMENTS_BY_YEAR_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.TRAINING_ENROLLMENTS_BY_YEAR';
const TRAINING_COURSES_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.TRAINING_COURSES';

/** The summary row that holds the foundation's totals; every other row is one delivery type. */
const ALL_DELIVERY_TYPES = 'All';

/** True when the Training views carry columns for the range; for a controller to check before binding. */
export function isSupportedTrainingRange(range: string): range is HealthMetricsL2Range {
  return isHealthMetricsL2Range(range);
}

/** Upper-cased Snowflake keys; each period's columns carry the range as a suffix (e.g. `ENROLLMENTS_YTD`). */
type SummaryRow = { DELIVERY_TYPE: string; IS_LISTED_DELIVERY_TYPE?: boolean | null } & Record<string, unknown>;

interface YearRow {
  ENROLLMENT_YEAR: number;
  ENROLLMENT_COUNT: number | null;
}

/** Totals ride on every row; a page past the end leaves one totals-only row whose course columns are NULL. */
interface CourseRow {
  SCOPE_TOTAL: number | null;
  TOTAL_RECORDS: number;
  IS_PAGE_ROW: boolean | null;
  COURSE_KEY: string | null;
  COURSE_NAME: string | null;
  DELIVERY_TYPE: string | null;
  IS_FREE: boolean | null;
  HAS_PURCHASE_COVERAGE: boolean | null;
  ENROLLMENT_COUNT: number | null;
  REVENUE_USD: number | null;
  /** Orders the page only; `toCourse` leaves it out of the response. */
  SORT_RANK: number | null;
}

/** Snowflake reads behind the Health Metrics Training tab; every figure is foundation-wide. */
export class HealthMetricsTrainingService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Whether LF Education has any training rows for the foundation; none means it runs no programme. */
  public async getPresence(req: Request, query: HealthMetricsTrainingPresenceQuery): Promise<HealthMetricsTrainingPresence> {
    const sql = `
      SELECT 1 AS present
      FROM ${TRAINING_SUMMARY_VIEW}
      WHERE foundation_slug = ?
      LIMIT 1
    `;

    const { rows } = await executeSnowflakeViewRead<{ PRESENT: number }>(this.snowflakeService, req, sql, [query.foundationSlug], {
      operation: 'get_training_presence',
      view: TRAINING_SUMMARY_VIEW,
      clientMessage: 'Training is unavailable right now.',
    });

    return { hasProgramme: rows.length > 0 };
  }

  /** Every period's KPI strip and by-type split from the summary, plus enrollments for every year, in one read. */
  public async getEnrollment(req: Request, query: HealthMetricsTrainingEnrollmentQuery): Promise<HealthMetricsTrainingEnrollment> {
    // Every column comes from fixed maps keyed by the L2 ranges, never from the request.
    const periodColumns = HEALTH_METRICS_L2_RANGES.flatMap((range) => {
      const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range];
      return [
        `enrollment_count_${suffix} AS enrollments_${range}`,
        `certifications_earned_count_${suffix} AS certifications_${range}`,
        `revenue_usd_${suffix} AS revenue_usd_${range}`,
        `sort_rank_${suffix} AS sort_rank_${range}`,
      ];
    });

    const summarySql = `
      SELECT
        delivery_type,
        is_listed_delivery_type,
        ${periodColumns.join(',\n        ')},
        enrollment_count_change_pct,
        certifications_change_pct,
        revenue_change_pct
      FROM ${TRAINING_SUMMARY_VIEW}
      WHERE foundation_slug = ?
    `;
    const trendSql = `
      SELECT enrollment_year, enrollment_count
      FROM ${TRAINING_ENROLLMENTS_BY_YEAR_VIEW}
      WHERE foundation_slug = ?
      ORDER BY enrollment_year ASC
    `;
    const options = { operation: 'get_training_enrollment', clientMessage: 'Training enrollment is unavailable right now.' };

    const [summary, trend] = await Promise.all([
      executeSnowflakeViewRead<SummaryRow>(this.snowflakeService, req, summarySql, [query.foundationSlug], { ...options, view: TRAINING_SUMMARY_VIEW }),
      executeSnowflakeViewRead<YearRow>(this.snowflakeService, req, trendSql, [query.foundationSlug], { ...options, view: TRAINING_ENROLLMENTS_BY_YEAR_VIEW }),
    ]);

    const all = summary.rows.find((row) => row.DELIVERY_TYPE === ALL_DELIVERY_TYPES);
    if (!all) return HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED;

    const types = summary.rows.filter((row) => row.DELIVERY_TYPE && row.DELIVERY_TYPE !== ALL_DELIVERY_TYPES);
    const periods = Object.fromEntries(HEALTH_METRICS_L2_RANGES.map((range) => [range, toPeriod(all, types, range)])) as Record<
      HealthMetricsL2Range,
      HealthMetricsTrainingEnrollmentPeriod
    >;

    return {
      measured: true,
      periods,
      trend: trend.rows.map((row) => ({ year: Number(row.ENROLLMENT_YEAR), enrollments: toNullableNumber(row.ENROLLMENT_COUNT) })),
    };
  }

  /** One page of every course ever enrolled in, ranked by the view for the period, with the totals beside it. */
  public async getCourses(req: Request, query: HealthMetricsTrainingCoursesQuery): Promise<HealthMetricsTrainingCourses> {
    // The suffix comes from a fixed map keyed by the validated range, never from the request.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    const binds: string[] = [query.foundationSlug];

    const predicates: string[] = [];
    if (query.type !== 'all') {
      predicates.push('delivery_type = ?');
      binds.push(HEALTH_METRICS_TRAINING_COURSES_TYPE_DELIVERY_TYPES[query.type]);
    }
    if (query.search) {
      predicates.push("course_name ILIKE ? ESCAPE '!'");
      binds.push(`%${escapeSqlLikePattern(query.search)}%`);
    }
    const matchClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';

    const pageSize = clampInteger(query.pageSize, 1, HEALTH_METRICS_TRAINING_COURSES_MAX_PAGE_SIZE, HEALTH_METRICS_TRAINING_COURSES_PAGE_SIZE);
    const offset = clampInteger(query.offset, 0, MAX_SNOWFLAKE_PAGINATION_PAGE * pageSize, 0);

    // Totals are joined onto the page rather than read as `COUNT(*) OVER()`, so a page past the end still reports them.
    const sql = `
      WITH scoped AS (
        SELECT
          _key AS course_key,
          course_name,
          delivery_type,
          is_free,
          has_purchase_coverage,
          enrollment_count_${suffix} AS enrollment_count,
          revenue_usd_${suffix} AS revenue_usd,
          sort_rank_${suffix} AS sort_rank,
          scope_courses_count
        FROM ${TRAINING_COURSES_VIEW}
        WHERE foundation_slug = ?
          -- PCC's list: every course ever enrolled in, so one quiet in the period shows 0 rather than dropping out.
          AND has_enrollment_all_time
          AND _key IS NOT NULL
          AND NULLIF(TRIM(course_name), '') IS NOT NULL
      ),
      matched AS (
        SELECT * FROM scoped ${matchClause}
      ),
      totals AS (
        -- The badge is the view's own count, repeated on every row and the same in every period.
        SELECT (SELECT MAX(scope_courses_count) FROM scoped) AS scope_total, (SELECT COUNT(*) FROM matched) AS total_records
      ),
      page AS (
        SELECT *, TRUE AS is_page_row
        FROM matched
        -- course_key breaks any tie, and NULLS LAST pins placement against the session's null ordering.
        ORDER BY sort_rank ASC NULLS LAST, course_key ASC
        LIMIT ${pageSize} OFFSET ${offset}
      )
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.course_key ASC
    `;

    const result = await executeSnowflakeViewRead<CourseRow>(this.snowflakeService, req, sql, binds, {
      view: TRAINING_COURSES_VIEW,
      operation: 'get_training_courses',
      clientMessage: 'Training courses are unavailable right now.',
    });

    const first = result.rows[0];
    return {
      rows: result.rows.filter((row) => row.IS_PAGE_ROW === true).flatMap((row) => toCourse(row) ?? []),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      scopeTotal: Number(first?.SCOPE_TOTAL ?? 0),
    };
  }
}

/** A page row as a course; a row missing its key or name cannot render, so it is dropped. */
function toCourse(row: CourseRow): HealthMetricsTrainingCourse | null {
  if (!row.COURSE_KEY || !row.COURSE_NAME) return null;

  return {
    courseKey: row.COURSE_KEY,
    courseName: row.COURSE_NAME,
    deliveryType: row.DELIVERY_TYPE ?? '',
    isFree: row.IS_FREE ?? null,
    hasPurchaseCoverage: row.HAS_PURCHASE_COVERAGE === true,
    enrollments: toNullableNumber(row.ENROLLMENT_COUNT),
    revenueUsd: toNullableNumber(row.REVENUE_USD),
  };
}

/** One period from the wide summary rows; types follow the view's rank for that period, `delivery_type` breaking ties. */
function toPeriod(all: SummaryRow, types: SummaryRow[], range: HealthMetricsL2Range): HealthMetricsTrainingEnrollmentPeriod {
  const rank = (row: SummaryRow): number => toNullableNumber(row[`SORT_RANK_${range}`]) ?? Number.POSITIVE_INFINITY;
  const byType = [...types]
    .sort((a, b) => rank(a) - rank(b) || a.DELIVERY_TYPE.localeCompare(b.DELIVERY_TYPE))
    .map((row) => ({
      deliveryType: row.DELIVERY_TYPE,
      isListed: row.IS_LISTED_DELIVERY_TYPE === true,
      enrollments: toNullableNumber(row[`ENROLLMENTS_${range}`]),
      revenueUsd: toNullableNumber(row[`REVENUE_USD_${range}`]),
    }));

  return {
    totals: toTotals(all[`ENROLLMENTS_${range}`], all[`CERTIFICATIONS_${range}`], all[`REVENUE_USD_${range}`]),
    change: HEALTH_METRICS_TRAINING_ENROLLMENT_COMPARED_RANGES.includes(range)
      ? {
          enrollments: toNullableNumber(all['ENROLLMENT_COUNT_CHANGE_PCT']),
          certifications: toNullableNumber(all['CERTIFICATIONS_CHANGE_PCT']),
          revenueUsd: toNullableNumber(all['REVENUE_CHANGE_PCT']),
        }
      : null,
    byType,
  };
}

function toTotals(enrollments: unknown, certifications: unknown, revenueUsd: unknown): HealthMetricsTrainingEnrollmentTotals {
  return { enrollments: toNullableNumber(enrollments), certifications: toNullableNumber(certifications), revenueUsd: toNullableNumber(revenueUsd) };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
