// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_COLORS,
  HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED,
} from '../constants/health-metrics-members.constants';
import { buildHealthMetricsMembersSubNavItems, buildHealthMetricsMembersTiersView } from './health-metrics-members.utils';

import type { HealthMetricsMembersTiers } from '../interfaces/health-metrics-members.interface';

describe('buildHealthMetricsMembersSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsMembersSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.label));
  });

  it('renders no badge or note while no section reports a count', () => {
    expect(buildHealthMetricsMembersSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });
});

describe('buildHealthMetricsMembersTiersView', () => {
  const row = (year: number, tier: string, sortRank: number, memberCount: number | null, revenueUsd: number | null, newMemberCount: number | null = 0) => ({
    year,
    tier,
    sortRank,
    memberCount,
    newMemberCount,
    revenueUsd,
    isPartialYear: year === 2026,
  });
  const TIERS: HealthMetricsMembersTiers = {
    rows: [
      row(2024, 'Gold', 2, 10, 500_000),
      row(2024, 'Platinum', 1, 5, 1_000_000),
      row(2025, 'Gold', 2, 15, 750_000, 6),
      row(2025, 'Platinum', 1, 5, 1_000_000, 1),
      row(2025, 'Silver', 3, 0, 0),
      row(2026, 'Gold', 2, 16, 800_000, 2),
      row(2026, 'Platinum', 1, 6, 1_200_000, 1),
    ],
    foundationRevenue: [
      { range: 'YTD', totalUsd: 4_000_000 },
      { range: 'COMPLETED_YEAR', totalUsd: 3_500_000 },
    ],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('orders tiers by sort rank and years ascending, flagging the current year', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'COMPLETED_YEAR', 'members');

    expect(view.tiers.map((tier) => tier.tier)).toEqual(['Platinum', 'Gold', 'Silver']);
    expect(view.years.map((year) => [year.year, year.isCurrent, year.isPartial])).toEqual([
      [2024, false, false],
      [2025, false, false],
      [2026, true, true],
    ]);
    expect(view.metaLabel).toBe('3 tiers · 3 years');
  });

  it('keeps the matrix total equal to the headline for the selected year', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'COMPLETED_YEAR', 'members');
    const column = view.years.findIndex((year) => year.year === 2025);
    const cellSum = view.tiers.reduce((sum, tier) => sum + (tier.cells[column].count ?? 0), 0);

    expect(view.years[column].totalMembers).toBe(cellSum);
    expect(view.headline.value).toBe(String(cellSum));
    expect(view.years[column].totalRevenueLabel).toBe('$1.8M');
  });

  it('compares a completed year with the one before it', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'COMPLETED_YEAR', 'members');

    expect(view.headline).toMatchObject({ key: 'members', value: '20', delta: '+33%', deltaDirection: 'up', baseline: 'vs 2024' });
    expect(view.side.map((stat) => stat.key)).toEqual(['revenue', 'new', 'share']);
    expect(view.side.map((stat) => stat.baseline)).toEqual([null, null, null]);
    expect(view.side[0]).toMatchObject({ value: '$1.8M', delta: null });
    expect(view.side[1]).toMatchObject({ label: 'New in 2025', value: '7', positive: true });
    expect(view.side[2]).toMatchObject({ value: '50%' });
  });

  it('leads with revenue in revenue mode', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'COMPLETED_YEAR', 'revenue');

    expect(view.headline).toMatchObject({ key: 'revenue', value: '$1.8M', delta: '+17%', deltaDirection: 'up', baseline: 'vs 2024' });
    expect(view.side.map((stat) => stat.key)).toEqual(['members', 'new', 'share']);
    expect(view.side[0].delta).toBeNull();
  });

  it('gives a partial year no delta and labels its new members as this year', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'YTD', 'members');

    expect(view.headline).toMatchObject({ value: '22', delta: 'not available', deltaDirection: 'neutral', baseline: null });
    expect(view.side[1].label).toBe('New this year');
    expect(view.side[2].value).toBe('50%');
  });

  it('gives no delta when the prior year has no rows, and no share without a foundation total', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'COMPLETED_YEAR_2', 'members');

    expect(view.headline.delta).toBe('not available');
    expect(view.side[2].value).toBe('not available');
  });

  it('shows a dash for a measured zero and a year without rows', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'COMPLETED_YEAR_3', 'members');
    const silver = view.tiers.find((tier) => tier.tier === 'Silver');

    expect(silver?.cells.map((cell) => cell.label)).toEqual(['—', '—', '—']);
    // A measured zero is a 0% share; a year the tier is missing from has no share at all.
    expect(silver?.cells.map((cell) => cell.sharePct)).toEqual([null, 0, null]);
    expect(view.yearMeasured).toBe(false);
    expect(view.headline).toMatchObject({ value: '—', delta: 'not available' });
  });

  it('draws one tier in one year as a single full bar', () => {
    const view = buildHealthMetricsMembersTiersView({ rows: [row(2025, 'Member', 1, 4, 40_000)], foundationRevenue: [] }, 'COMPLETED_YEAR', 'members');

    expect(view.tiers).toHaveLength(1);
    expect(view.tiers[0].cells).toEqual([{ year: 2025, count: 4, label: '4', sharePct: 100 }]);
    expect(view.metaLabel).toBe('1 tier · 1 year');
  });

  it('reports an unmeasured foundation', () => {
    const view = buildHealthMetricsMembersTiersView(HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED, 'YTD', 'members');

    expect(view.measured).toBe(false);
    expect(view.tiers).toEqual([]);
    expect(view.years).toEqual([]);
  });

  it('cycles the palette past the last colour', () => {
    const rows = Array.from({ length: HEALTH_METRICS_MEMBERS_TIERS_COLORS.length + 1 }, (_, index) => row(2025, `Tier ${index}`, index, 1, 1));
    const view = buildHealthMetricsMembersTiersView({ rows, foundationRevenue: [] }, 'COMPLETED_YEAR', 'members');

    expect(view.tiers.at(-1)?.color).toBe(HEALTH_METRICS_MEMBERS_TIERS_COLORS[0]);
  });
});
