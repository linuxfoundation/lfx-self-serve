// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
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
  LOW_ATTENDANCE_GROUPS: number | null;
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

    // Scope binds come first because the scoped CTE below is the first `?` in the statement.
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

    binds.push(HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD, HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE);

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
          SUM(CASE WHEN is_dormant_${suffix} THEN 1 ELSE 0 END) AS dormant_groups,
          SUM(
            CASE
              WHEN NOT COALESCE(is_dormant_${suffix}, FALSE)
                AND attendance_pct_${suffix} IS NOT NULL
                AND attendance_pct_${suffix} < ?
                AND COALESCE(meetings_count_${suffix}, 0) >= ?
              THEN 1 ELSE 0
            END
          ) AS low_attendance_groups
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
          sort_rank_${suffix} AS sort_rank
        FROM scoped
        -- committee_id breaks the remaining tie so paging cannot repeat or skip same-named groups.
        ORDER BY sort_rank_${suffix} ASC NULLS LAST, committee_name ASC, committee_id ASC
        LIMIT ${size} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.committee_name ASC, page.committee_id ASC
    `;

    let result;
    try {
      result = await this.snowflakeService.execute<GroupAttendanceRow>(sql, binds, { expectMissingObject: true });
    } catch (error) {
      // Also matches a missing GRANT, not just a missing view — `err` disambiguates the two.
      if (!SnowflakeService.isMissingObjectError(error)) throw error;
      logger.warning(req, 'get_engagement_group_attendance', 'Group attendance query hit a missing-object/not-authorized error; returning default response', {
        foundation_slug: query.foundationSlug,
        err: error,
      });
      return HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT;
    }

    logger.debug(req, 'get_engagement_group_attendance', 'Fetched group attendance page', {
      foundation_slug: query.foundationSlug,
      project_slug: query.projectSlug,
      group_type: query.groupType,
      range: query.range,
      row_count: result.rows.length,
    });

    const first = result.rows[0];
    // A page past the end still returns one row — the totals, with every page column null.
    const pageRows = result.rows.filter((row) => row.COMMITTEE_ID !== null && row.COMMITTEE_ID !== undefined);

    return {
      rows: pageRows.map(mapGroupRow),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      counts: {
        groups: Number(first?.TOTAL_RECORDS ?? 0),
        dormantGroups: Number(first?.DORMANT_GROUPS ?? 0),
        lowAttendanceGroups: Number(first?.LOW_ATTENDANCE_GROUPS ?? 0),
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
