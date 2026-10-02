// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, HEALTH_METRICS_L2_RANGES, HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED } from '@lfx-one/shared/constants';

import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
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

/** The summary row that holds the foundation's totals; every other row is one delivery type. */
const ALL_DELIVERY_TYPES = 'All';

/** The comparison columns per period: YTD against the same point last year, a completed year against the one before it. */
const BASELINE_COLUMN_SUFFIX: Readonly<Record<HealthMetricsL2Range, string | null>> = {
  YTD: 'prev_ytd',
  COMPLETED_YEAR: 'prev_completed_year',
  COMPLETED_YEAR_2: '3rd_last_completed_year',
  COMPLETED_YEAR_3: null,
};

/** Upper-cased Snowflake keys; each period's columns carry the range as a suffix (e.g. `ENROLLMENTS_YTD`). */
type SummaryRow = { DELIVERY_TYPE: string } & Record<string, unknown>;

interface YearRow {
  ENROLLMENT_YEAR: number;
  ENROLLMENT_COUNT: number | null;
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
      const baseline = BASELINE_COLUMN_SUFFIX[range];
      const baselineColumn = (prefix: string, alias: string): string => `${baseline ? `${prefix}_${baseline}` : 'NULL'} AS ${alias}_${range}`;
      return [
        `enrollment_count_${suffix} AS enrollments_${range}`,
        `certifications_earned_count_${suffix} AS certifications_${range}`,
        `revenue_usd_${suffix} AS revenue_usd_${range}`,
        `sort_rank_${suffix} AS sort_rank_${range}`,
        baselineColumn('enrollment_count', 'baseline_enrollments'),
        baselineColumn('certifications_earned_count', 'baseline_certifications'),
        baselineColumn('revenue_usd', 'baseline_revenue_usd'),
      ];
    });

    const summarySql = `
      SELECT
        delivery_type,
        ${periodColumns.join(',\n        ')}
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
}

/** One period from the wide summary rows; types follow the view's rank for that period, `delivery_type` breaking ties. */
function toPeriod(all: SummaryRow, types: SummaryRow[], range: HealthMetricsL2Range): HealthMetricsTrainingEnrollmentPeriod {
  const rank = (row: SummaryRow): number => toNullableNumber(row[`SORT_RANK_${range}`]) ?? Number.POSITIVE_INFINITY;
  const byType = [...types]
    .sort((a, b) => rank(a) - rank(b) || a.DELIVERY_TYPE.localeCompare(b.DELIVERY_TYPE))
    .map((row) => ({
      deliveryType: row.DELIVERY_TYPE,
      enrollments: toNullableNumber(row[`ENROLLMENTS_${range}`]),
      revenueUsd: toNullableNumber(row[`REVENUE_USD_${range}`]),
    }));

  return {
    totals: toTotals(all[`ENROLLMENTS_${range}`], all[`CERTIFICATIONS_${range}`], all[`REVENUE_USD_${range}`]),
    baseline: BASELINE_COLUMN_SUFFIX[range]
      ? toTotals(all[`BASELINE_ENROLLMENTS_${range}`], all[`BASELINE_CERTIFICATIONS_${range}`], all[`BASELINE_REVENUE_USD_${range}`])
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
