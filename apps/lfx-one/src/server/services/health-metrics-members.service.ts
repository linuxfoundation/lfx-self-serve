// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX, HEALTH_METRICS_L2_RANGES, HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP } from '@lfx-one/shared/constants';

import { isHealthMetricsL2Range } from '../helpers/health-metrics-l2.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsMembersFoundationRevenue,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersQuery,
  HealthMetricsMembersTierYear,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const MEMBERSHIP_TIER_YEAR_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_TIER_YEAR';
const OVERVIEW_REVENUE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.HEALTH_OVERVIEW_REVENUE';

interface TierYearRow {
  YEAR: number;
  MEMBERSHIP_TIER: string | null;
  TIER_SORT_RANK: number | null;
  MEMBER_COUNT: number | null;
  NEW_MEMBER_COUNT: number | null;
  TIER_REVENUE_USD: number | null;
  IS_PARTIAL_YEAR: boolean | null;
}

type FoundationRevenueRow = Record<string, number | null>;

/** True when the Members views carry columns for the range; for a controller to check before binding. */
export function isSupportedMembersRange(range: string): range is HealthMetricsL2Range {
  return isHealthMetricsL2Range(range);
}

/** The Members tab's view reads; each section adds its query through `executeSnowflakeViewRead`. */
export class HealthMetricsMembersService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Every year's members, new members and revenue per tier, plus the foundation's revenue across every
   * domain per period. All years come back at once, so a period change re-projects without a re-read.
   */
  public async getTiers(req: Request, query: HealthMetricsMembersTiersQuery): Promise<HealthMetricsMembersTiers> {
    const [rows, foundationRevenue] = await Promise.all([this.getTierYears(req, query), this.getFoundationRevenue(req, query)]);
    return { rows, foundationRevenue };
  }

  private async getTierYears(req: Request, query: HealthMetricsMembersTiersQuery): Promise<HealthMetricsMembersTierYear[]> {
    const sql = `
      SELECT
        year,
        membership_tier,
        tier_sort_rank,
        member_count,
        new_member_count,
        tier_revenue_usd,
        is_partial_year
      FROM ${MEMBERSHIP_TIER_YEAR_VIEW}
      WHERE foundation_slug = ?
        AND year IS NOT NULL
        AND membership_tier IS NOT NULL
      ORDER BY year DESC, tier_sort_rank ASC NULLS LAST, membership_tier ASC
      LIMIT ${HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<TierYearRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: MEMBERSHIP_TIER_YEAR_VIEW,
      operation: 'get_members_tiers',
      clientMessage: 'Membership by tier is unavailable right now.',
    });

    let rows = result.rows;
    if (rows.length > HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP) {
      logger.warning(req, 'get_members_tiers', 'Membership tier rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP,
      });
      // Newest years first, so the cap drops the oldest; a year the extra row shows was split goes too,
      // unless it is the only one.
      const cutYear = rows[HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP - 1].YEAR;
      const yearWasSplit = rows[HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP].YEAR === cutYear;
      rows = rows.slice(0, HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP);
      if (yearWasSplit && rows.some((row) => row.YEAR !== cutYear)) rows = rows.filter((row) => row.YEAR !== cutYear);
    }

    return rows.map(mapTierYear).filter((row): row is HealthMetricsMembersTierYear => row !== null);
  }

  /** The foundation's total revenue per period, off the Memberships row whose tier revenue reconciles with it. */
  private async getFoundationRevenue(req: Request, query: HealthMetricsMembersTiersQuery): Promise<HealthMetricsMembersFoundationRevenue[]> {
    // The suffixes come from constants, never from the request, so interpolating them is safe.
    // The view holds one row per foundation and revenue domain, so `LIMIT 1` needs no ORDER BY.
    const columns = HEALTH_METRICS_L2_RANGES.map((range) => ({
      range,
      column: `foundation_total_revenue_usd_${HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[range]}`,
    }));
    const sql = `
      SELECT
        ${columns.map(({ column }) => column).join(',\n        ')}
      FROM ${OVERVIEW_REVENUE_VIEW}
      WHERE foundation_slug = ?
        AND LOWER(revenue_domain) = 'memberships'
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<FoundationRevenueRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: OVERVIEW_REVENUE_VIEW,
      operation: 'get_members_tiers',
      clientMessage: 'Membership by tier is unavailable right now.',
    });

    const row = result.rows[0];
    if (!row) return [];

    // A null total is no data for that period, so the period is left out and its share reads as not available.
    return columns.flatMap(({ range, column }) => {
      const totalUsd = toNullableNumber(row[column.toUpperCase()]);
      return totalUsd === null ? [] : [{ range, totalUsd }];
    });
  }
}

function mapTierYear(row: TierYearRow): HealthMetricsMembersTierYear | null {
  const year = toNullableNumber(row.YEAR);
  if (year === null || !row.MEMBERSHIP_TIER) return null;

  return {
    year,
    tier: row.MEMBERSHIP_TIER,
    // An unranked tier sorts after every ranked one.
    sortRank: toNullableNumber(row.TIER_SORT_RANK) ?? Number.MAX_SAFE_INTEGER,
    memberCount: toNullableNumber(row.MEMBER_COUNT),
    newMemberCount: toNullableNumber(row.NEW_MEMBER_COUNT),
    revenueUsd: toNullableNumber(row.TIER_REVENUE_USD),
    isPartialYear: row.IS_PARTIAL_YEAR === true,
  };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
