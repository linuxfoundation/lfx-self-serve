// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX,
  HEALTH_METRICS_NON_MEMBERS_ORGS_MAX_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_ORGS_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_MAX_PAGE_SIZE,
  HEALTH_METRICS_NON_MEMBERS_PEOPLE_PAGE_SIZE,
  MAX_SNOWFLAKE_PAGINATION_PAGE,
} from '@lfx-one/shared/constants';

import { toIsoDate } from '../helpers/date-format.helper';
import { isHealthMetricsL2Range } from '../helpers/health-metrics-l2.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { clampInteger, escapeSqlLikePattern } from '../helpers/validation.helper';
import { SnowflakeService } from './snowflake.service';

import type {
  HealthMetricsL2Range,
  HealthMetricsNonMembersOrg,
  HealthMetricsNonMembersOrgs,
  HealthMetricsNonMembersOrgsQuery,
  HealthMetricsNonMembersPeople,
  HealthMetricsNonMembersPeopleQuery,
  HealthMetricsNonMembersPerson,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const NON_MEMBER_COMPANY_PARTICIPATION_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_COMPANY_PARTICIPATION';
const NON_MEMBER_FIT_SCORE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_FIT_SCORE';
const NON_MEMBER_PEOPLE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.NON_MEMBER_PEOPLE';

interface OrgRow {
  SCOPE_TOTAL: number | null;
  TOTAL_RECORDS: number | null;
  NEW_COUNT: number | null;
  IS_PAGE_ROW: boolean | null;
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  LAST_ENGAGED_DATE: Date | string | null;
  MEETINGS_ATTENDED_COUNT: number | null;
  DISTINCT_PEOPLE_COUNT: number | null;
  CONTRIBUTIONS_COUNT: number | null;
  IS_NEW: boolean | null;
  SORT_RANK: number | null;
  IS_HIGH_FIT: boolean | null;
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

  /** One page of the period's active non-member organizations, in the view's meetings-first rank. */
  public async getOrgs(req: Request, query: HealthMetricsNonMembersOrgsQuery): Promise<HealthMetricsNonMembersOrgs> {
    // The suffix comes from a constant keyed by the validated range, never from the request, so interpolating it is safe.
    const suffix = HEALTH_METRICS_L2_RANGE_COLUMN_SUFFIX[query.range];
    const binds: string[] = [query.foundationSlug];

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

    const sql = `
      WITH scoped AS (
        SELECT
          p.account_id,
          p.account_name,
          p.last_engaged_date,
          p.meetings_attended_count_${suffix} AS meetings_attended_count,
          p.distinct_people_count_${suffix} AS distinct_people_count,
          p.contributions_count_${suffix} AS contributions_count,
          p.is_new_${suffix} AS is_new,
          p.sort_rank_${suffix} AS sort_rank,
          COALESCE(f.is_high_fit_${suffix}, FALSE) AS is_high_fit
        FROM ${NON_MEMBER_COMPANY_PARTICIPATION_VIEW} p
        LEFT JOIN ${NON_MEMBER_FIT_SCORE_VIEW} f
          ON f.foundation_slug = p.foundation_slug
          AND f.account_id = p.account_id
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
        SELECT
          (SELECT COUNT(*) FROM scoped) AS scope_total,
          (SELECT COUNT_IF(is_new) FROM scoped) AS new_count,
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

    const result = await executeSnowflakeViewRead<OrgRow>(this.snowflakeService, req, sql, binds, {
      view: NON_MEMBER_COMPANY_PARTICIPATION_VIEW,
      operation: 'get_non_members_orgs',
      clientMessage: 'Company participation is unavailable right now.',
    });

    const first = result.rows[0];
    return {
      rows: result.rows.filter((row) => row.IS_PAGE_ROW === true).flatMap(mapOrg),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      scopeTotal: Number(first?.SCOPE_TOTAL ?? 0),
      newCount: Number(first?.NEW_COUNT ?? 0),
    };
  }

  /** One page of the period's engaged non-member individuals, in the view's rank. Never selects an email address. */
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
          p.sort_rank_${suffix} AS sort_rank
        FROM ${NON_MEMBER_PEOPLE_VIEW} p
        WHERE p.foundation_slug = ?
          -- Rows the mapper cannot show must not count, or the totals and the page window drift apart.
          AND p.person_key IS NOT NULL
          AND p.person_key <> ''
          AND COALESCE(p.meetings_attended_count_${suffix}, 0) > 0
      ),
      matched AS (
        SELECT * FROM scoped ${matchClause}
      ),
      totals AS (
        SELECT
          (SELECT COUNT(*) FROM scoped) AS scope_total,
          (SELECT COUNT(*) FROM matched) AS total_records
      ),
      page AS (
        SELECT *, TRUE AS is_page_row
        FROM matched
        -- person_key breaks any tie, and NULLS LAST pins placement against the session's null ordering.
        ORDER BY sort_rank ASC NULLS LAST, person_key ASC
        LIMIT ${pageSize} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.person_key ASC
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
      scopeTotal: Number(first?.SCOPE_TOTAL ?? 0),
    };
  }
}

// Keyed by rank position: PERSON_KEY can hold an email address, so it orders the page but is never returned.
function mapPerson(row: PersonRow, position: number): HealthMetricsNonMembersPerson {
  return {
    rowKey: String(position),
    displayName: row.PERSON_DISPLAY_NAME || 'Unnamed individual',
    jobTitle: row.PERSON_JOB_TITLE || null,
    accountId: row.ACCOUNT_ID || null,
    accountName: row.ACCOUNT_NAME || null,
    lastAttendedDate: toIsoDate(row.LAST_ATTENDED_DATE),
    meetingsAttended: toNullableNumber(row.MEETINGS_ATTENDED_COUNT),
  };
}

function mapOrg(row: OrgRow): HealthMetricsNonMembersOrg[] {
  if (!row.ACCOUNT_ID) return [];

  return [
    {
      accountId: row.ACCOUNT_ID,
      accountName: row.ACCOUNT_NAME || row.ACCOUNT_ID,
      lastEngagedDate: toIsoDate(row.LAST_ENGAGED_DATE),
      meetingsAttended: toNullableNumber(row.MEETINGS_ATTENDED_COUNT),
      distinctPeople: toNullableNumber(row.DISTINCT_PEOPLE_COUNT),
      contributions: toNullableNumber(row.CONTRIBUTIONS_COUNT),
      isNew: row.IS_NEW === true,
    },
  ];
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
