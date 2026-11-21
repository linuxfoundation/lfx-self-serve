// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED,
  HEALTH_METRICS_NON_MEMBERS_CONVERSION_WARMEST_LIMIT,
  HEALTH_METRICS_NON_MEMBERS_FIT_BANDS,
  HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
} from '@lfx-one/shared/constants';

import { toIsoDate } from '../helpers/date-format.helper';
import { isHealthMetricsL2Range } from '../helpers/health-metrics-l2.helper';
import { healthMetricsAccountLogoJoinSql, healthMetricsAccountLogoSql } from '../helpers/health-metrics-logo.helper';
import { buildHealthMetricsSortOrderBy, healthMetricsTierRankSql, healthMetricsTrimSql } from '../helpers/health-metrics-sort.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { clampInteger, escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsNonMembersConversion,
  HealthMetricsNonMembersConversionQuery,
  HealthMetricsNonMembersOrg,
  HealthMetricsNonMembersOrgs,
  HealthMetricsNonMembersOrgsQuery,
  HealthMetricsNonMembersOrgsSortKey,
  HealthMetricsNonMembersOtherMembership,
  HealthMetricsNonMembersPeople,
  HealthMetricsNonMembersPeopleQuery,
  HealthMetricsNonMembersPeopleSortKey,
  HealthMetricsNonMembersPerson,
  HealthMetricsNonMembersWarmOrg,
  HealthMetricsSqlSortColumn,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const NON_MEMBER_CONVERSION_OPPORTUNITY_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_CONVERSION_OPPORTUNITY';
const NON_MEMBER_COMPANY_PARTICIPATION_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_COMPANY_PARTICIPATION';
const NON_MEMBER_PEOPLE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_PEOPLE';
const MEMBERSHIP_DIRECTORY_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.MEMBERSHIP_DIRECTORY';

interface OrgRow {
  SCOPE_TOTAL: number | null;
  TOTAL_RECORDS: number | null;
  IS_PAGE_ROW: boolean | null;
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  LAST_ENGAGED_DATE: Date | string | null;
  MEETINGS_ATTENDED_COUNT: number | null;
  DISTINCT_PEOPLE_COUNT: number | null;
  CONTRIBUTIONS_COUNT: number | null;
  SORT_RANK: number | null;
  FIT_BAND: string | null;
  IS_HIGH_FIT: boolean | null;
  /** Sort-only: the highest tier rank and count of the company's memberships in other foundations. */
  OTHER_TOP_TIER_RANK: number | null;
  OTHER_MEMBERSHIP_COUNT: number | null;
  /** The row's place in the picked order, which the outer select keeps after the logo join. */
  PAGE_POSITION: number | null;
  LOGO_URL: string | null;
}

interface OtherMembershipRow {
  ACCOUNT_ID: string | null;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_NAME: string | null;
  MEMBERSHIP_TIER: string | null;
}

interface PersonRow {
  SCOPE_TOTAL: number | null;
  TOTAL_RECORDS: number | null;
  IS_PAGE_ROW: boolean | null;
  PERSON_KEY: string | null;
  PERSON_DISPLAY_NAME: string | null;
  PERSON_JOB_TITLE: string | null;
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  LAST_ATTENDED_DATE: Date | string | null;
  MEETINGS_ATTENDED_COUNT: number | null;
  SORT_RANK: number | null;
  SCOPE_INDIVIDUALS_COUNT: number | null;
  /** The row's place in the picked order, which the outer select keeps after the logo join. */
  PAGE_POSITION: number | null;
  LOGO_URL: string | null;
}

interface ConversionRow {
  HIGH_FIT_ORG_COUNT: number | null;
  NEW_ORG_COUNT: number | null;
  ESTIMATED_PIPELINE_USD: number | null;
}

interface WarmOrgRow {
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  MEETINGS_ATTENDED_COUNT: number | null;
  CONTRIBUTIONS_COUNT: number | null;
  LOGO_URL: string | null;
}

/** True when the Non-Members views carry columns for the range; for a controller to check before binding. */
export function isSupportedNonMembersRange(range: string): range is HealthMetricsL2Range {
  return isHealthMetricsL2Range(range);
}

