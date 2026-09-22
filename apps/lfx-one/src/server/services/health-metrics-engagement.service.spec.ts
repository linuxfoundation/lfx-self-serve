// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { execute, isMissingObjectError, warning } = vi.hoisted(() => ({
  execute: vi.fn(),
  isMissingObjectError: vi.fn(() => false),
  warning: vi.fn(),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static isMissingObjectError = isMissingObjectError;
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning, error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT } from '@lfx-one/shared/constants';

import { HealthMetricsEngagementService, isSupportedEngagementRange } from './health-metrics-engagement.service';

import type { HealthMetricsEngagementGroupQuery } from '@lfx-one/shared/interfaces';

function query(overrides: Partial<HealthMetricsEngagementGroupQuery> = {}): HealthMetricsEngagementGroupQuery {
  return { foundationSlug: 'acme', projectSlug: null, groupType: 'all', range: 'YTD', page: 1, size: 25, ...overrides };
}

/** One warehouse row, every period column populated so the four-period mapping is exercised. */
function warehouseRow(overrides: Record<string, unknown> = {}) {
  return {
    COMMITTEE_ID: 'c-1',
    COMMITTEE_NAME: 'Technical Steering Committee',
    PROJECT_SLUG: 'acme-core',
    PROJECT_NAME: 'Acme Core',
    GROUP_TYPE_LABEL: 'Technical Steering Committee',
    LAST_MET_DATE: new Date('2026-08-14T00:00:00.000Z'),
    TOTAL_RECORDS: 34,
    DORMANT_GROUPS: 3,
    LOW_ATTENDANCE_GROUPS: 5,
    MEETINGS_COUNT_3RD_LAST_COMPLETED_YEAR: 10,
    INVITED_COUNT_3RD_LAST_COMPLETED_YEAR: 100,
    ATTENDED_COUNT_3RD_LAST_COMPLETED_YEAR: 54,
    ATTENDANCE_PCT_3RD_LAST_COMPLETED_YEAR: 0.54,
    IS_DORMANT_3RD_LAST_COMPLETED_YEAR: false,
    MEETINGS_COUNT_PREV_COMPLETED_YEAR: 11,
    INVITED_COUNT_PREV_COMPLETED_YEAR: 110,
    ATTENDED_COUNT_PREV_COMPLETED_YEAR: 64,
    ATTENDANCE_PCT_PREV_COMPLETED_YEAR: 0.58,
    IS_DORMANT_PREV_COMPLETED_YEAR: false,
    MEETINGS_COUNT_LAST_COMPLETED_YEAR: 12,
    INVITED_COUNT_LAST_COMPLETED_YEAR: 120,
    ATTENDED_COUNT_LAST_COMPLETED_YEAR: 71,
    ATTENDANCE_PCT_LAST_COMPLETED_YEAR: 0.59,
    IS_DORMANT_LAST_COMPLETED_YEAR: false,
    MEETINGS_COUNT_YTD: 8,
    INVITED_COUNT_YTD: 80,
    ATTENDED_COUNT_YTD: 50,
    ATTENDANCE_PCT_YTD: 0.62,
    IS_DORMANT_YTD: false,
    ...overrides,
  };
}

/** Last call's SQL with runs of whitespace collapsed, so assertions read like the query does. */
function lastSql(): string {
  return String(execute.mock.calls.at(-1)?.[0]).replace(/\s+/g, ' ').trim();
}

function lastBinds(): unknown[] {
  return execute.mock.calls.at(-1)?.[1] as unknown[];
}

