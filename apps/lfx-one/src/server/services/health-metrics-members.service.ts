// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_L2_RANGES,
  HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP,
  HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_LEVELS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_OPTION_CAP,
  HEALTH_METRICS_MEMBERS_MOVEMENTS_MAX_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE,
  HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
} from '@lfx-one/shared/constants';

import { toIsoDate } from '../helpers/date-format.helper';
import { isHealthMetricsL2Range } from '../helpers/health-metrics-l2.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { clampInteger, escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsMembersBridge,
  HealthMetricsMembersBridgeQuery,
  HealthMetricsMembersBridgeStep,
  HealthMetricsMembersBridgeStepType,
  HealthMetricsMembersDirectory,
  HealthMetricsMembersDirectoryMember,
  HealthMetricsMembersDirectoryQuery,
  HealthMetricsMembersDirectoryTiers,
  HealthMetricsMembersDirectoryTiersQuery,
  HealthMetricsMembersEngagementLevel,
  HealthMetricsMembersFoundationRevenue,
  HealthMetricsMembersMovement,
  HealthMetricsMembersMovements,
  HealthMetricsMembersMovementsQuery,
  HealthMetricsMembersNpsCategory,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersQuery,
  HealthMetricsMembersTierYear,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const MEMBERSHIP_TIER_YEAR_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_TIER_YEAR';
const OVERVIEW_REVENUE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.HEALTH_OVERVIEW_REVENUE';
const MEMBERSHIP_WATERFALL_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_WATERFALL';
const MEMBERSHIP_MOVEMENT_DETAIL_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_MOVEMENT_DETAIL';
const MEMBERSHIP_DIRECTORY_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_DIRECTORY';

const BRIDGE_STEP_TYPES: ReadonlySet<string> = new Set<HealthMetricsMembersBridgeStepType>(HEALTH_METRICS_MEMBERS_BRIDGE_STEP_TYPES);
const NPS_CATEGORIES: ReadonlySet<string> = new Set<HealthMetricsMembersNpsCategory>(HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CATEGORIES);
const ENGAGEMENT_LEVELS: ReadonlySet<string> = new Set<HealthMetricsMembersEngagementLevel>(HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_LEVELS);

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

interface BridgeRow {
  YEAR: number | null;
  MOVEMENT_TYPE: string | null;
  SORT_ORDER: number | null;
  IS_PARTIAL_YEAR: boolean | null;
  MEMBER_COUNT: number | null;
  SIGNED_MEMBER_COUNT: number | null;
  REVENUE_IMPACT_USD: number | null;
}

interface MovementRow {
  TOTAL_RECORDS: number | null;
  IS_PAGE_ROW: boolean | null;
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  MEMBERSHIP_TIER: string | null;
  DUES_IMPACT_USD: number | null;
  MOVEMENT_DATE: Date | string | null;
  LAST_ENGAGED_DATE: Date | string | null;
  SORT_RANK: number | null;
}

interface DirectoryRow {
  SCOPE_TOTAL: number | null;
  TOTAL_RECORDS: number | null;
  AT_RISK_COUNT: number | null;
  IS_PAGE_ROW: boolean | null;
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  MEMBERSHIP_TIER: string | null;
  ANNUAL_DUES_USD: number | null;
  ENGAGEMENT_LEVEL: string | null;
  ENGAGEMENT_SCORE: number | null;
  NPS_CATEGORY: string | null;
  IS_AT_RISK: boolean | null;
  RENEWAL_DATE: Date | string | null;
  RENEWAL_DUES_USD: number | null;
  LAST_ENGAGED_DATE: Date | string | null;
  CONTRIBUTION_COUNT: number | null;
  SPONSORSHIP_USD: number | null;
  TRAINING_ENROLLMENT_COUNT: number | null;
  EVENT_REGISTRATION_COUNT: number | null;
}

