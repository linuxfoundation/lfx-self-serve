// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { execute, isMissingObjectError, warning, loggerError } = vi.hoisted(() => ({
  execute: vi.fn(),
  isMissingObjectError: vi.fn(() => false),
  warning: vi.fn(),
  loggerError: vi.fn(),
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
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning, error: loggerError, debug: vi.fn(), info: vi.fn() },
}));

import {
  HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_ORG_PARTICIPATION_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP,
} from '@lfx-one/shared/constants';

import { MicroserviceError } from '../errors/microservice.error';

import { HealthMetricsEngagementService, isSupportedEngagementRange } from './health-metrics-engagement.service';

import type { Request } from 'express';
import type { HealthMetricsEngagementGroupQuery } from '@lfx-one/shared/interfaces';

function query(overrides: Partial<HealthMetricsEngagementGroupQuery> = {}): HealthMetricsEngagementGroupQuery {
  return { foundationSlug: 'acme', projectSlug: null, groupType: 'all', range: 'YTD', page: 1, size: 25, ...overrides };
}

/** The logger only reads request metadata off this, so a bare cast is enough for the service call. */
const req = {} as Request;

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
    IS_PAGE_ROW: true,
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
    loggerError.mockReset();
  });

  it('maps every period onto the row, oldest first, so the sparkline needs no second read', async () => {
    const response = await service.getGroupAttendance(req, query());

    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]?.committeeId).toBe('c-1');
    expect(response.rows[0]?.lastMetDate).toBe('2026-08-14');
    expect(response.rows[0]?.periods.map((period) => period.range)).toEqual(['COMPLETED_YEAR_3', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR', 'YTD']);
    expect(response.rows[0]?.periods.map((period) => period.attendancePct)).toEqual([0.54, 0.58, 0.59, 0.62]);
    expect(response.rows[0]?.periods[3]).toMatchObject({ meetingsHeld: 8, invitedCount: 80, attendedCount: 50, dormant: false });
  });

  it('keeps a null attendance null rather than folding it into a real zero', async () => {
    execute.mockResolvedValue({ rows: [warehouseRow({ ATTENDANCE_PCT_YTD: null, INVITED_COUNT_YTD: 0, IS_DORMANT_YTD: true })] });

    const response = await service.getGroupAttendance(req, query());

    expect(response.rows[0]?.periods[3]).toMatchObject({ attendancePct: null, dormant: true });
  });

  it('reads the joined totals off the first row, so the counts cover the whole filtered set', async () => {
    const response = await service.getGroupAttendance(req, query());

    expect(response.totalRecords).toBe(34);
    expect(response.counts).toEqual({ groups: 34, dormantGroups: 3 });
  });

  it('reports zeroed counts for an empty page instead of reading an absent first row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const response = await service.getGroupAttendance(req, query());

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
  });

  // The totals join keeps one row when the page selects nothing, so a page past the end still
  // reports the real totals instead of collapsing the section into its empty state.
  it('keeps the totals for a page past the end of the filtered set', async () => {
    const totalsOnly = Object.fromEntries(
      Object.entries(warehouseRow()).map(([column, value]) => [column, ['TOTAL_RECORDS', 'DORMANT_GROUPS'].includes(column) ? value : null])
    );
    execute.mockResolvedValue({ rows: [totalsOnly] });

    const response = await service.getGroupAttendance(req, query({ page: 9 }));

    expect(response.rows).toEqual([]);
    expect(response.totalRecords).toBe(34);
    expect(response.counts).toEqual({ groups: 34, dormantGroups: 3 });
  });

  // The totals-filler row is identified by the marker column, so a group whose committee_id is null
  // stays on the page instead of being dropped while still counting toward totalRecords.
  it('keeps a page row whose committee id is null', async () => {
    execute.mockResolvedValue({ rows: [warehouseRow({ COMMITTEE_ID: null })] });

    const response = await service.getGroupAttendance(req, query());

    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]?.committeeId).toBe('');
    expect(response.totalRecords).toBe(34);
  });

  it('selects, ranks and aggregates on the requested period suffix', async () => {
    await service.getGroupAttendance(req, query({ range: 'COMPLETED_YEAR_2' }));

    const sql = lastSql();
    // The whole tie-breaker chain, and NULLS LAST on every key: the session default ordering would
    // otherwise let a pooled connection drift a null row between pages.
    expect(sql).toContain(
      'ORDER BY sort_rank_prev_completed_year ASC NULLS LAST, committee_name ASC NULLS LAST, committee_id ASC NULLS LAST, project_slug ASC NULLS LAST, group_type_label ASC NULLS LAST'
    );
    expect(sql).toContain('SUM(CASE WHEN is_dormant_prev_completed_year THEN 1 ELSE 0 END) AS dormant_groups');
    // Totals come from an aggregate over the scoped set joined onto the page, never a window over it.
    expect(sql).toContain('LEFT JOIN page ON TRUE');
    expect(sql).toContain('TRUE AS is_page_row');
    expect(sql).not.toContain('OVER()');
    // Every period's columns ship regardless of the selected one — the sparkline spans all four.
    expect(sql).toContain('attendance_pct_ytd');
    expect(sql).toContain('attendance_pct_3rd_last_completed_year');
  });

  it('binds only the scope, and drops the project predicate in all-projects scope', async () => {
    await service.getGroupAttendance(req, query());

    expect(lastBinds()).toEqual(['acme']);
    expect(lastSql()).not.toContain('project_slug = ?');
  });

  it('binds a project slug and every type label of the selected cut', async () => {
    await service.getGroupAttendance(req, query({ projectSlug: 'acme-core', groupType: 'wg' }));

    // 'Working groups' is the label the view emits; the cut binds that, not the committee category.
    expect(lastBinds()).toEqual(['acme', 'acme-core', 'Working groups']);
    expect(lastSql()).toContain('AND project_slug = ? AND group_type_label IN (?)');
  });

  it('adds no type predicate for the all-types cut, which has no label list', async () => {
    await service.getGroupAttendance(req, query({ groupType: 'all' }));

    expect(lastSql()).not.toContain('group_type_label IN');
  });

  it('interpolates page and size only after clamping them to a safe integer range', async () => {
    await service.getGroupAttendance(req, query({ page: 3, size: 25 }));
    expect(lastSql()).toContain('LIMIT 25 OFFSET 50');

    // A hostile or malformed page/size can never reach the SQL — these are interpolated, not bound.
    await service.getGroupAttendance(req, query({ page: Number.NaN, size: 5000 }));
    expect(lastSql()).toContain('LIMIT 100 OFFSET 0');
  });

  it('returns the default response for a range the view has no columns for', async () => {
    const response = await service.getGroupAttendance(req, query({ range: 'COMPLETED_YEAR_4' }));

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT);
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates a missing or unauthorized view rather than reporting no groups', async () => {
    execute.mockRejectedValue(new Error('Object does not exist'));
    isMissingObjectError.mockReturnValue(true);

    // `expectMissingObject` keeps the fault out of the shared circuit breaker without defaulting:
    // the zero-filled response would render the same empty state as a foundation that has none.
    await expect(service.getGroupAttendance(req, query())).rejects.toThrow('Object does not exist');
    expect(execute.mock.calls[0][2]).toEqual({ expectMissingObject: true });
    expect(warning).not.toHaveBeenCalled();
  });

  // The SDK names the fully-qualified view in its message, and the handler sends a bare
  // `BaseApiError`'s message to the client.
  it('keeps the warehouse object name out of the client response', async () => {
    // Thrown the way `SnowflakeService` throws it: a provider name and a vendor code to drop.
    execute.mockRejectedValue(
      new MicroserviceError("Object 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_GROUP_ATTENDANCE' does not exist", 500, 'SNOWFLAKE_QUERY_ERROR', {
        operation: 'snowflake_execute',
        service: 'snowflake',
      })
    );
    isMissingObjectError.mockReturnValue(true);

    const error = (await service.getGroupAttendance(req, query()).catch((thrown: unknown) => thrown)) as MicroserviceError;

    expect(error.toResponse()['error']).toBe('Group attendance is unavailable right now.');
    // The raw text is what the log line records, so it must survive the wrap.
    expect(error.message).toContain('ENGAGEMENT_GROUP_ATTENDANCE');
    expect(error.statusCode).toBe(500);
    // A provider name and its vendor error code would put the warehouse back in the response.
    expect(error.toResponse()).not.toHaveProperty('service');
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  // The breaker treats this as expected and logs it at `warning`, but the same SDK message covers a
  // revoked GRANT — an access-control event that has to be alertable on its own.
  it('records an alertable error for a view that is missing or no longer granted', async () => {
    execute.mockRejectedValue(new Error('Object does not exist or not authorized'));
    isMissingObjectError.mockReturnValue(true);

    await expect(service.getGroupAttendance(req, query())).rejects.toThrow('not authorized');
    // Its own operation key, so the controller's entry survives for `apiErrorHandler`.
    expect(loggerError).toHaveBeenCalledWith(req, 'get_engagement_group_attendance_missing_object', expect.any(Number), expect.any(Error), {
      snowflake_expected_missing_object: 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_GROUP_ATTENDANCE',
    });
  });

  it('leaves an ordinary Snowflake failure out of the missing-object signal', async () => {
    execute.mockRejectedValue(new Error('connection reset'));

    await expect(service.getGroupAttendance(req, query())).rejects.toThrow('connection reset');
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('leaves an error that already carries a client message alone', async () => {
    execute.mockRejectedValue(new MicroserviceError('upstream said no', 503, 'SERVICE_UNAVAILABLE', { clientMessage: 'Try again shortly.' }));

    const error = (await service.getGroupAttendance(req, query()).catch((thrown: unknown) => thrown)) as MicroserviceError;

    expect(error.toResponse()['error']).toBe('Try again shortly.');
  });

  it('rethrows any other Snowflake failure rather than reporting an empty foundation', async () => {
    execute.mockRejectedValue(new Error('connection reset'));

    await expect(service.getGroupAttendance(req, query())).rejects.toThrow('connection reset');
    expect(warning).not.toHaveBeenCalled();
  });
});

describe('HealthMetricsEngagementService.getMeetingParticipation', () => {
  const service = new HealthMetricsEngagementService();

  /** The roll-up row the hero reads, plus the prior-period columns every delta is derived from. */
  function participationRow(overrides: Record<string, unknown> = {}) {
    return {
      MEETING_TYPE_LEVEL: 'all',
      MEETING_TYPE_GROUP: null,
      MEETING_TYPE_LABEL: 'All meetings',
      TOTAL_GROUPS_COUNT: 8,
      MEETINGS_HELD_COUNT_YTD: 12,
      INVITED_COUNT_YTD: 120,
      ATTENDED_COUNT_YTD: 84,
      ATTENDANCE_PCT_YTD: 0.7,
      ACTIVE_GROUPS_COUNT_YTD: 6,
      NEVER_ATTENDED_COUNT_YTD: 3,
      MEETINGS_HELD_COUNT_LAST_COMPLETED_YEAR: 20,
      INVITED_COUNT_LAST_COMPLETED_YEAR: 200,
      ATTENDED_COUNT_LAST_COMPLETED_YEAR: 130,
      ATTENDANCE_PCT_LAST_COMPLETED_YEAR: 0.65,
      ACTIVE_GROUPS_COUNT_LAST_COMPLETED_YEAR: 7,
      NEVER_ATTENDED_COUNT_LAST_COMPLETED_YEAR: 2,
      MEETINGS_HELD_COUNT_PREV_COMPLETED_YEAR: 16,
      ATTENDANCE_PCT_PREV_COMPLETED_YEAR: 0.6,
      MEETINGS_HELD_COUNT_3RD_LAST_COMPLETED_YEAR: 14,
      ATTENDANCE_PCT_3RD_LAST_COMPLETED_YEAR: 0.55,
      MEETINGS_HELD_COUNT_PREV_YTD: 10,
      ATTENDANCE_PCT_PREV_YTD: 0.66,
      ...overrides,
    };
  }

  beforeEach(() => {
    execute.mockReset();
    isMissingObjectError.mockReset();
    isMissingObjectError.mockReturnValue(false);
    warning.mockReset();
    loggerError.mockReset();
  });

  it('reads the all-projects roll-up and the group rows in a single query', async () => {
    execute.mockResolvedValue({ rows: [participationRow()] });

    await service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(lastSql()).toContain('is_all_projects = TRUE');
    expect(lastSql()).toContain('meeting_type_level IN (?, ?)');
    expect(execute.mock.calls[0]?.[1]).toEqual(['acme', 'all', 'group']);
  });

  // The mapper reads its columns by name off the row, so a column missing from the SELECT reads
  // `undefined` and maps to a silent zero rather than failing — this is what catches that.
  it('selects every column the period mapper reads, for all four periods and their priors', () => {
    const suffixes = ['ytd', 'last_completed_year', 'prev_completed_year', '3rd_last_completed_year'];
    const columns = ['meetings_held_count', 'invited_count', 'attended_count', 'attendance_pct', 'active_groups_count', 'never_attended_count'];
    execute.mockResolvedValue({ rows: [participationRow()] });

    return service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' }).then(() => {
      const sql = lastSql();

      for (const suffix of suffixes) {
        for (const column of columns) {
          expect(sql).toContain(`${column}_${suffix}`);
        }
      }
      // YTD's prior is the only one that is not itself a selected period.
      expect(sql).toContain('attendance_pct_prev_ytd');
      expect(sql).toContain('meetings_held_count_prev_ytd');
    });
  });

  // Derived from the prior-period value columns, not the view's own `*_CHANGE_*` columns: those
  // exist for YTD only and are not in the same unit as the 0-1 shares beside them.
  it('derives each delta from the matching prior period', async () => {
    execute.mockResolvedValue({ rows: [participationRow()] });

    const response = await service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' });
    const periods = response.total?.periods ?? [];

    expect(periods.map((period) => period.range)).toEqual(['COMPLETED_YEAR_3', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR', 'YTD']);
    // YTD 0.70 against prev-YTD 0.66, and 12 meetings against 10.
    expect(periods[3]?.attendanceChangePp).toBeCloseTo(0.04, 10);
    expect(periods[3]?.meetingsChangePct).toBeCloseTo(0.2, 10);
    // The oldest period has no prior in the view, so it reports no movement rather than a zero.
    expect(periods[0]).toMatchObject({ attendanceChangePp: null, meetingsChangePct: null });
  });

  it('splits the roll-up from the type rows and orders the types for display', async () => {
    execute.mockResolvedValue({
      rows: [
        participationRow({ MEETING_TYPE_LEVEL: 'group', MEETING_TYPE_GROUP: 'Marketing', MEETING_TYPE_LABEL: 'Marketing' }),
        participationRow({ MEETING_TYPE_LEVEL: 'group', MEETING_TYPE_GROUP: 'Board', MEETING_TYPE_LABEL: 'Board' }),
        participationRow(),
      ],
    });

    const response = await service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' });

    expect(response.total?.level).toBe('all');
    expect(response.rows.map((row) => row.label)).toEqual(['Board', 'Marketing']);
    // Only the board's detail belongs to the Members tab today.
    expect(response.rows.map((row) => row.governance)).toEqual([true, false]);
  });

  it('sorts an unknown group after every known one rather than dropping it', async () => {
    execute.mockResolvedValue({
      rows: [
        participationRow({ MEETING_TYPE_LEVEL: 'group', MEETING_TYPE_GROUP: 'Ambassadors', MEETING_TYPE_LABEL: 'Ambassadors' }),
        participationRow({ MEETING_TYPE_LEVEL: 'group', MEETING_TYPE_GROUP: 'Board', MEETING_TYPE_LABEL: 'Board' }),
      ],
    });

    const response = await service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' });

    expect(response.rows.map((row) => row.label)).toEqual(['Board', 'Ambassadors']);
  });

  it('keeps a null attendance null rather than folding it into a real zero', async () => {
    execute.mockResolvedValue({ rows: [participationRow({ ATTENDANCE_PCT_YTD: null })] });

    const response = await service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' });

    expect(response.total?.periods[3]).toMatchObject({ attendancePct: null, attendanceChangePp: null });
  });

  it('returns the empty shape for a range the view carries no columns for', async () => {
    const response = await service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'COMPLETED_YEAR_4' });

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT);
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports a null total when the foundation has no roll-up row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const response = await service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' });

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT);
  });

  it('sends its own client message for a missing view rather than the warehouse object name', async () => {
    execute.mockRejectedValue(
      new MicroserviceError("Object 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_MEETING_PARTICIPATION' does not exist", 500, 'SNOWFLAKE_QUERY_ERROR', {
        operation: 'snowflake_execute',
        service: 'snowflake',
      })
    );
    isMissingObjectError.mockReturnValue(true);

    const error = (await service
      .getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' })
      .catch((thrown: unknown) => thrown)) as MicroserviceError;

    expect(error.toResponse()['error']).toBe('Meeting participation is unavailable right now.');
    expect(loggerError).toHaveBeenCalledWith(req, 'get_engagement_meeting_participation_missing_object', expect.any(Number), expect.any(Error), {
      snowflake_expected_missing_object: 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_MEETING_PARTICIPATION',
    });
  });

  it('rethrows any other Snowflake failure', async () => {
    execute.mockRejectedValue(new Error('connection reset'));

    await expect(service.getMeetingParticipation(req, { foundationSlug: 'acme', range: 'YTD' })).rejects.toThrow('connection reset');
  });
});

