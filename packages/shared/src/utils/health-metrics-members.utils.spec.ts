// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_COLORS,
  HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED,
} from '../constants/health-metrics-members.constants';
import {
  buildHealthMetricsMembersBridgeView,
  buildHealthMetricsMembersDirectoryRows,
  buildHealthMetricsMembersDirectorySearchPlaceholder,
  buildHealthMetricsMembersDirectorySummary,
  buildHealthMetricsMembersMovementCountNote,
  buildHealthMetricsMembersMovementDrawerTitle,
  buildHealthMetricsMembersMovementRows,
  buildHealthMetricsMembersSubNavItems,
  buildHealthMetricsMembersTiersView,
} from './health-metrics-members.utils';

import type {
  HealthMetricsMembersBridge,
  HealthMetricsMembersDirectoryMember,
  HealthMetricsMembersBridgeStep,
  HealthMetricsMembersBridgeStepType,
  HealthMetricsMembersTiers,
} from '../interfaces/health-metrics-members.interface';

describe('buildHealthMetricsMembersSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsMembersSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.label));
  });

  it('renders no badge or note while no section reports a count', () => {
    expect(buildHealthMetricsMembersSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });

  it('badges only the sections that report a count', () => {
    const items = buildHealthMetricsMembersSubNavItems({ list: 725 });

    expect(items.find((item) => item.key === 'list')?.count).toBe(725);
    expect(items.filter((item) => item.key !== 'list').every((item) => item.count === null)).toBe(true);
  });
});

describe('buildHealthMetricsMembersDirectoryRows', () => {
  function member(overrides: Partial<HealthMetricsMembersDirectoryMember> = {}): HealthMetricsMembersDirectoryMember {
    return {
      accountId: '0014100000AcmeDir1',
      accountName: 'Acme Robotics',
      membershipTier: 'Gold Membership',
      annualDuesUsd: 89_500,
      engagementLevel: 'Low',
      engagementScore: 2.26,
      npsCategory: 'Detractor',
      isAtRisk: true,
      renewalDate: '2027-01-11',
      renewalDuesUsd: 95_000,
      lastEngagedDate: '2026-02-03',
      contributionCount: 1_204,
      sponsorshipUsd: 12_499.6,
      trainingEnrollmentCount: 0,
      eventRegistrationCount: 7,
      ...overrides,
    };
  }

  it('formats a tracked member', () => {
    const [row] = buildHealthMetricsMembersDirectoryRows([member()]);

    expect(row).toMatchObject({
      accountId: '0014100000AcmeDir1',
      npsLabel: 'Detractor',
      npsClass: 'bg-red-50 text-red-700',
      isAtRisk: true,
      tierLabel: 'Gold Membership',
      duesLabel: '$89.5K',
      engagementLabel: 'Low',
      engagementDotClass: 'bg-red-600',
      scoreLabel: '2.3',
      renewsLabel: 'Jan 11, 2027',
      renewalDuesLabel: '$95K',
      lastEngagedLabel: 'Feb 3, 2026',
    });
    expect(row.activity).toEqual([
      { key: 'contribution', label: '1,204', tracked: true },
      { key: 'sponsorship', label: '$12.5K', tracked: true },
      { key: 'training', label: '0', tracked: true },
      { key: 'events', label: '7', tracked: true },
    ]);
  });

  it('renders every missing value as a dash, and an untracked activity as not tracked rather than 0', () => {
    const [row] = buildHealthMetricsMembersDirectoryRows([
      member({
        membershipTier: null,
        annualDuesUsd: null,
        engagementLevel: null,
        engagementScore: null,
        npsCategory: null,
        isAtRisk: false,
        renewalDate: null,
        renewalDuesUsd: null,
        lastEngagedDate: null,
        contributionCount: null,
        sponsorshipUsd: null,
        trainingEnrollmentCount: null,
        eventRegistrationCount: null,
      }),
    ]);

    expect(row).toMatchObject({
      npsLabel: null,
      npsClass: '',
      tierLabel: '—',
      duesLabel: '—',
      engagementLabel: '—',
      engagementDotClass: '',
      scoreLabel: '—',
      renewsLabel: '—',
      renewalDuesLabel: '—',
      lastEngagedLabel: '—',
    });
    expect(row.activity.every((cell) => cell.label === '—' && !cell.tracked)).toBe(true);
  });
});

