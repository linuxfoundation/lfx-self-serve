// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors project.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's vitest
// config, so every runtime (non-type-only) import needs a stub.
vi.mock('@lfx-one/shared/constants', () => ({
  DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE',
  VALKEY_CACHE: { ORG_LENS_SNOWFLAKE_TTL_SECONDS: 3600 },
}));

const { execute, withOrgCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  withOrgCache: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withOrgCache }));

const { OrgLensMeetingsService } = await import('./org-lens-meetings.service');

const req = {} as Request;

/** The delta rules are only reachable through the public reads, so exercise them there. */
function kpiRow(current: number, prior: number): Record<string, number> {
  return {
    EMPLOYEES_ACTIVE: current,
    MEETINGS_ATTENDED: current,
    PROJECTS_SUPPORTED: current,
    FOUNDATIONS_SUPPORTED: current,
    PRIOR_EMPLOYEES_ACTIVE: prior,
    PRIOR_MEETINGS_ATTENDED: prior,
    PRIOR_PROJECTS_SUPPORTED: prior,
    PRIOR_FOUNDATIONS_SUPPORTED: prior,
  };
}

function influenceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PROJECT_SLUG: 'bootc',
    PROJECT_NAME: 'bootc',
    ECOSYSTEM_INFLUENCE: 42,
    BAND: 'leading',
    RANK: 1,
    RANK_TOTAL: 10,
    RANK_TOTAL_ALL: 11688,
    DISPLAYED_INFLUENCE: 41,
    FROM_ATTENDANCE_PCT: 46,
    DELTA_PCT: 9.9,
    PRIOR_WINDOW_SCORE: 38,
    TREND_DIRECTION: 'up',
    BREAKDOWN: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Run the read-through factory directly so the mapping under test is what gets asserted.
  withOrgCache.mockImplementation(async (_account: string, _key: string, _ttl: number, factory: () => Promise<unknown>) => factory());
});

describe('OrgLensMeetingsService — KPI delta labels', () => {
  it.each([
    { current: 108, prior: 100, expected: '+8% vs. prior period', direction: 'up' },
    { current: 93, prior: 100, expected: '-7% vs. prior period', direction: 'down' },
    { current: 100, prior: 100, expected: 'No change vs. prior period', direction: 'flat' },
    // Rounds to zero rather than rendering "+0%".
    { current: 1002, prior: 1000, expected: 'No change vs. prior period', direction: 'flat' },
  ])('renders $expected for $current vs $prior', async ({ current, prior, expected, direction }) => {
    execute.mockResolvedValue({ rows: [kpiRow(current, prior)] });

    const summary = await new OrgLensMeetingsService().getKpiSummary(req, 'acc', 'past365d');

    expect(summary.meetingsAttendedDeltaLabel).toBe(expected);
    expect(summary.meetingsAttendedDeltaDirection).toBe(direction);
  });

  it('renders "New" from a zero baseline rather than an infinite percentage', async () => {
    execute.mockResolvedValue({ rows: [kpiRow(12, 0)] });

    const summary = await new OrgLensMeetingsService().getKpiSummary(req, 'acc', 'past365d');

    expect(summary.meetingsAttendedDeltaLabel).toBe('New');
    expect(summary.meetingsAttendedDeltaDirection).toBe('up');
  });

  it('reports no change when both periods are zero', async () => {
    execute.mockResolvedValue({ rows: [kpiRow(0, 0)] });

    const summary = await new OrgLensMeetingsService().getKpiSummary(req, 'acc', 'past365d');

    expect(summary.meetingsAttendedDeltaLabel).toBe('No change vs. prior period');
    expect(summary.meetingsAttendedDeltaDirection).toBe('flat');
  });

  // The case DR-020 turns on: a negligible prior period is no longer suppressed behind a phrase.
  it.each([
    { current: 1180, prior: 1, expected: '+117,900% vs. prior period' },
    { current: 168, prior: 1, expected: '+16,700% vs. prior period' },
    { current: 110, prior: 10, expected: '+1,000% vs. prior period' },
  ])('renders the grouped percentage $expected instead of a phrase', async ({ current, prior, expected }) => {
    execute.mockResolvedValue({ rows: [kpiRow(current, prior)] });

    const summary = await new OrgLensMeetingsService().getKpiSummary(req, 'acc', 'past365d');

    expect(summary.meetingsAttendedDeltaLabel).toBe(expected);
    expect(summary.meetingsAttendedDeltaDirection).toBe('up');
  });

  it('groups a large decline too, and keeps the sign', async () => {
    execute.mockResolvedValue({ rows: [kpiRow(100, 10000)] });

    const summary = await new OrgLensMeetingsService().getKpiSummary(req, 'acc', 'past365d');

    expect(summary.meetingsAttendedDeltaLabel).toBe('-99% vs. prior period');
    expect(summary.meetingsAttendedDeltaDirection).toBe('down');
  });
});