interface DirectoryTierRow {
  MEMBERSHIP_TIER: string | null;
}

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

  /**
   * Every year's bridge off `MEMBERSHIP_WATERFALL`: the start total, the four movements and the closing
   * total. All years come back at once, so a period change re-projects without a re-read.
   */
  public async getBridge(req: Request, query: HealthMetricsMembersBridgeQuery): Promise<HealthMetricsMembersBridge> {
    const sql = `
      SELECT
        year,
        movement_type,
        sort_order,
        is_partial_year,
        member_count,
        signed_member_count,
        revenue_impact_usd
      FROM ${MEMBERSHIP_WATERFALL_VIEW}
      WHERE foundation_slug = ?
        AND year IS NOT NULL
        AND movement_type IS NOT NULL
      ORDER BY year DESC, sort_order ASC NULLS LAST, movement_type ASC
      LIMIT ${HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP + 1}
    `;

    const result = await executeSnowflakeViewRead<BridgeRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: MEMBERSHIP_WATERFALL_VIEW,
      operation: 'get_members_bridge',
      clientMessage: 'The membership bridge is unavailable right now.',
    });

    let rows = result.rows;
    if (rows.length > HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP) {
      logger.warning(req, 'get_members_bridge', 'Membership bridge rows hit the read cap', {
        foundation_slug: query.foundationSlug,
        row_cap: HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP,
      });
      rows = capWholeYears(rows, HEALTH_METRICS_MEMBERS_BRIDGE_ROW_CAP);
    }

    return { steps: rows.map(mapBridgeStep).filter((step): step is HealthMetricsMembersBridgeStep => step !== null) };
  }

  /**
   * One page of the organizations behind a bridge bar, in the view's own `sort_rank` order. The total
   * is a separate aggregate joined onto the page, so a page past the end still reports it.
   */
  public async getMovements(req: Request, query: HealthMetricsMembersMovementsQuery): Promise<HealthMetricsMembersMovements> {
    const pageSize = clampInteger(query.pageSize, 1, HEALTH_METRICS_MEMBERS_MOVEMENTS_MAX_PAGE_SIZE, HEALTH_METRICS_MEMBERS_MOVEMENTS_PAGE_SIZE);
    const offset = clampInteger(query.offset, 0, MAX_SNOWFLAKE_PAGINATION_PAGE * pageSize, 0);

    const sql = `
      WITH scoped AS (
        SELECT *
        FROM ${MEMBERSHIP_MOVEMENT_DETAIL_VIEW}
        WHERE foundation_slug = ?
          AND year = ?
          AND movement_type = ?
          -- Rows the mapper cannot show must not count, or the total and the page window drift apart.
          AND account_id IS NOT NULL
          AND account_id <> ''
      ),
      totals AS (
        SELECT COUNT(*) AS total_records
        FROM scoped
      ),
      page AS (
        SELECT
          account_id,
          account_name,
          membership_tier,
          dues_impact_usd,
          movement_date,
          last_engaged_date,
          sort_rank,
          -- Distinguishes a real page row from the totals-only row the LEFT JOIN keeps below.
          TRUE AS is_page_row
        FROM scoped
        -- NULLS LAST pins null placement, so a pooled session's null ordering cannot drift rows between pages.
        ORDER BY sort_rank ASC NULLS LAST, account_id ASC NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.account_id ASC NULLS LAST
    `;

    const result = await executeSnowflakeViewRead<MovementRow>(this.snowflakeService, req, sql, [query.foundationSlug, query.year, query.movementType], {
      view: MEMBERSHIP_MOVEMENT_DETAIL_VIEW,
      operation: 'get_members_movements',
      clientMessage: 'This list of members is unavailable right now.',
    });

    return {
      rows: result.rows.filter((row) => row.IS_PAGE_ROW === true).flatMap(mapMovement),
      totalRecords: Number(result.rows[0]?.TOTAL_RECORDS ?? 0),
    };
  }

  /**
   * One page of the foundation's members in the view's own `sort_rank` order (highest dues first, then
   * least engaged), with the activity counts for the period.
   */
  public async getDirectory(req: Request, query: HealthMetricsMembersDirectoryQuery): Promise<HealthMetricsMembersDirectory> {
    // The suffix comes from a constant keyed by the validated range, never from the request, so interpolating it is safe.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    const binds: string[] = [query.foundationSlug];

    const predicates: string[] = [];
    if (query.tier) {
      predicates.push('TRIM(membership_tier) = ?');
      binds.push(query.tier);
    }
    if (query.nps) {
      predicates.push('nps_category = ?');
      binds.push(query.nps);
    }
    if (query.search) {
      predicates.push("account_name ILIKE ? ESCAPE '!'");
      binds.push(`%${escapeSqlLikePattern(query.search)}%`);
    }
    const matchClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';

    const pageSize = clampInteger(query.pageSize, 1, HEALTH_METRICS_MEMBERS_DIRECTORY_MAX_PAGE_SIZE, HEALTH_METRICS_MEMBERS_DIRECTORY_PAGE_SIZE);
    const offset = clampInteger(query.offset, 0, MAX_SNOWFLAKE_PAGINATION_PAGE * pageSize, 0);

    const sql = `
      WITH scoped AS (
        SELECT
          account_id,
          account_name,
          membership_tier,
          annual_dues_usd,
          engagement_level,
          engagement_score,
          nps_category,
          is_at_risk,
          renewal_date,
          renewal_dues_usd,
          last_engaged_date,
          sort_rank,
          contribution_count_${suffix} AS contribution_count,
          sponsorship_usd_${suffix} AS sponsorship_usd,
          training_enrollment_count_${suffix} AS training_enrollment_count,
          event_registration_count_${suffix} AS event_registration_count
        FROM ${MEMBERSHIP_DIRECTORY_VIEW}
        WHERE foundation_slug = ?
          -- Rows the mapper cannot show must not count, or the totals and the page window drift apart.
          AND account_id IS NOT NULL
          AND account_id <> ''
      ),
      matched AS (
        SELECT * FROM scoped ${matchClause}
      ),
      totals AS (
        SELECT
          (SELECT COUNT(*) FROM scoped) AS scope_total,
          -- Counts rows on the model's own at-risk flag; the page never derives the risk itself.
          (SELECT COUNT_IF(is_at_risk) FROM scoped) AS at_risk_count,
          (SELECT COUNT(*) FROM matched) AS total_records
      ),
      page AS (
        SELECT *, TRUE AS is_page_row
        FROM matched
        -- account_id breaks any tie, and NULLS LAST pins placement against the session's null ordering.
        ORDER BY sort_rank ASC NULLS LAST, account_id ASC
        LIMIT ${pageSize} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.account_id ASC
    `;

    const result = await executeSnowflakeViewRead<DirectoryRow>(this.snowflakeService, req, sql, binds, {
      view: MEMBERSHIP_DIRECTORY_VIEW,
      operation: 'get_members_directory',
      clientMessage: 'The members directory is unavailable right now.',
    });

    const first = result.rows[0];
    return {
      rows: result.rows.filter((row) => row.IS_PAGE_ROW === true).flatMap(mapDirectoryMember),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      scopeTotal: Number(first?.SCOPE_TOTAL ?? 0),
      atRiskCount: Number(first?.AT_RISK_COUNT ?? 0),
    };
  }

  /** The foundation's tiers, highest-paying first, for the directory's tier filter. */
  public async getDirectoryTiers(req: Request, query: HealthMetricsMembersDirectoryTiersQuery): Promise<HealthMetricsMembersDirectoryTiers> {
    const sql = `
      -- Trimmed so a padded value neither splits into its own option nor misses the trimmed filter.
      SELECT NULLIF(TRIM(membership_tier), '') AS membership_tier
      FROM ${MEMBERSHIP_DIRECTORY_VIEW}
      WHERE foundation_slug = ?
        AND account_id IS NOT NULL
        AND account_id <> ''
        AND NULLIF(TRIM(membership_tier), '') IS NOT NULL
      GROUP BY NULLIF(TRIM(membership_tier), '')
      ORDER BY MAX(annual_dues_usd) DESC NULLS LAST, membership_tier ASC
      LIMIT ${HEALTH_METRICS_MEMBERS_DIRECTORY_TIER_OPTION_CAP}
    `;

    const result = await executeSnowflakeViewRead<DirectoryTierRow>(this.snowflakeService, req, sql, [query.foundationSlug], {
      view: MEMBERSHIP_DIRECTORY_VIEW,
      operation: 'get_members_directory_tiers',
      clientMessage: 'The members directory is unavailable right now.',
    });

    return { tiers: result.rows.flatMap((row) => (row.MEMBERSHIP_TIER ? [row.MEMBERSHIP_TIER] : [])) };
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
      rows = capWholeYears(rows, HEALTH_METRICS_MEMBERS_TIERS_ROW_CAP);
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

/**
 * Rows arrive newest year first, so the cap drops the oldest; a year the extra row shows was split goes
 * too, unless it is the only one. `rows` holds one more row than `cap`.
 */
function capWholeYears<T extends { YEAR: number | null }>(rows: T[], cap: number): T[] {
  const cutYear = rows[cap - 1].YEAR;
  const yearWasSplit = rows[cap].YEAR === cutYear;
  const capped = rows.slice(0, cap);
  return yearWasSplit && capped.some((row) => row.YEAR !== cutYear) ? capped.filter((row) => row.YEAR !== cutYear) : capped;
}

function mapBridgeStep(row: BridgeRow): HealthMetricsMembersBridgeStep | null {
  const year = toNullableNumber(row.YEAR);
  if (year === null || !row.MOVEMENT_TYPE || !BRIDGE_STEP_TYPES.has(row.MOVEMENT_TYPE)) return null;

  return {
    year,
    movementType: row.MOVEMENT_TYPE as HealthMetricsMembersBridgeStepType,
    sortOrder: toNullableNumber(row.SORT_ORDER) ?? Number.MAX_SAFE_INTEGER,
    isPartialYear: row.IS_PARTIAL_YEAR === true,
    memberCount: toNullableNumber(row.MEMBER_COUNT),
    signedMemberCount: toNullableNumber(row.SIGNED_MEMBER_COUNT),
    revenueImpactUsd: toNullableNumber(row.REVENUE_IMPACT_USD),
  };
}

function mapMovement(row: MovementRow): HealthMetricsMembersMovement[] {
  if (!row.ACCOUNT_ID) return [];

  return [
    {
      accountId: row.ACCOUNT_ID,
      accountName: row.ACCOUNT_NAME || row.ACCOUNT_ID,
      membershipTier: row.MEMBERSHIP_TIER || null,
      duesImpactUsd: toNullableNumber(row.DUES_IMPACT_USD),
      movementDate: toIsoDate(row.MOVEMENT_DATE),
      lastEngagedDate: toIsoDate(row.LAST_ENGAGED_DATE),
    },
  ];
}

function mapDirectoryMember(row: DirectoryRow): HealthMetricsMembersDirectoryMember[] {
  if (!row.ACCOUNT_ID) return [];

  return [
    {
      accountId: row.ACCOUNT_ID,
      accountName: row.ACCOUNT_NAME || row.ACCOUNT_ID,
      membershipTier: row.MEMBERSHIP_TIER || null,
      annualDuesUsd: toNullableNumber(row.ANNUAL_DUES_USD),
      engagementLevel:
        row.ENGAGEMENT_LEVEL && ENGAGEMENT_LEVELS.has(row.ENGAGEMENT_LEVEL) ? (row.ENGAGEMENT_LEVEL as HealthMetricsMembersEngagementLevel) : null,
      engagementScore: toNullableNumber(row.ENGAGEMENT_SCORE),
      npsCategory: row.NPS_CATEGORY && NPS_CATEGORIES.has(row.NPS_CATEGORY) ? (row.NPS_CATEGORY as HealthMetricsMembersNpsCategory) : null,
      isAtRisk: row.IS_AT_RISK === true,
      renewalDate: toIsoDate(row.RENEWAL_DATE),
      renewalDuesUsd: toNullableNumber(row.RENEWAL_DUES_USD),
      lastEngagedDate: toIsoDate(row.LAST_ENGAGED_DATE),
      contributionCount: toNullableNumber(row.CONTRIBUTION_COUNT),
      sponsorshipUsd: toNullableNumber(row.SPONSORSHIP_USD),
      trainingEnrollmentCount: toNullableNumber(row.TRAINING_ENROLLMENT_COUNT),
      eventRegistrationCount: toNullableNumber(row.EVENT_REGISTRATION_COUNT),
    },
  ];
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
