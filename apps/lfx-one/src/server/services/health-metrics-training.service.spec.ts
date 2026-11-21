// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static isMissingObjectError = vi.fn(() => false);
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular and cannot load outside a test bed.
vi.mock('@lfx-one/shared/utils', () => ({}));

import { HEALTH_METRICS_L2_RANGES } from '@lfx-one/shared/constants';

import { HealthMetricsTrainingService, isSupportedTrainingRange } from './health-metrics-training.service';

import type { Request } from 'express';

const req = {} as Request;

describe('isSupportedTrainingRange', () => {
  it('accepts the four periods the views carry and rejects the fourth completed year', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isSupportedTrainingRange)).toBe(true);
    expect(isSupportedTrainingRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedTrainingRange('toString')).toBe(false);
  });
});

describe('HealthMetricsTrainingService.getEnrollment', () => {
  const RANGES = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3'] as const;

  /** One wide row with the same figures under every period, overridden per column where a test needs it. */
  function row(deliveryType: string, figures: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const columns = RANGES.flatMap((range) => Object.entries(figures).map(([key, value]) => [`${key}_${range}`, value]));
    return { DELIVERY_TYPE: deliveryType, ...Object.fromEntries(columns), ...overrides };
  }

  const summaryRows = [
    row(
      'All',
      { ENROLLMENTS: 3850, CERTIFICATIONS: 620, REVENUE_USD: 100000.5 },
      {
        ENROLLMENT_COUNT_CHANGE_PCT: 0.1,
        CERTIFICATIONS_CHANGE_PCT: null,
        REVENUE_CHANGE_PCT: -0.25,
        ENROLLMENT_GOAL_YTD: 4000,
        ENROLLMENT_GOAL_PROGRESS_YTD: '0.9625',
        REVENUE_GOAL_USD_YTD: 0,
        REVENUE_GOAL_PROGRESS_YTD: null,
        ENROLLMENT_GOAL_COMPLETED_YEAR: 3500,
        ENROLLMENT_GOAL_PROGRESS_COMPLETED_YEAR: '1.0',
        REVENUE_GOAL_USD_COMPLETED_YEAR: '250000',
        REVENUE_GOAL_PROGRESS_COMPLETED_YEAR: '0.42',
      }
    ),
    row(
      'Certification Exam',
      { ENROLLMENTS: 950, CERTIFICATIONS: 620, REVENUE_USD: null, SORT_RANK: 2 },
      { SORT_RANK_COMPLETED_YEAR: 1, IS_LISTED_DELIVERY_TYPE: true }
    ),
    row(
      'E-Learning',
      { ENROLLMENTS: 2900, CERTIFICATIONS: 0, REVENUE_USD: 0, SORT_RANK: 1 },
      { SORT_RANK_COMPLETED_YEAR: 2, ENROLLMENTS_COMPLETED_YEAR: 4100, IS_LISTED_DELIVERY_TYPE: true }
    ),
  ];

  function mockReads(summary: unknown[], years: unknown[]): void {
    execute.mockImplementation(async (sql: string) => ({ rows: sql.includes('TRAINING_ENROLLMENTS_BY_YEAR') ? years : summary }));
  }

  function summarySql(): string {
    return execute.mock.calls.map(([sql]) => sql as string).find((sql) => sql.includes('TRAINING_SUMMARY')) ?? '';
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects every period from its own columns, plus the model's YTD change, in one read", async () => {
    mockReads(summaryRows, []);

    await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    const sql = summarySql();
    for (const [range, suffix] of [
      ['YTD', 'ytd'],
      ['COMPLETED_YEAR', 'last_completed_year'],
      ['COMPLETED_YEAR_2', 'prev_completed_year'],
      ['COMPLETED_YEAR_3', '3rd_last_completed_year'],
    ]) {
      expect(sql).toContain(`enrollment_count_${suffix} AS enrollments_${range}`);
      expect(sql).toContain(`certifications_earned_count_${suffix} AS certifications_${range}`);
      expect(sql).toContain(`revenue_usd_${suffix} AS revenue_usd_${range}`);
      expect(sql).toContain(`sort_rank_${suffix} AS sort_rank_${range}`);
    }
    for (const column of [
      'is_listed_delivery_type',
      'is_listed_revenue_delivery_type',
      'enrollment_count_change_pct',
      'certifications_change_pct',
      'revenue_change_pct',
      'enrollment_goal',
      'enrollment_goal_progress_ytd',
      'revenue_goal_usd',
      'revenue_goal_progress_ytd',
    ])
      expect(sql).toContain(column);
    expect(sql).not.toMatch(/prev_ytd|baseline/);
  });

  it('reads each year with the three named delivery types beside the total', async () => {
    mockReads(summaryRows, []);

    await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    const sql = execute.mock.calls.map(([query]) => query as string).find((query) => query.includes('TRAINING_ENROLLMENTS_BY_YEAR')) ?? '';
    expect(sql).toContain('SELECT enrollment_year, enrollment_count, certification_exam_count, microcourse_count, instructor_led_count');
  });

  it('binds only the foundation, once per read', async () => {
    mockReads(summaryRows, []);

    await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(execute).toHaveBeenCalledTimes(2);
    for (const [sql, binds] of execute.mock.calls) {
      expect((sql as string).match(/\?/g)).toHaveLength(1);
      expect(binds).toEqual(['acme']);
    }
  });

  it('maps the All row to the totals, the other rows to the by-type split, and keeps NULL as NULL', async () => {
    mockReads(summaryRows, [
      { ENROLLMENT_YEAR: 2025, ENROLLMENT_COUNT: 3400, CERTIFICATION_EXAM_COUNT: 500, MICROCOURSE_COUNT: 0, INSTRUCTOR_LED_COUNT: 300 },
      { ENROLLMENT_YEAR: '2026', ENROLLMENT_COUNT: null, CERTIFICATION_EXAM_COUNT: null, MICROCOURSE_COUNT: null, INSTRUCTOR_LED_COUNT: null },
    ]);

    const enrollment = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(enrollment.measured).toBe(true);
    expect(enrollment.periods.YTD).toEqual({
      totals: { enrollments: 3850, certifications: 620, revenueUsd: 100000.5 },
      change: { enrollments: 0.1, certifications: null, revenueUsd: -0.25 },
      byType: [
        { deliveryType: 'E-Learning', isListed: true, isListedRevenue: false, enrollments: 2900, revenueUsd: 0 },
        { deliveryType: 'Certification Exam', isListed: true, isListedRevenue: false, enrollments: 950, revenueUsd: null },
      ],
    });
    expect(enrollment.trend).toEqual([
      { year: 2025, enrollments: 3400, certificationExams: 500, microcourses: 0, instructorLed: 300 },
      { year: 2026, enrollments: null, certificationExams: null, microcourses: null, instructorLed: null },
    ]);
  });

  it("orders each period's types by that period's rank and reads that period's figures", async () => {
    mockReads(summaryRows, []);

    const { periods } = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(periods.COMPLETED_YEAR.byType.map((type) => [type.deliveryType, type.enrollments])).toEqual([
      ['Certification Exam', 950],
      ['E-Learning', 4100],
    ]);
    expect(periods.COMPLETED_YEAR.change).toBeNull();
    expect(periods.COMPLETED_YEAR_3.change).toBeNull();
  });

  // MicroCourse and Bundle count in the All row but are not listed; a missing flag reads as not listed.
  it("reads the model's listed flag for each type", async () => {
    mockReads(
      [...summaryRows, row('MicroCourse', { ENROLLMENTS: 40, SORT_RANK: 3 }, { IS_LISTED_DELIVERY_TYPE: false }), row('Bundle', { ENROLLMENTS: 0 })],
      []
    );

    const { periods } = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(periods.YTD.byType.map((type) => [type.deliveryType, type.isListed])).toEqual([
      ['E-Learning', true],
      ['Certification Exam', true],
      ['MicroCourse', false],
      ['Bundle', false],
    ]);
  });

  // Bundle is sold but not enrolled in, so only the revenue view lists it.
  it("reads the model's revenue listed flag for each type", async () => {
    mockReads([summaryRows[0], row('Bundle', { REVENUE_USD: 500, SORT_RANK: 1 }, { IS_LISTED_REVENUE_DELIVERY_TYPE: true }), summaryRows[2]], []);

    const { periods } = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(periods.YTD.byType.map((type) => [type.deliveryType, type.isListed, type.isListedRevenue])).toEqual([
      ['Bundle', false, true],
      ['E-Learning', true, false],
    ]);
  });

  it("reads each period's goals off the All row, treating a zero or missing goal as none", async () => {
    mockReads(summaryRows, []);

    const { goals } = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(summarySql()).toContain('enrollment_goal_last_completed_year AS enrollment_goal_COMPLETED_YEAR');
    expect(summarySql()).toContain('revenue_goal_progress_3rd_last_completed_year AS revenue_goal_progress_COMPLETED_YEAR_3');
    expect(goals.YTD).toEqual({ enrollments: 4000, revenueUsd: null, enrollmentsProgress: 0.9625, revenueProgress: null });
    expect(goals.COMPLETED_YEAR).toEqual({ enrollments: 3500, revenueUsd: 250000, enrollmentsProgress: 1, revenueProgress: 0.42 });
    expect(goals.COMPLETED_YEAR_2).toEqual({ enrollments: null, revenueUsd: null, enrollmentsProgress: null, revenueProgress: null });
  });

  it('ranks a type without a rank last, by name', async () => {
    mockReads([summaryRows[0], row('Instructor Led', { ENROLLMENTS: 5 }), row('Bundle', { ENROLLMENTS: 0 }), summaryRows[2]], []);

    const { periods } = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(periods.YTD.byType.map((type) => type.deliveryType)).toEqual(['E-Learning', 'Bundle', 'Instructor Led']);
  });

  it('returns the unmeasured read when the foundation has no All row', async () => {
    mockReads([], [{ ENROLLMENT_YEAR: 2025, ENROLLMENT_COUNT: 10 }]);

    const enrollment = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(enrollment.measured).toBe(false);
    expect(enrollment.trend).toEqual([]);
    expect(enrollment.goals.YTD.enrollments).toBeNull();
  });

  it('rejects when either read fails', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('TRAINING_ENROLLMENTS_BY_YEAR')) throw new Error('warehouse down');
      return { rows: summaryRows };
    });

    await expect(new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' })).rejects.toThrow('warehouse down');
  });
});

