// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_RANGES,
} from '@lfx-one/shared/constants';
import type {
  HealthMetricsEngagementGroupAttendance,
  HealthMetricsEngagementGroupPeriod,
  HealthMetricsEngagementGroupQuery,
  HealthMetricsEngagementGroupRow,
  HealthMetricsRange,
} from '@lfx-one/shared/interfaces';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type { Request } from 'express';
import type { Bind } from 'snowflake-sdk';

const GROUP_ATTENDANCE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_GROUP_ATTENDANCE';

/**
 * Column suffix per period. The view carries no `COMPLETED_YEAR_4` columns, so that range is
 * rejected at the controller rather than silently resolving to a different year.
 */
const RANGE_COLUMN_SUFFIX: Partial<Record<HealthMetricsRange, string>> = {
  YTD: 'ytd',
  COMPLETED_YEAR: 'last_completed_year',
  COMPLETED_YEAR_2: 'prev_completed_year',
  COMPLETED_YEAR_3: '3rd_last_completed_year',
};

/** True when this service can serve the range — the controller uses it to validate before binding. */
export function isSupportedEngagementRange(range: string): range is HealthMetricsRange {
  return Object.prototype.hasOwnProperty.call(RANGE_COLUMN_SUFFIX, range);
}

interface GroupAttendanceRow {
  COMMITTEE_ID: string | null;
  COMMITTEE_NAME: string | null;
  PROJECT_SLUG: string | null;
  PROJECT_NAME: string | null;
  GROUP_TYPE_LABEL: string | null;
  LAST_MET_DATE: Date | string | null;
  TOTAL_RECORDS: number | null;
  DORMANT_GROUPS: number | null;
  IS_PAGE_ROW: boolean | null;
  [periodColumn: string]: unknown;
}

