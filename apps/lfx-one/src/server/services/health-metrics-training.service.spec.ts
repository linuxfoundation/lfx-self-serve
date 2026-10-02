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