describe('buildHealthMetricsMembersDirectorySummary', () => {
  it('counts the members and the at-risk ones', () => {
    expect(buildHealthMetricsMembersDirectorySummary(1_204, 12)).toBe('1,204 members · 12 at risk · highest dues first');
  });

  it('drops the at-risk part when none is at risk', () => {
    expect(buildHealthMetricsMembersDirectorySummary(1, 0)).toBe('1 member · highest dues first');
  });
});

describe('buildHealthMetricsMembersDirectorySearchPlaceholder', () => {
  it('sizes the placeholder to the foundation', () => {
    expect(buildHealthMetricsMembersDirectorySearchPlaceholder(725)).toBe('Search 725 members…');
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

describe('buildHealthMetricsMembersBridgeView', () => {
  const SIGN: Record<HealthMetricsMembersBridgeStepType, number> = { start_of_year: 1, new: 1, upgrade: 1, downgrade: -1, churned: -1, today: 1 };
  const ORDER: HealthMetricsMembersBridgeStepType[] = ['start_of_year', 'new', 'upgrade', 'downgrade', 'churned', 'today'];

  /** One year's six steps from its counts and dues, signed the way the model signs them. */
  const year = (
    value: number,
    counts: number[],
    dues: (number | null)[] = [800_000, 120_000, 89_000, 89_000, 40_000, 880_000]
  ): HealthMetricsMembersBridgeStep[] =>
    ORDER.map((movementType, index) => ({
      year: value,
      movementType,
      sortOrder: index + 1,
      isPartialYear: value === 2026,
      memberCount: counts[index],
      signedMemberCount: counts[index] * SIGN[movementType],
      revenueImpactUsd: dues[index] === null ? null : (dues[index] as number) * SIGN[movementType],
    }));

  // 41 + 7 + 1 − 3 − 2 = 44: reconciles. 2025's upgrade is counted but not in the end total.
  const BRIDGE: HealthMetricsMembersBridge = { steps: [...year(2026, [41, 7, 1, 3, 2, 44]), ...year(2025, [40, 3, 2, 1, 1, 41])] };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels the running year in the design order, ending on today', () => {
    const view = buildHealthMetricsMembersBridgeView(BRIDGE, 'YTD');

    expect(view.heading).toBe('How the base changed this year');
    expect(view.bars.map((bar) => bar.label)).toEqual(['Start of year', 'New', 'Upgrades', 'Downgrades', 'Churned', 'Today']);
    expect(view.bars.map((bar) => bar.countLabel)).toEqual(['41', '+7', '+1', '−3', '−2', '44']);
    expect(view.bars.map((bar) => bar.duesLabel)).toEqual(['$800K', '+$120K', '+$89K', '−$89K', '−$40K', '$880K']);
    expect(view.bars.map((bar) => bar.tone)).toEqual(['neutral', 'gain', 'gain', 'loss', 'loss', 'neutral']);
  });

  it('shows no note for a year that reconciles, and the recorded figures with a note for one that does not', () => {
    expect(buildHealthMetricsMembersBridgeView(BRIDGE, 'YTD').reconcileNote).toBeNull();

    const completed = buildHealthMetricsMembersBridgeView(BRIDGE, 'COMPLETED_YEAR');
    expect(completed.heading).toBe('How the base changed in 2025');
    expect(completed.bars.at(-1)?.label).toBe('End of 2025');
    expect(completed.bars.at(-1)?.countLabel).toBe('41');
    expect(completed.reconcileNote).toBe(
      "These figures don't reconcile: 40 at the start of the year plus the movements comes to 43, but 41 are recorded at the end of 2025. The bars show the recorded figures."
    );
  });

  it('floats each movement from the running total and stands the totals on zero', () => {
    const [start, added, upgraded, downgraded, churned, end] = buildHealthMetricsMembersBridgeView(BRIDGE, 'YTD').bars;
    const scale = 49 * 1.12;

    expect(start.bottomPct).toBe(0);
    expect(start.heightPct).toBeCloseTo((41 / scale) * 100);
    expect(added.bottomPct).toBeCloseTo((41 / scale) * 100);
    expect(upgraded.bottomPct).toBeCloseTo((48 / scale) * 100);
    expect(downgraded.bottomPct).toBeCloseTo((46 / scale) * 100);
    expect(downgraded.heightPct).toBeCloseTo((3 / scale) * 100);
    expect(churned.bottomPct).toBeCloseTo((44 / scale) * 100);
    expect(end.bottomPct).toBe(0);
    expect(end.heightPct).toBeCloseTo((44 / scale) * 100);
  });

  it('opens a list from the movements with members and sends churn to its section', () => {
    const bars = buildHealthMetricsMembersBridgeView(BRIDGE, 'YTD').bars;

    expect(bars.map((bar) => bar.listType)).toEqual([null, 'new', 'upgrade', 'downgrade', null, null]);
    expect(bars.map((bar) => bar.opensChurn)).toEqual([false, false, false, false, true, false]);
    expect(bars[1].ariaLabel).toBe('New: +7 members, +$120K in dues, opens the list');
    expect(bars[4].ariaLabel).toBe('Churned: −2 members, −$40K in dues, goes to churn');
  });

  it('leaves an empty movement inert and drops an unmeasured dues label', () => {
    const view = buildHealthMetricsMembersBridgeView({ steps: year(2026, [10, 0, 0, 0, 0, 10], [null, 0, null, null, null, null]) }, 'YTD');

    expect(view.bars.every((bar) => bar.listType === null && !bar.opensChurn)).toBe(true);
    expect(view.bars.map((bar) => bar.countLabel)).toEqual(['10', '0', '0', '0', '0', '10']);
    expect(view.bars.map((bar) => bar.duesLabel)).toEqual(['', '$0', '', '', '', '']);
    expect(view.reconcileNote).toBeNull();
  });

  it('does not check a year missing a total', () => {
    const steps = year(2026, [41, 7, 1, 3, 2, 44]).map((step) => (step.movementType === 'today' ? { ...step, memberCount: null } : step));
    const view = buildHealthMetricsMembersBridgeView({ steps }, 'YTD');

    expect(view.reconcileNote).toBeNull();
    expect(view.bars.at(-1)?.countLabel).toBe('—');
  });

  it('reports a period with no bridge while other years have one', () => {
    const view = buildHealthMetricsMembersBridgeView(BRIDGE, 'COMPLETED_YEAR_3');

    expect(view.measured).toBe(true);
    expect(view.yearMeasured).toBe(false);
    expect(view.bars).toEqual([]);
  });

  it('titles a drawer for the running year and for a past one', () => {
    expect(buildHealthMetricsMembersMovementDrawerTitle('new', 2026)).toBe('Joined this year');
    expect(buildHealthMetricsMembersMovementDrawerTitle('downgrade', 2025)).toBe('Moved down a tier in 2025');
  });
});

describe('buildHealthMetricsMembersMovementRows', () => {
  const movement = {
    accountId: '0014100000AcmeAAAA',
    accountName: 'Acme Motors',
    membershipTier: 'Gold',
    duesImpactUsd: 100_000,
    movementDate: '2026-04-02',
    lastEngagedDate: null,
  };

  it('puts the tier and movement date under the name and signs the dues by direction', () => {
    expect(buildHealthMetricsMembersMovementRows([movement], 'new')[0]).toEqual({
      accountId: '0014100000AcmeAAAA',
      accountName: 'Acme Motors',
      detail: 'Gold · joined Apr 2, 2026',
      duesLabel: '$100K',
      loss: false,
    });
    expect(buildHealthMetricsMembersMovementRows([movement], 'upgrade')[0].duesLabel).toBe('+$100K');

    const [down] = buildHealthMetricsMembersMovementRows([{ ...movement, duesImpactUsd: -89_000 }], 'downgrade');
    expect(down.duesLabel).toBe('−$89K');
    expect(down.detail).toBe('Gold · moved down Apr 2, 2026');
    expect(down.loss).toBe(true);
  });

  it('keeps a row with no tier, date or dues', () => {
    const [row] = buildHealthMetricsMembersMovementRows([{ ...movement, membershipTier: null, movementDate: null, duesImpactUsd: null }], 'new');

    expect(row.detail).toBe('No tier recorded');
    expect(row.duesLabel).toBe('');
  });
});

describe('buildHealthMetricsMembersMovementCountNote', () => {
  it('says nothing when the list matches its bar', () => {
    expect(buildHealthMetricsMembersMovementCountNote(7, 7)).toBeNull();
    expect(buildHealthMetricsMembersMovementCountNote(7, null)).toBeNull();
  });

  it('names both counts when they differ', () => {
    expect(buildHealthMetricsMembersMovementCountNote(6, 7)).toBe(
      '6 organizations listed, while the bar counts 7. The list and the bar are counted separately, so they can differ slightly.'
    );
  });
});