/** Reads the Non-Members tab's views, one method per section, each through `executeSnowflakeViewRead`. */
export class HealthMetricsNonMembersService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** One page of the period's active non-member companies, in the view's meetings-first rank or a column the reader picked. */
  public async getOrgs(req: Request, query: HealthMetricsNonMembersOrgsQuery): Promise<HealthMetricsNonMembersOrgs> {
    // The suffix comes from a constant keyed by the validated range, never from the request, so interpolating it is safe.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    // Only the Other memberships sort reads the directory, so no other read depends on it. Its CTE binds the foundation first.
    const sortsByMemberships = query.sort?.key === 'memberships';
    const binds: string[] = sortsByMemberships ? [query.foundationSlug, query.foundationSlug] : [query.foundationSlug];

    const predicates: string[] = [];
    if (query.filter === 'meetings') predicates.push('meetings_attended_count > 0');
    if (query.filter === 'high-fit') predicates.push('is_high_fit');
    if (query.search) {
      predicates.push("account_name ILIKE ? ESCAPE '!'");
      binds.push(`%${escapeSqlLikePattern(query.search)}%`);
    }
    const matchClause = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';

    const pageSize = clampInteger(query.pageSize, 1, HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE, HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE);
    const offset = clampInteger(query.offset, 0, MAX_SNOWFLAKE_PAGINATION_PAGE * pageSize, 0);

    // A column the reader picked, over every page; with none, the view's rank. Only these expressions reach the SQL.
    const orderBy = buildHealthMetricsSortOrderBy(query.sort, orgSortColumns(), 'sort_rank ASC NULLS LAST, account_id ASC');

    const otherCte = `
      other AS (
        -- Each company's current memberships in other foundations: its highest tier and how many, for the sort.
        SELECT
          account_id,
          COALESCE(MAX(${healthMetricsTierRankSql('membership_tier')}), 0) AS other_top_tier_rank,
          COUNT(DISTINCT foundation_slug) AS other_membership_count
        FROM ${MEMBERSHIP_DIRECTORY_VIEW}
        -- The badges read skips a blank foundation too, so a company sorted as holding one never shows "—".
        WHERE foundation_slug <> ?
          AND foundation_slug <> ''
          AND account_id IS NOT NULL
          AND account_id <> ''
        GROUP BY account_id
      ),`;
    const otherColumns = sortsByMemberships
      ? 'o.other_top_tier_rank,\n          o.other_membership_count'
      : 'CAST(NULL AS NUMBER) AS other_top_tier_rank,\n          CAST(NULL AS NUMBER) AS other_membership_count';

    const sql = `
      WITH ${sortsByMemberships ? otherCte : ''}
      scoped AS (
        SELECT
          p.account_id,
          p.account_name,
          p.last_engaged_date,
          p.meetings_attended_count_${suffix} AS meetings_attended_count,
          p.distinct_people_count_${suffix} AS distinct_people_count,
          p.contributions_count_${suffix} AS contributions_count,
          p.sort_rank_${suffix} AS sort_rank,
          p.fit_band,
          -- High band among active rows: the set high_fit_org_count counts.
          COALESCE(p.fit_band = 'High', FALSE) AS is_high_fit,
          ${otherColumns}
        FROM ${NON_MEMBER_COMPANY_PARTICIPATION_VIEW} p
        ${sortsByMemberships ? 'LEFT JOIN other o ON o.account_id = p.account_id' : ''}
        WHERE p.foundation_slug = ?
          -- Rows the mapper cannot show must not count, or the totals and the page window drift apart.
          AND p.account_id IS NOT NULL
          AND p.account_id <> ''
          -- Active in the period: the scope the conversion model counts as tracked organizations.
          AND (COALESCE(p.meetings_attended_count_${suffix}, 0) > 0 OR COALESCE(p.contributions_count_${suffix}, 0) > 0)
      ),
      matched AS (
        SELECT * FROM scoped ${matchClause}
      ),
      totals AS (
        SELECT (SELECT COUNT(*) FROM scoped) AS scope_total, (SELECT COUNT(*) FROM matched) AS total_records
      ),
      page AS (
        -- The row's place in the page's order, which the outer select keeps after the logo join.
        SELECT *, TRUE AS is_page_row, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS page_position
        FROM matched
        -- account_id breaks any tie, and NULLS LAST pins placement against the session's null ordering.
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*, ${healthMetricsAccountLogoSql('logos')} AS logo_url
      FROM totals
      LEFT JOIN page ON TRUE
      ${healthMetricsAccountLogoJoinSql('logos', 'page.account_id')}
      ORDER BY page.page_position ASC NULLS LAST
    `;

    const result = await executeSnowflakeViewRead<OrgRow>(this.snowflakeService, req, sql, binds, {
      view: NON_MEMBER_COMPANY_PARTICIPATION_VIEW,
      operation: 'get_non_members_orgs',
      clientMessage: 'Company participation is unavailable right now.',
    });

    const first = result.rows[0];
    const rows = result.rows.filter((row) => row.IS_PAGE_ROW === true).flatMap(mapOrg);
    const memberships = await this.getOtherMemberships(
      req,
      query.foundationSlug,
      rows.map((row) => row.accountId)
    );
    return {
      rows: rows.map((row) => ({ ...row, otherMemberships: memberships.get(row.accountId) ?? [] })),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      scopeTotal: Number(first?.SCOPE_TOTAL ?? 0),
    };
  }

  /** One page of the period's engaged non-member individuals, in the view's rank or a column the reader picked. Never selects an email address. */
  public async getPeople(req: Request, query: HealthMetricsNonMembersPeopleQuery): Promise<HealthMetricsNonMembersPeople> {
    // The suffix comes from a constant keyed by the validated range, never from the request, so interpolating it is safe.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    const binds: string[] = [query.foundationSlug];

    let matchClause = '';
    if (query.search) {
      const pattern = `%${escapeSqlLikePattern(query.search)}%`;
      matchClause = "WHERE person_display_name ILIKE ? ESCAPE '!' OR account_name ILIKE ? ESCAPE '!'";
      binds.push(pattern, pattern);
    }

    const pageSize = clampInteger(query.pageSize, 1, HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_PAGE_SIZE, HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE);
    const offset = clampInteger(query.offset, 0, MAX_SNOWFLAKE_PAGINATION_PAGE * pageSize, 0);

    // A column the reader picked, over every page; with none, the view's rank. Only these expressions reach the SQL.
    const orderBy = buildHealthMetricsSortOrderBy(query.sort, personSortColumns(), 'sort_rank ASC NULLS LAST, person_key ASC');

    const sql = `
      WITH scoped AS (
        SELECT
          p.person_key,
          p.person_display_name,
          p.person_job_title,
          p.account_id,
          p.account_name,
          p.last_attended_date,
          p.meetings_attended_count_${suffix} AS meetings_attended_count,
          p.sort_rank_${suffix} AS sort_rank,
          p.scope_individuals_count_${suffix} AS scope_individuals_count
        FROM ${NON_MEMBER_PEOPLE_VIEW} p
        WHERE p.foundation_slug = ?
          -- Rows the mapper cannot show must not count, or the totals and the page window drift apart.
          AND p.person_key IS NOT NULL
          AND p.person_key <> ''
          -- The model scopes individuals to meeting attendees, the set scope_individuals_count counts.
          AND COALESCE(p.meetings_attended_count_${suffix}, 0) > 0
      ),
      matched AS (
        SELECT * FROM scoped ${matchClause}
      ),
      totals AS (
        SELECT
          -- The model's foundation-wide figure; zero only for an empty scope, so an unset figure stays NULL.
          (SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ANY_VALUE(scope_individuals_count) END FROM scoped) AS scope_total,
          (SELECT COUNT(*) FROM matched) AS total_records
      ),
      page AS (
        -- The row's place in the page's order, which the outer select keeps after the logo join.
        SELECT *, TRUE AS is_page_row, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS page_position
        FROM matched
        -- person_key breaks any tie, and NULLS LAST pins placement against the session's null ordering.
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*, ${healthMetricsAccountLogoSql('logos')} AS logo_url
      FROM totals
      LEFT JOIN page ON TRUE
      ${healthMetricsAccountLogoJoinSql('logos', 'page.account_id')}
      ORDER BY page.page_position ASC NULLS LAST
    `;

    const result = await executeSnowflakeViewRead<PersonRow>(this.snowflakeService, req, sql, binds, {
      view: NON_MEMBER_PEOPLE_VIEW,
      operation: 'get_non_members_people',
      clientMessage: 'People are unavailable right now.',
    });

    const first = result.rows[0];
    return {
      rows: result.rows.filter((row) => row.IS_PAGE_ROW === true && !!row.PERSON_KEY).map((row, index) => mapPerson(row, offset + index + 1)),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      scopeTotal: toNullableNumber(first?.SCOPE_TOTAL),
    };
  }

  /** The period's pipeline estimate, and its warmest companies: Company participation's top active companies, any fit band. */
  public async getConversion(req: Request, query: HealthMetricsNonMembersConversionQuery): Promise<HealthMetricsNonMembersConversion> {
    // The suffix comes from a constant keyed by the validated range, never from the request, so interpolating it is safe.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    const options = { operation: 'get_non_members_conversion', clientMessage: 'Conversion opportunity is unavailable right now.' };

    // One row per foundation; ordering by the model key still pins `LIMIT 1` should a duplicate appear.
    const summarySql = `
      SELECT
        high_fit_org_count_${suffix} AS high_fit_org_count,
        new_org_count_${suffix} AS new_org_count,
        estimated_pipeline_usd_${suffix} AS estimated_pipeline_usd
      FROM ${NON_MEMBER_CONVERSION_OPPORTUNITY_VIEW}
      WHERE foundation_slug = ?
      ORDER BY _key ASC
      LIMIT 1
    `;

    // The same active set and rank as Company participation (meetings, then contributions, then name), any fit band.
    const warmestSql = `
      WITH warmest AS (
        SELECT
          p.account_id,
          p.account_name,
          p.meetings_attended_count_${suffix} AS meetings_attended_count,
          p.contributions_count_${suffix} AS contributions_count,
          p.sort_rank_${suffix} AS sort_rank
        FROM ${NON_MEMBER_COMPANY_PARTICIPATION_VIEW} p
        WHERE p.foundation_slug = ?
          AND p.account_id IS NOT NULL
          AND p.account_id <> ''
          AND (COALESCE(p.meetings_attended_count_${suffix}, 0) > 0 OR COALESCE(p.contributions_count_${suffix}, 0) > 0)
        -- account_id breaks any tie.
        ORDER BY sort_rank ASC NULLS LAST, p.account_id ASC
        LIMIT ${HEALTH_METRICS_NON_MEMBERS_CONVERSION_WARMEST_LIMIT}
      )
      SELECT warmest.account_id, warmest.account_name, warmest.meetings_attended_count, warmest.contributions_count,
        ${healthMetricsAccountLogoSql('logos')} AS logo_url
      FROM warmest
      ${healthMetricsAccountLogoJoinSql('logos', 'warmest.account_id')}
      ORDER BY warmest.sort_rank ASC NULLS LAST, warmest.account_id ASC
    `;

    const [summary, warmest] = await Promise.all([
      executeSnowflakeViewRead<ConversionRow>(this.snowflakeService, req, summarySql, [query.foundationSlug], {
        ...options,
        view: NON_MEMBER_CONVERSION_OPPORTUNITY_VIEW,
      }),
      executeSnowflakeViewRead<WarmOrgRow>(this.snowflakeService, req, warmestSql, [query.foundationSlug], {
        ...options,
        view: NON_MEMBER_COMPANY_PARTICIPATION_VIEW,
      }),
    ]);

    const row = summary.rows[0];
    // No conversion row leaves the figures unset ("—"), while the warmest companies still show.
    return {
      ...HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED,
      ...(row && {
        measured: true,
        highFitCount: toNullableNumber(row.HIGH_FIT_ORG_COUNT),
        newCount: toNullableNumber(row.NEW_ORG_COUNT),
        estimatedPipelineUsd: toNullableNumber(row.ESTIMATED_PIPELINE_USD),
      }),
      warmest: warmest.rows.flatMap(mapWarmOrg),
    };
  }

  /**
   * The page's companies' current memberships in other foundations, keyed by account; read for those companies only, after
   * the page, which supplies them. A failed read shows no badges rather than taking the table down with it.
   */
  private async getOtherMemberships(
    req: Request,
    foundationSlug: string,
    accountIds: string[]
  ): Promise<Map<string, HealthMetricsNonMembersOtherMembership[]>> {
    const memberships = new Map<string, HealthMetricsNonMembersOtherMembership[]>();
    if (accountIds.length === 0) return memberships;

    // One bound placeholder per account; the list is the page, so it is never longer than the page size cap.
    const sql = `
      SELECT account_id, foundation_slug, foundation_name, membership_tier
      FROM ${MEMBERSHIP_DIRECTORY_VIEW}
      WHERE foundation_slug <> ?
        AND foundation_slug IS NOT NULL
        AND foundation_slug <> ''
        AND account_id IN (${accountIds.map(() => '?').join(', ')})
    `;

    let rows: OtherMembershipRow[];
    try {
      const result = await executeSnowflakeViewRead<OtherMembershipRow>(this.snowflakeService, req, sql, [foundationSlug, ...accountIds], {
        view: MEMBERSHIP_DIRECTORY_VIEW,
        operation: 'get_non_members_other_memberships',
        clientMessage: 'Other memberships are unavailable right now.',
      });
      rows = result.rows;
    } catch (error) {
      logger.warning(req, 'get_non_members_other_memberships', 'Other memberships unavailable, showing none', {
        foundation_slug: foundationSlug,
        account_count: accountIds.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return memberships;
    }

    for (const row of rows) {
      if (!row.ACCOUNT_ID || !row.FOUNDATION_SLUG) continue;
      const list = memberships.get(row.ACCOUNT_ID) ?? [];
      list.push({ foundationSlug: row.FOUNDATION_SLUG, foundationName: row.FOUNDATION_NAME || row.FOUNDATION_SLUG, tier: row.MEMBERSHIP_TIER || null });
      memberships.set(row.ACCOUNT_ID, list);
    }
    return memberships;
  }
}

function mapWarmOrg(row: WarmOrgRow): HealthMetricsNonMembersWarmOrg[] {
  if (!row.ACCOUNT_ID) return [];

  return [
    {
      accountId: row.ACCOUNT_ID,
      // Trimmed as the Company sort trims it, so a blank name shows the account id it sorts by.
      accountName: row.ACCOUNT_NAME?.trim() || row.ACCOUNT_ID,
      logoUrl: row.LOGO_URL || null,
      meetingsAttended: toNullableNumber(row.MEETINGS_ATTENDED_COUNT),
      contributions: toNullableNumber(row.CONTRIBUTIONS_COUNT),
    },
  ];
}

// Keyed by rank position: PERSON_KEY can hold an email address, so it orders the page but is never returned.
function mapPerson(row: PersonRow, position: number): HealthMetricsNonMembersPerson {
  return {
    rowKey: String(position),
    displayName: row.PERSON_DISPLAY_NAME || 'Unnamed individual',
    jobTitle: row.PERSON_JOB_TITLE || null,
    accountId: row.ACCOUNT_ID || null,
    accountName: row.ACCOUNT_NAME || null,
    logoUrl: row.LOGO_URL || null,
    lastAttendedDate: toIsoDate(row.LAST_ATTENDED_DATE),
    meetingsAttended: toNullableNumber(row.MEETINGS_ATTENDED_COUNT),
  };
}

function mapOrg(row: OrgRow): HealthMetricsNonMembersOrg[] {
  if (!row.ACCOUNT_ID) return [];

  return [
    {
      accountId: row.ACCOUNT_ID,
      // Trimmed as the Company sort trims it, so a blank name shows the account id it sorts by.
      accountName: row.ACCOUNT_NAME?.trim() || row.ACCOUNT_ID,
      logoUrl: row.LOGO_URL || null,
      lastEngagedDate: toIsoDate(row.LAST_ENGAGED_DATE),
      meetingsAttended: toNullableNumber(row.MEETINGS_ATTENDED_COUNT),
      distinctPeople: toNullableNumber(row.DISTINCT_PEOPLE_COUNT),
      contributions: toNullableNumber(row.CONTRIBUTIONS_COUNT),
      fitBand: row.FIT_BAND || null,
      otherMemberships: [],
    },
  ];
}

/** Each column as its cell shows it: a dashed count is empty, and Fit ranks the bands High first, unscored last. */
function orgSortColumns(): Record<HealthMetricsNonMembersOrgsSortKey, HealthMetricsSqlSortColumn> {
  const bands = HEALTH_METRICS_NON_MEMBERS_FIT_BANDS;
  return {
    // A company with no name, blank once trimmed as the cell trims it, shows its account id, so it sorts by that.
    company: { expression: `COALESCE(NULLIF(${healthMetricsTrimSql('account_name')}, ''), account_id)`, kind: 'text' },
    // The highest tier held, then how many (the rank leads by a factor no count reaches); none reads "—", so it is empty.
    memberships: { expression: 'IFF(other_membership_count > 0, other_top_tier_rank * 1000 + other_membership_count, NULL)', kind: 'number' },
    meetings: { expression: 'NULLIF(meetings_attended_count, 0)', kind: 'number' },
    contributions: { expression: 'NULLIF(contributions_count, 0)', kind: 'number' },
    // The bands are constants, never request input.
    fit: { expression: `CASE TRIM(fit_band) ${bands.map((band, index) => `WHEN '${band}' THEN ${bands.length - index}`).join(' ')} END`, kind: 'number' },
  };
}

/** Each column as its cell shows it: no name reads "Unnamed individual", and a person with no company reads "—". */
function personSortColumns(): Record<HealthMetricsNonMembersPeopleSortKey, HealthMetricsSqlSortColumn> {
  return {
    person: { expression: "COALESCE(NULLIF(person_display_name, ''), 'Unnamed individual')", kind: 'text' },
    // Trimmed as the cell trims it: a blank name shows the account id, so it sorts by that.
    company: { expression: `COALESCE(NULLIF(${healthMetricsTrimSql('account_name')}, ''), account_id)`, kind: 'text' },
    meetings: { expression: 'NULLIF(meetings_attended_count, 0)', kind: 'number' },
    lastAttended: { expression: 'last_attended_date', kind: 'date' },
  };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
