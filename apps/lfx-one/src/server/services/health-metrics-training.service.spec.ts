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

import { HealthMetricsTrainingService } from './health-metrics-training.service';

import type { Request } from 'express';

const req = {} as Request;

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
