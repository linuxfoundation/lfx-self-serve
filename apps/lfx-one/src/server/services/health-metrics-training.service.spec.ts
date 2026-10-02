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

describe('HealthMetricsTrainingService.getPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('probes for one foundation summary row, binding only the foundation', async () => {
    execute.mockResolvedValue({ rows: [{ PRESENT: 1 }] });

    const presence = await new HealthMetricsTrainingService().getPresence(req, { foundationSlug: 'acme' });

    const [sql, binds, options] = execute.mock.calls[0];
    expect(sql).toContain('SELECT 1 AS present');
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.TRAINING_SUMMARY');
    expect(sql).toContain('WHERE foundation_slug = ?');
    expect(sql).toContain('LIMIT 1');
    expect(binds).toEqual(['acme']);
    expect(options).toEqual({ expectMissingObject: true });
    expect(presence).toEqual({ hasProgramme: true });
  });

  it('reports no programme when the foundation has no summary row', async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(new HealthMetricsTrainingService().getPresence(req, { foundationSlug: 'acme' })).resolves.toEqual({ hasProgramme: false });
  });

  it('rejects when the read fails, rather than reporting no programme', async () => {
    execute.mockRejectedValue(new Error('warehouse down'));

    await expect(new HealthMetricsTrainingService().getPresence(req, { foundationSlug: 'acme' })).rejects.toThrow('warehouse down');
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
    row('All', {
      ENROLLMENTS: 3850,
      CERTIFICATIONS: 620,
      REVENUE_USD: 100000.5,
      BASELINE_ENROLLMENTS: 3500,
      BASELINE_CERTIFICATIONS: null,
      BASELINE_REVENUE_USD: 90000,
    }),
    row('Certification Exam', { ENROLLMENTS: 950, CERTIFICATIONS: 620, REVENUE_USD: null, SORT_RANK: 2 }, { SORT_RANK_COMPLETED_YEAR: 1 }),
    row(
      'E-Learning',
      { ENROLLMENTS: 2900, CERTIFICATIONS: 0, REVENUE_USD: 0, SORT_RANK: 1 },
      { SORT_RANK_COMPLETED_YEAR: 2, ENROLLMENTS_COMPLETED_YEAR: 4100 }
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

  it('selects every period from its own columns against its own baseline, in one read', async () => {
    mockReads(summaryRows, []);

    await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    const sql = summarySql();
    for (const [range, suffix, baseline] of [
      ['YTD', 'ytd', 'prev_ytd'],
      ['COMPLETED_YEAR', 'last_completed_year', 'prev_completed_year'],
      ['COMPLETED_YEAR_2', 'prev_completed_year', '3rd_last_completed_year'],
    ]) {
      expect(sql).toContain(`enrollment_count_${suffix} AS enrollments_${range}`);
      expect(sql).toContain(`revenue_usd_${suffix} AS revenue_usd_${range}`);
      expect(sql).toContain(`sort_rank_${suffix} AS sort_rank_${range}`);
      expect(sql).toContain(`certifications_earned_count_${baseline} AS baseline_certifications_${range}`);
    }
    expect(sql).toContain('enrollment_count_3rd_last_completed_year AS enrollments_COMPLETED_YEAR_3');
    expect(sql).toContain('NULL AS baseline_enrollments_COMPLETED_YEAR_3');
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
      { ENROLLMENT_YEAR: 2025, ENROLLMENT_COUNT: 3400 },
      { ENROLLMENT_YEAR: '2026', ENROLLMENT_COUNT: null },
    ]);

    const enrollment = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(enrollment.measured).toBe(true);
    expect(enrollment.periods.YTD).toEqual({
      totals: { enrollments: 3850, certifications: 620, revenueUsd: 100000.5 },
      baseline: { enrollments: 3500, certifications: null, revenueUsd: 90000 },
      byType: [
        { deliveryType: 'E-Learning', enrollments: 2900, revenueUsd: 0 },
        { deliveryType: 'Certification Exam', enrollments: 950, revenueUsd: null },
      ],
    });
    expect(enrollment.trend).toEqual([
      { year: 2025, enrollments: 3400 },
      { year: 2026, enrollments: null },
    ]);
  });

  it("orders each period's types by that period's rank and reads that period's figures", async () => {
    mockReads(summaryRows, []);

    const { periods } = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme' });

    expect(periods.COMPLETED_YEAR.byType.map((type) => [type.deliveryType, type.enrollments])).toEqual([
      ['Certification Exam', 950],
      ['E-Learning', 4100],
    ]);
    expect(periods.COMPLETED_YEAR_3.baseline).toBeNull();
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
  const QUERY = { foundationSlug: 'acme', range: 'YTD', type: 'all', search: '', offset: 0, pageSize: 25 } as const;

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
  ] as const)('scopes %s to courses with enrollments, ranked by that period', async (range, suffix) => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, range });

    const [sql] = execute.mock.calls[0];
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.TRAINING_COURSES');
    expect(sql).toContain(`AND enrollment_count_${suffix} > 0`);
    expect(sql).toContain('AND _key IS NOT NULL');
    expect(sql).toContain("AND NULLIF(TRIM(course_name), '') IS NOT NULL");
    expect(sql).toContain(`revenue_usd_${suffix} AS revenue_usd`);
    expect(sql).toContain(`sort_rank_${suffix} AS sort_rank`);
    expect(sql).toContain('ORDER BY sort_rank ASC NULLS LAST, course_key ASC');
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

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, type: 'certifications', search: '50%_off!' });

    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain("WHERE delivery_type = ? AND course_name ILIKE ? ESCAPE '!'");
    expect(binds).toEqual(['acme', 'Certification Exam', '%50!%!_off!!%']);
    expect(countPlaceholders(sql)).toBe(binds.length);
  });

  it('maps eLearning to its delivery type', async () => {
    execute.mockResolvedValue({ rows: [] });

    await new HealthMetricsTrainingService().getCourses(req, { ...QUERY, type: 'elearning' });

    expect(execute.mock.calls[0][1]).toEqual(['acme', 'E-Learning']);
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