describe('OrgLensMeetingsService — influence row delta labels', () => {
  async function firstRow(overrides: Record<string, unknown> = {}) {
    execute.mockResolvedValue({ rows: [influenceRow(overrides)] });
    const rows = await new OrgLensMeetingsService().getInfluenceRows(req, 'acc', 'past365d');
    return rows[0];
  }

  it('renders the warehouse percentage with the warehouse trend direction', async () => {
    const row = await firstRow({ DELTA_PCT: 9.9, TREND_DIRECTION: 'down' });

    expect(row.deltaLabel).toBe('+9.9%');
    // DR-011: direction comes from TREND_DIRECTION, not the sign of the percentage.
    expect(row.deltaDirection).toBe('down');
  });

  it('renders "New" from a zero prior-year score', async () => {
    const row = await firstRow({ PRIOR_WINDOW_SCORE: 0 });

    expect(row.deltaLabel).toBe('New');
    expect(row.deltaDirection).toBe('up');
  });

  it('treats a sub-epsilon prior score as zero rather than dividing by it', async () => {
    const row = await firstRow({ PRIOR_WINDOW_SCORE: 1e-9 });

    expect(row.deltaLabel).toBe('New');
  });

  it('renders "No change" when the influence score stays at zero', async () => {
    const row = await firstRow({ ECOSYSTEM_INFLUENCE: 0, PRIOR_WINDOW_SCORE: 0 });

    expect(row.deltaLabel).toBe('No change');
    expect(row.deltaDirection).toBe('flat');
  });

  it('renders "No change" when a non-zero baseline has no percentage delta', async () => {
    const row = await firstRow({ DELTA_PCT: 0, PRIOR_WINDOW_SCORE: 10 });

    expect(row.deltaLabel).toBe('No change');
    expect(row.deltaDirection).toBe('flat');
  });

  // An absent prior score is unknown, not small — the one case with no percentage to fall back to.
  it.each([{ PRIOR_WINDOW_SCORE: null }, { PRIOR_WINDOW_SCORE: undefined }])(
    'keeps the unknown-baseline label when the prior score is absent',
    async (overrides) => {
      const row = await firstRow(overrides);

      expect(row.deltaLabel).toBe('No comparable prior period');
      expect(row.deltaDirection).toBe('flat');
    }
  );

  it('groups an oversized percentage instead of suppressing it', async () => {
    const row = await firstRow({ DELTA_PCT: 61328.8 });

    expect(row.deltaLabel).toBe('+61,328.8%');
  });
});

describe('OrgLensMeetingsService — cache keys', () => {
  it.each([
    { surface: 'kpi', call: (s: InstanceType<typeof OrgLensMeetingsService>) => s.getKpiSummary(req, 'acc', 'past365d'), key: 'meetings-kpi:v2:past365d' },
    {
      surface: 'influence',
      call: (s: InstanceType<typeof OrgLensMeetingsService>) => s.getInfluenceRows(req, 'acc', 'past365d'),
      key: 'meetings-influence:v4:past365d',
    },
    { surface: 'spend', call: (s: InstanceType<typeof OrgLensMeetingsService>) => s.getSpendBreakdown(req, 'acc', 'past365d'), key: 'meetings-spend:past365d' },
  ])('$surface reads from $key', async ({ call, key }) => {
    execute.mockResolvedValue({ rows: [] });

    await call(new OrgLensMeetingsService());

    expect(withOrgCache).toHaveBeenCalledWith('acc', key, 3600, expect.any(Function), expect.anything());
  });
});