describe('HealthMetricsEngagementService', () => {
  const service = new HealthMetricsEngagementService();

  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [warehouseRow()] });
    isMissingObjectError.mockReset();
    isMissingObjectError.mockReturnValue(false);
    warning.mockReset();
  });

  it('maps every period onto the row, oldest first, so the sparkline needs no second read', async () => {
    const response = await service.getGroupAttendance(query());

    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]?.committeeId).toBe('c-1');
    expect(response.rows[0]?.lastMetDate).toBe('2026-08-14');
    expect(response.rows[0]?.periods.map((period) => period.range)).toEqual(['COMPLETED_YEAR_3', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR', 'YTD']);
    expect(response.rows[0]?.periods.map((period) => period.attendancePct)).toEqual([0.54, 0.58, 0.59, 0.62]);
    expect(response.rows[0]?.periods[3]).toMatchObject({ meetingsHeld: 8, invitedCount: 80, attendedCount: 50, dormant: false });
  });

  it('keeps a null attendance null rather than folding it into a real zero', async () => {
    execute.mockResolvedValue({ rows: [warehouseRow({ ATTENDANCE_PCT_YTD: null, INVITED_COUNT_YTD: 0, IS_DORMANT_YTD: true })] });

    const response = await service.getGroupAttendance(query());

    expect(response.rows[0]?.periods[3]).toMatchObject({ attendancePct: null, dormant: true });
  });

  it('reads the window aggregates off the first row, so the counts cover the whole filtered set', async () => {
    const response = await service.getGroupAttendance(query());

    expect(response.totalRecords).toBe(34);
    expect(response.counts).toEqual({ groups: 34, dormantGroups: 3, lowAttendanceGroups: 5 });
  });

  it('reports zeroed counts for an empty page instead of reading an absent first row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const response = await service.getGroupAttendance(query());

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
  });

  it('selects, ranks and aggregates on the requested period suffix', async () => {
    await service.getGroupAttendance(query({ range: 'COMPLETED_YEAR_2' }));

    const sql = lastSql();
    expect(sql).toContain('ORDER BY sort_rank_prev_completed_year ASC NULLS LAST, committee_name ASC');
    expect(sql).toContain('SUM(CASE WHEN is_dormant_prev_completed_year THEN 1 ELSE 0 END) OVER() AS dormant_groups');
    expect(sql).toContain('attendance_pct_prev_completed_year <');
    // Every period's columns ship regardless of the selected one — the sparkline spans all four.
    expect(sql).toContain('attendance_pct_ytd');
    expect(sql).toContain('attendance_pct_3rd_last_completed_year');
  });

  it('binds the low-attendance thresholds ahead of the foundation, and drops the project predicate in all-projects scope', async () => {
    await service.getGroupAttendance(query());

    expect(lastBinds()).toEqual([0.5, 3, 'acme']);
    expect(lastSql()).not.toContain('project_slug = ?');
  });

  it('binds a project slug and every type label of the selected cut', async () => {
    await service.getGroupAttendance(query({ projectSlug: 'acme-core', groupType: 'wg' }));

    expect(lastBinds()).toEqual([0.5, 3, 'acme', 'acme-core', 'Working Group']);
    expect(lastSql()).toContain('AND project_slug = ? AND group_type_label IN (?)');
  });

  it('adds no type predicate for the all-types cut, which has no label list', async () => {
    await service.getGroupAttendance(query({ groupType: 'all' }));

    expect(lastSql()).not.toContain('group_type_label IN');
  });

  it('interpolates page and size only after clamping them to a safe integer range', async () => {
    await service.getGroupAttendance(query({ page: 3, size: 25 }));
    expect(lastSql()).toContain('LIMIT 25 OFFSET 50');

    // A hostile or malformed page/size can never reach the SQL — these are interpolated, not bound.
    await service.getGroupAttendance(query({ page: Number.NaN, size: 5000 }));
    expect(lastSql()).toContain('LIMIT 100 OFFSET 0');
  });

  it('returns the default response for a range the view has no columns for', async () => {
    const response = await service.getGroupAttendance(query({ range: 'COMPLETED_YEAR_4' }));

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
    expect(execute).not.toHaveBeenCalled();
  });

  it('degrades to an empty section when the view is missing or unauthorized', async () => {
    execute.mockRejectedValue(new Error('Object does not exist'));
    isMissingObjectError.mockReturnValue(true);

    const response = await service.getGroupAttendance(query());

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
    expect(warning).toHaveBeenCalled();
  });

  it('rethrows any other Snowflake failure rather than reporting an empty foundation', async () => {
    execute.mockRejectedValue(new Error('connection reset'));

    await expect(service.getGroupAttendance(query())).rejects.toThrow('connection reset');
    expect(warning).not.toHaveBeenCalled();
  });
});

describe('isSupportedEngagementRange', () => {
  it('accepts the four periods the view carries and rejects the fourth completed year', () => {
    expect(['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'].every(isSupportedEngagementRange)).toBe(true);
    expect(isSupportedEngagementRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedEngagementRange('toString')).toBe(false);
  });
});