describe('HealthMetricsEngagementService.getOrgParticipation', () => {
  const service = new HealthMetricsEngagementService();

  /** One warehouse row: the caption counts and the lapsed flag carry no period suffix. */
  function orgWarehouseRow(overrides: Record<string, unknown> = {}) {
    return {
      ACCOUNT_ID: 'a-1',
      ACCOUNT_NAME: 'Acme Motors',
      MEMBERSHIP_TIER: 'Platinum',
      IS_MEMBER: true,
      LAST_ENGAGED_DATE: new Date('2026-08-14T00:00:00.000Z'),
      DAYS_SINCE_LAST_ENGAGED: 39,
      IS_LAPSED_180D: false,
      SCOPE_ORGS_COUNT: 136,
      SCOPE_LAPSED_ORGS_COUNT: 54,
      SCOPE_MEETINGS_HELD_COUNT_YTD: 30,
      MEETINGS_ORG_TOTAL_COUNT_YTD: 27,
      MEETINGS_INVITED_COUNT_YTD: 27,
      MEETINGS_ATTENDED_COUNT_YTD: 21,
      ATTENDANCE_PCT_YTD: 0.78,
      AVG_REPS_PER_MEETING_YTD: 1.75,
      SORT_RANK_YTD: 1,
      SCOPE_MEETINGS_HELD_COUNT_LAST_COMPLETED_YEAR: 30,
      MEETINGS_ORG_TOTAL_COUNT_LAST_COMPLETED_YEAR: 26,
      MEETINGS_INVITED_COUNT_LAST_COMPLETED_YEAR: 26,
      MEETINGS_ATTENDED_COUNT_LAST_COMPLETED_YEAR: 20,
      ATTENDANCE_PCT_LAST_COMPLETED_YEAR: 0.77,
      AVG_REPS_PER_MEETING_LAST_COMPLETED_YEAR: 1.6,
      SORT_RANK_LAST_COMPLETED_YEAR: 2,
      ...overrides,
    };
  }

  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ rows: [orgWarehouseRow()] });
    isMissingObjectError.mockReset();
    isMissingObjectError.mockReturnValue(false);
    loggerError.mockReset();
    warning.mockReset();
  });

  // Search, the lapsed cut and the period pill all project these rows, so one read serves them all.
  it('reads every period in one pass, scoped to the all-projects rows', async () => {
    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(lastBinds()).toEqual(['acme']);
    expect(lastSql()).toContain('is_all_projects = TRUE');
    expect(response.rows[0]?.periods.map((period) => period.range)).toEqual(['COMPLETED_YEAR_3', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR', 'YTD']);
    expect(response.rows[0]?.periods[3]).toMatchObject({ meetingsTotal: 27, attendedCount: 21, attendancePct: 0.78, avgReps: 1.75, sortRank: 1 });
  });

  it('keeps the view tier as-is, because this view is not member-only', async () => {
    execute.mockResolvedValue({ rows: [orgWarehouseRow({ MEMBERSHIP_TIER: 'Non-Member', IS_MEMBER: false })] });

    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(response.rows[0]).toMatchObject({ membershipTier: 'Non-Member', isMember: false });
  });

  // A `COUNT(*)` here would only ever match the row count, which is the same number by accident.
  it('reads the denormalized caption counts off a row rather than counting the rows', async () => {
    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(lastSql()).not.toContain('COUNT(');
    expect(response.counts).toEqual({ orgs: 136, lapsedOrgs: 54 });
  });

  it('keeps an unmeasured rate and rank null rather than folding them into a real zero', async () => {
    execute.mockResolvedValue({ rows: [orgWarehouseRow({ ATTENDANCE_PCT_YTD: null, AVG_REPS_PER_MEETING_YTD: null, SORT_RANK_YTD: null })] });

    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(response.rows[0]?.periods[3]).toMatchObject({ attendancePct: null, avgReps: null, sortRank: null });
  });

  it('reports no counts at all when the view leaves the scope count null on rows that exist', async () => {
    execute.mockResolvedValue({ rows: [orgWarehouseRow({ SCOPE_ORGS_COUNT: null })] });

    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(response.rows).toHaveLength(1);
    expect(response.counts).toBeNull();
  });

  // The client sorts and searches this payload in memory, so the read carries its own ceiling.
  it('caps the read rather than letting warehouse cardinality size the response', async () => {
    await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    // One past the cap: a scope of exactly the cap must not be reported as truncated.
    expect(lastSql()).toContain(`LIMIT ${HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP + 1}`);
  });

  // A capped read keeps the ranked head, so the cut runs on the best rank across the periods.
  it('orders the cut by the best rank across periods rather than alphabetically', async () => {
    await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(lastSql()).toContain('ORDER BY LEAST(');
    expect(lastSql()).toContain('IFNULL(sort_rank_ytd, 2147483647)');
  });

  it('truncates to the cap and says so out loud when the scope overruns it', async () => {
    execute.mockResolvedValue({ rows: Array.from({ length: HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP + 1 }, () => orgWarehouseRow()) });

    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(response.rows).toHaveLength(HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP);
    expect(warning).toHaveBeenCalledWith(req, 'get_engagement_org_participation', 'Organization rows hit the read cap', {
      foundation_slug: 'acme',
      row_cap: HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP,
    });
  });

  it('stays quiet for a scope of exactly the cap, which is complete rather than truncated', async () => {
    execute.mockResolvedValue({ rows: Array.from({ length: HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP }, () => orgWarehouseRow()) });

    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(response.rows).toHaveLength(HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP);
    expect(warning).not.toHaveBeenCalled();
  });

  it('reports the zeroed default for an empty scope instead of reading an absent first row', async () => {
    execute.mockResolvedValue({ rows: [] });

    const response = await service.getOrgParticipation(req, { foundationSlug: 'acme' });

    expect(response).toEqual(HEALTH_METRICS_ENGAGEMENT_ORG_PARTICIPATION_DEFAULT);
  });

  it('sends its own client message for a missing view rather than the warehouse object name', async () => {
    execute.mockRejectedValue(
      new MicroserviceError("Object 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_ORG_PARTICIPATION' does not exist", 500, 'SNOWFLAKE_QUERY_ERROR', {
        operation: 'snowflake_execute',
        service: 'snowflake',
      })
    );
    isMissingObjectError.mockReturnValue(true);

    const error = (await service.getOrgParticipation(req, { foundationSlug: 'acme' }).catch((thrown: unknown) => thrown)) as MicroserviceError;

    expect(error.toResponse()['error']).toBe('Organization participation is unavailable right now.');
  });

  it('rethrows any other Snowflake failure', async () => {
    execute.mockRejectedValue(new Error('connection reset'));

    await expect(service.getOrgParticipation(req, { foundationSlug: 'acme' })).rejects.toThrow('connection reset');
  });
});

describe('isSupportedEngagementRange', () => {
  it('accepts the four periods the view carries and rejects the fourth completed year', () => {
    expect(['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'].every(isSupportedEngagementRange)).toBe(true);
    expect(isSupportedEngagementRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedEngagementRange('toString')).toBe(false);
  });
});