describe('HealthMetricsTrainingService.getCourses', () => {
  const QUERY = { foundationSlug: 'acme', range: 'YTD', type: 'all', search: '', offset: 0, pageSize: 25, sort: null } as const;

  const pageRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    SCOPE_TOTAL: 40,
    TOTAL_RECORDS: 12,
    IS_PAGE_ROW: true,
    COURSE_KEY: 'course-1',
    COURSE_NAME: 'Example Practitioner Exam',
    DELIVERY_TYPE: 'Certification Exam',
    IS_FREE: false,
    HAS_PURCHASE_COVERAGE: true,
    ENROLLMENT_COUNT: 900,
    REVENUE_USD: -150,
    ...overrides,
  });

  const countPlaceholders = (sql: string): number => (sql.match(/\?/g) ?? []).length;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['YTD', 'ytd'],
    ['COMPLETED_YEAR', 'last_completed_year'],
    ['COMPLETED_YEAR_2', 'prev_completed_year'],
    ['COMPLETED_YEAR_3', '3rd_last_completed_year'],
  ] as const)('scopes %s to every course ever enrolled in, ranked by that period', async (range, suffix) => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, range });

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.TRAINING_COURSES');
    expect(sql).toContain('AND has_enrollment_all_time');
    expect(sql).not.toContain(`enrollment_count_${suffix} > 0`);
    expect(sql).toContain('SELECT (SELECT MAX(scope_courses_count) FROM scoped) AS scope_total');
    expect(sql).toContain('AND _key IS NOT NULL');
    expect(sql).toContain("AND NULLIF(TRIM(course_name), '') IS NOT NULL");
    expect(sql).toContain(`revenue_usd_${suffix} AS revenue_usd`);
    expect(sql).toContain(`sort_rank_${suffix} AS sort_rank`);
    expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY sort_rank ASC NULLS LAST, course_key ASC) AS page_position');
    expect(sql).toContain('ORDER BY page.page_position ASC NULLS LAST');
  });

  it('binds only the foundation with no type or search', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, QUERY);

    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain('SELECT * FROM scoped \n');
    expect(binds).toEqual(['acme']);
    expect(countPlaceholders(sql)).toBe(binds.length);
  });

  it('binds the type and an escaped search, one placeholder each', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, type: 'certification', search: '50%_off!' });

    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain("WHERE delivery_type IN (?) AND course_name ILIKE ? ESCAPE '!'");
    expect(binds).toEqual(['acme', 'Certification Exam', '%50!%!_off!!%']);
    expect(countPlaceholders(sql)).toBe(binds.length);
  });

  it.each([
    ['elearning', ['E-Learning', 'MicroCourse', 'edX']],
    ['instructor-led', ['Instructor Led']],
  ] as const)('maps %s to every delivery type it keeps, one placeholder each', async (type, deliveryTypes) => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, type });

    const [sql, binds] = execute.mock.calls[0];
    expect(binds).toEqual(['acme', ...deliveryTypes]);
    expect(countPlaceholders(sql)).toBe(binds.length);
  });

  it.each([
    ['course', 'asc', 'COLLATE(NULLIF(NULLIF(TRIM(course_name'],
    ['type', 'desc', "CASE delivery_type WHEN 'E-Learning' THEN 'eLearning'"],
    ['enrollments', 'asc', 'enrollment_count ASC NULLS LAST'],
    ['revenue', 'desc', 'CASE WHEN is_free THEN 0 WHEN is_free = FALSE AND has_purchase_coverage THEN revenue_usd END DESC NULLS LAST'],
  ] as const)('orders every page by %s %s, the view rank breaking ties, with no added binds', async (key, direction, expression) => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, sort: { key, direction } });

    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain(expression);
    expect(sql).toContain('NULLS LAST, sort_rank ASC NULLS LAST, course_key ASC) AS page_position');
    expect(binds).toEqual(['acme']);
  });

  it('clamps the page size and offset it interpolates', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, pageSize: 5000, offset: -10 });

    expect(execute.mock.calls[0][0]).toContain('LIMIT 100 OFFSET 0');
  });

  it('maps the page and its totals, keeping negative revenue and NULL free flags', async () => {
    execute.mockResolvedValue({ rows: [pageRow(), pageRow({ COURSE_KEY: 'course-2', DELIVERY_TYPE: 'edX', IS_FREE: null, HAS_PURCHASE_COVERAGE: null })] });

    const courses = await new HealthMetricsTrainingService().getCourses(req, QUERY);

    expect(courses).toEqual({
      rows: [
        {
          courseKey: 'course-1',
          courseName: 'Example Practitioner Exam',
          deliveryType: 'Certification Exam',
          isFree: false,
          hasPurchaseCoverage: true,
          enrollments: 900,
          revenueUsd: -150,
        },
        {
          courseKey: 'course-2',
          courseName: 'Example Practitioner Exam',
          deliveryType: 'edX',
          isFree: null,
          hasPurchaseCoverage: false,
          enrollments: 900,
          revenueUsd: -150,
        },
      ],
      totalRecords: 12,
      scopeTotal: 40,
    });
  });

  // MAX over no courses is NULL: a foundation never enrolled in reads as 0, the empty state, not as unmeasured.
  it('reads a foundation with no course ever enrolled in as a zero scope', async () => {
    execute.mockResolvedValue({ rows: [{ SCOPE_TOTAL: null, TOTAL_RECORDS: 0, IS_PAGE_ROW: null, COURSE_KEY: null, COURSE_NAME: null }] });

    await expect(new HealthMetricsTrainingService().getCourses(req, QUERY)).resolves.toEqual({ rows: [], totalRecords: 0, scopeTotal: 0 });
  });

  it('keeps the scope count off the page rows', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, QUERY);

    const [sql] = execute.mock.calls[0];
    const page = sql.slice(sql.indexOf('page AS'), sql.indexOf('SELECT totals.*')).replace(/--.*$/gm, '');
    expect(page).not.toContain('scope_courses_count');
    expect(page).not.toContain('SELECT *');
  });

  it('still reports the totals for a page past the end', async () => {
    execute.mockResolvedValue({ rows: [{ SCOPE_TOTAL: 40, TOTAL_RECORDS: 12, IS_PAGE_ROW: null, COURSE_KEY: null, COURSE_NAME: null }] });

    await expect(new HealthMetricsTrainingService().getCourses(req, { ...QUERY, offset: 500 })).resolves.toEqual({
      rows: [],
      totalRecords: 12,
      scopeTotal: 40,
    });
  });

  it('rejects when the read fails, rather than reporting no courses', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(new HealthMetricsTrainingService().getCourses(req, QUERY)).rejects.toThrow('warehouse down');
  });
});