export class HealthMetricsEngagementService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * One page of Group attendance. The view precomputes `SORT_RANK_<period>` (dormant first, then
   * ascending attendance), so the product's ranking is applied in SQL and survives pagination —
   * sorting a single page client-side would rank only that page.
   */
  public async getGroupAttendance(req: Request, query: HealthMetricsEngagementGroupQuery): Promise<HealthMetricsEngagementGroupAttendance> {
    const suffix = RANGE_COLUMN_SUFFIX[query.range];
    if (!suffix) {
      return HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT;
    }

    const binds: Bind[] = [query.foundationSlug];

    let projectPredicate = '';
    if (query.projectSlug) {
      projectPredicate = 'AND project_slug = ?';
      binds.push(query.projectSlug);
    }

    // Each committee row belongs to exactly one project, so all-projects scope drops the predicate
    // rather than selecting a denormalized roll-up row — this view has no `is_all_projects`.
    let typePredicate = '';
    const typeLabels = HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS[query.groupType];
    if (typeLabels?.length) {
      typePredicate = `AND group_type_label IN (${typeLabels.map(() => '?').join(', ')})`;
      binds.push(...typeLabels);
    }

    const size = clampInteger(query.size, 1, 100, 25);
    const offset = (clampInteger(query.page, 1, 10_000, 1) - 1) * size;
    const periodColumns = HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => periodSelectList(RANGE_COLUMN_SUFFIX[range] as string)).join(',\n        ');

    // The totals are a separate aggregate joined onto the page, not a window over it: read as
    // `COUNT(*) OVER()` off the first row they vanish whenever the page is empty, so an out-of-range
    // page would report a foundation with zero groups and collapse the table into its empty state.
    const sql = `
      WITH scoped AS (
        SELECT *
        FROM ${GROUP_ATTENDANCE_VIEW}
        WHERE foundation_slug = ?
          ${projectPredicate}
          ${typePredicate}
      ),
      totals AS (
        SELECT
          COUNT(*) AS total_records,
          -- The view's own dormancy flag. Any further metric definition belongs in dbt, not here.
          SUM(CASE WHEN is_dormant_${suffix} THEN 1 ELSE 0 END) AS dormant_groups
        FROM scoped
      ),
      page AS (
        SELECT
          committee_id,
          committee_name,
          project_slug,
          project_name,
          last_met_date,
          group_type_label,
          ${periodColumns},
          sort_rank_${suffix} AS sort_rank,
          -- Distinguishes a real page row from the totals-only row the LEFT JOIN keeps below.
          -- committee_id cannot serve: it is nullable, so a null-id group would be dropped silently.
          TRUE AS is_page_row
        FROM scoped
        -- committee_id breaks the remaining tie so paging cannot repeat or skip same-named groups.
        -- Both are nullable, and NULLS LAST pins their placement: the session's DEFAULT_NULL_ORDERING
        -- would otherwise let a pooled connection drift a null-named group between pages.
        ORDER BY sort_rank_${suffix} ASC NULLS LAST, committee_name ASC NULLS LAST, committee_id ASC NULLS LAST
        LIMIT ${size} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.committee_name ASC NULLS LAST, page.committee_id ASC NULLS LAST
    `;

    // `expectMissingObject` still rejects — it only keeps a missing view or absent GRANT out of the
    // shared circuit breaker, which five of these reads would otherwise open for every other
    // Snowflake dashboard. The 500 reaches `apiErrorHandler`, so the fault is still error telemetry.
    const result = await this.snowflakeService.execute<GroupAttendanceRow>(sql, binds, { expectMissingObject: true });

    logger.debug(req, 'get_engagement_group_attendance', 'Fetched group attendance page', {
      foundation_slug: query.foundationSlug,
      project_slug: query.projectSlug,
      group_type: query.groupType,
      range: query.range,
      row_count: result.rows.length,
    });

    const first = result.rows[0];
    // A page past the end still returns one row — the totals, with every page column null.
    const pageRows = result.rows.filter((row) => row.IS_PAGE_ROW === true);

    return {
      rows: pageRows.map(mapGroupRow),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      counts: {
        groups: Number(first?.TOTAL_RECORDS ?? 0),
        dormantGroups: Number(first?.DORMANT_GROUPS ?? 0),
      },
    };
  }
}

function periodSelectList(suffix: string): string {
  return ['meetings_count', 'invited_count', 'attended_count', 'attendance_pct', 'is_dormant'].map((column) => `${column}_${suffix}`).join(', ');
}

function mapGroupRow(row: GroupAttendanceRow): HealthMetricsEngagementGroupRow {
  return {
    committeeId: row.COMMITTEE_ID ?? '',
    committeeName: row.COMMITTEE_NAME ?? '',
    projectSlug: row.PROJECT_SLUG,
    projectName: row.PROJECT_NAME,
    groupTypeLabel: row.GROUP_TYPE_LABEL,
    lastMetDate: toIsoDate(row.LAST_MET_DATE),
    periods: HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => mapGroupPeriod(row, range)),
  };
}

function mapGroupPeriod(row: GroupAttendanceRow, range: HealthMetricsRange): HealthMetricsEngagementGroupPeriod {
  const suffix = (RANGE_COLUMN_SUFFIX[range] as string).toUpperCase();
  const attendance = row[`ATTENDANCE_PCT_${suffix}`];

  return {
    range,
    meetingsHeld: Number(row[`MEETINGS_COUNT_${suffix}`] ?? 0),
    invitedCount: Number(row[`INVITED_COUNT_${suffix}`] ?? 0),
    attendedCount: Number(row[`ATTENDED_COUNT_${suffix}`] ?? 0),
    // A null share means nobody was invited at all, which the table renders as an em dash — keep it
    // distinct from a real 0%.
    attendancePct: attendance === null || attendance === undefined ? null : Number(attendance),
    dormant: row[`IS_DORMANT_${suffix}`] === true,
  };
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;

  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;

  return Math.min(Math.max(Math.trunc(value), min), max);
}
