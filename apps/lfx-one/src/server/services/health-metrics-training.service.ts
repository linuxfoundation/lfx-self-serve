// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED } from '@lfx-one/shared/constants';

import { isHealthMetricsL2Range } from '../helpers/health-metrics-l2.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsTrainingEnrollment,
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

interface SummaryRow {
  DELIVERY_TYPE: string;
  ENROLLMENTS: number | null;
  CERTIFICATIONS: number | null;
  REVENUE_USD: number | null;
  BASELINE_ENROLLMENTS: number | null;
  BASELINE_CERTIFICATIONS: number | null;
  BASELINE_REVENUE_USD: number | null;
}

interface YearRow {
  ENROLLMENT_YEAR: number;
  ENROLLMENT_COUNT: number | null;
}

/** The training summary carries the four L2 periods. */
export function isSupportedTrainingRange(range: string): range is HealthMetricsL2Range {
  return isHealthMetricsL2Range(range);
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

  /** The period's KPI strip and by-type split from the summary, plus enrollments for every year. */
  public async getEnrollment(req: Request, query: HealthMetricsTrainingEnrollmentQuery): Promise<HealthMetricsTrainingEnrollment> {
    // Both suffixes come from fixed maps keyed by the validated range, never from the request.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    const baseline = BASELINE_COLUMN_SUFFIX[query.range];
    const baselineColumn = (prefix: string, alias: string): string => (baseline ? `${prefix}_${baseline} AS ${alias}` : `NULL AS ${alias}`);

    const summarySql = `
      SELECT
        delivery_type,
        enrollment_count_${suffix} AS enrollments,
        certifications_earned_count_${suffix} AS certifications,
        revenue_usd_${suffix} AS revenue_usd,
        ${baselineColumn('enrollment_count', 'baseline_enrollments')},
        ${baselineColumn('certifications_earned_count', 'baseline_certifications')},
        ${baselineColumn('revenue_usd', 'baseline_revenue_usd')}
      FROM ${TRAINING_SUMMARY_VIEW}
      WHERE foundation_slug = ?
      -- The view's rank for the period; the All row has none, and delivery_type breaks any tie.
      ORDER BY sort_rank_${suffix} ASC NULLS LAST, delivery_type ASC
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

    return {
      measured: true,
      totals: toTotals(all.ENROLLMENTS, all.CERTIFICATIONS, all.REVENUE_USD),
      baseline: baseline ? toTotals(all.BASELINE_ENROLLMENTS, all.BASELINE_CERTIFICATIONS, all.BASELINE_REVENUE_USD) : null,
      byType: summary.rows
        .filter((row) => row.DELIVERY_TYPE && row.DELIVERY_TYPE !== ALL_DELIVERY_TYPES)
        .map((row) => ({ deliveryType: row.DELIVERY_TYPE, enrollments: toNullableNumber(row.ENROLLMENTS), revenueUsd: toNullableNumber(row.REVENUE_USD) })),
      trend: trend.rows.map((row) => ({ year: Number(row.ENROLLMENT_YEAR), enrollments: toNullableNumber(row.ENROLLMENT_COUNT) })),
    };
  }
}

function toTotals(enrollments: unknown, certifications: unknown, revenueUsd: unknown): HealthMetricsTrainingEnrollmentTotals {
  return { enrollments: toNullableNumber(enrollments), certifications: toNullableNumber(certifications), revenueUsd: toNullableNumber(revenueUsd) };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
