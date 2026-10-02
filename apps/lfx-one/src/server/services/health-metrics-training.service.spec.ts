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
  const summaryRows = [
    {
      DELIVERY_TYPE: 'All',
      ENROLLMENTS: 3850,
      CERTIFICATIONS: 620,
      REVENUE_USD: 100000.5,
      BASELINE_ENROLLMENTS: 3500,
      BASELINE_CERTIFICATIONS: null,
      BASELINE_REVENUE_USD: 90000,
    },
    { DELIVERY_TYPE: 'E-Learning', ENROLLMENTS: 2900, CERTIFICATIONS: 0, REVENUE_USD: 0 },
    { DELIVERY_TYPE: 'Certification Exam', ENROLLMENTS: 950, CERTIFICATIONS: 620, REVENUE_USD: null },
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

  it.each([
    ['YTD', 'ytd', 'prev_ytd'],
    ['COMPLETED_YEAR', 'last_completed_year', 'prev_completed_year'],
    ['COMPLETED_YEAR_2', 'prev_completed_year', '3rd_last_completed_year'],
  ] as const)('reads %s from the %s columns against the %s baseline', async (range, suffix, baseline) => {
    mockReads(summaryRows, []);

    await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme', range });

    const sql = summarySql();
    expect(sql).toContain(`enrollment_count_${suffix} AS enrollments`);
    expect(sql).toContain(`revenue_usd_${suffix} AS revenue_usd`);
    expect(sql).toContain(`certifications_earned_count_${baseline} AS baseline_certifications`);
    expect(sql).toContain(`ORDER BY sort_rank_${suffix} ASC NULLS LAST`);
  });

  it('selects no baseline for the oldest completed year, and returns none', async () => {
    mockReads(summaryRows, []);

    const enrollment = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme', range: 'COMPLETED_YEAR_3' });

    expect(summarySql()).toContain('NULL AS baseline_enrollments');
    expect(enrollment.baseline).toBeNull();
  });

  it('binds only the foundation, once per read', async () => {
    mockReads(summaryRows, []);

    await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme', range: 'YTD' });

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

    const enrollment = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme', range: 'YTD' });

    expect(enrollment).toEqual({
      measured: true,
      totals: { enrollments: 3850, certifications: 620, revenueUsd: 100000.5 },
      baseline: { enrollments: 3500, certifications: null, revenueUsd: 90000 },
      byType: [
        { deliveryType: 'E-Learning', enrollments: 2900, revenueUsd: 0 },
        { deliveryType: 'Certification Exam', enrollments: 950, revenueUsd: null },
      ],
      trend: [
        { year: 2025, enrollments: 3400 },
        { year: 2026, enrollments: null },
      ],
    });
  });

  it('returns the unmeasured read when the foundation has no All row', async () => {
    mockReads([], [{ ENROLLMENT_YEAR: 2025, ENROLLMENT_COUNT: 10 }]);

    const enrollment = await new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme', range: 'YTD' });

    expect(enrollment.measured).toBe(false);
    expect(enrollment.trend).toEqual([]);
  });

  it('rejects when either read fails', async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes('TRAINING_ENROLLMENTS_BY_YEAR')) throw new Error('warehouse down');
      return { rows: summaryRows };
    });

    await expect(new HealthMetricsTrainingService().getEnrollment(req, { foundationSlug: 'acme', range: 'YTD' })).rejects.toThrow('warehouse down');
  });
});
