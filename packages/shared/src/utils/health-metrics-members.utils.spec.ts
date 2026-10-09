// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_COLORS,
  HEALTH_METRICS_MEMBERS_TIERS_UNMEASURED,
} from '../constants/health-metrics-members.constants';
import {
  buildHealthMetricsMembersAtRiskAging,
  buildHealthMetricsMembersAtRiskCountLabel,
  buildHealthMetricsMembersAtRiskNote,
  buildHealthMetricsMembersAtRiskRows,
  buildHealthMetricsMembersAtRiskSummary,
  buildHealthMetricsMembersBoardCountLabel,
  buildHealthMetricsMembersBoardMeetingRows,
  buildHealthMetricsMembersBoardNote,
  buildHealthMetricsMembersBoardSummary,
  buildHealthMetricsMembersBoardTrend,
  buildHealthMetricsMembersBridgeView,
  buildHealthMetricsMembersChurnDepartureRows,
  buildHealthMetricsMembersChurnCountNote,
  buildHealthMetricsMembersChurnDeparturesSubtitle,
  buildHealthMetricsMembersChurnView,
  buildHealthMetricsMembersDirectoryRows,
  buildHealthMetricsMembersDirectorySearchPlaceholder,
  buildHealthMetricsMembersDirectorySummary,
  buildHealthMetricsMembersMovementCountNote,
  buildHealthMetricsMembersMovementDrawerTitle,
  buildHealthMetricsMembersMovementRows,
  buildHealthMetricsMembersNpsAudienceOptions,
  buildHealthMetricsMembersNpsSegments,
  buildHealthMetricsMembersNpsSummary,
  buildHealthMetricsMembersNpsTrend,
  buildHealthMetricsMembersNpsTrendNote,
  buildHealthMetricsMembersRenewalRows,
  buildHealthMetricsMembersRenewalsCountLabel,
  buildHealthMetricsMembersRenewalsSummary,
  buildHealthMetricsMembersSubNavItems,
  buildHealthMetricsMembersTiersView,
} from './health-metrics-members.utils';

import type {
  HealthMetricsMembersAtRiskMember,
  HealthMetricsMembersAtRiskSummary,
  HealthMetricsMembersBoardCohortSummary,
  HealthMetricsMembersBridge,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnTier,
  HealthMetricsMembersChurnYear,
  HealthMetricsMembersDirectoryMember,
  HealthMetricsMembersNpsAudience,
  HealthMetricsMembersNpsQuarter,
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
  it('notes only the sections that report a note', () => {
    const items = buildHealthMetricsMembersSubNavItems({}, { risk: '3 overdue · $120K' });

    expect(items.find((item) => item.key === 'risk')).toMatchObject({ count: null, note: '3 overdue · $120K' });
    expect(items.filter((item) => item.key !== 'risk').every((item) => item.note === '')).toBe(true);
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
  const row = (
    year: number,
    tier: string,
    sortRank: number,
    memberCount: number | null,
    revenueUsd: number | null,
    newMemberCount: number | null = 0,
    memberSharePct: number | null = null,
    revenueSharePct: number | null = null
  ) => ({
    year,
    tier,
    sortRank,
    memberCount,
    newMemberCount,
    revenueUsd,
    memberSharePct,
    revenueSharePct,
    isPartialYear: year === 2026,
  });
  const TIERS: HealthMetricsMembersTiers = {
    rows: [
      row(2024, 'Gold', 2, 10, 500_000),
      row(2024, 'Platinum', 1, 5, 1_000_000),
      row(2025, 'Gold', 2, 15, 750_000, 6, 75, 42.9),
      row(2025, 'Platinum', 1, 5, 1_000_000, 1, 25, 57.1),
      row(2025, 'Silver', 3, 0, 0, 0, 0, 0),
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
    const cellSum = view.tiers.reduce((sum, tier) => sum + (tier.cells[column].value ?? 0), 0);

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
    // The model's share is shown as-is; a year the tier is missing from has no share at all.
    expect(silver?.cells.map((cell) => cell.sharePct)).toEqual([null, 0, null]);
    expect(view.yearMeasured).toBe(false);
    expect(view.headline).toMatchObject({ value: '—', delta: 'not available' });
  });

  it('draws one tier in one year as a single full bar', () => {
    const view = buildHealthMetricsMembersTiersView(
      { rows: [row(2025, 'Member', 1, 4, 40_000, 0, 100, 100)], foundationRevenue: [] },
      'COMPLETED_YEAR',
      'members'
    );

    expect(view.tiers).toHaveLength(1);
    expect(view.tiers[0].cells).toEqual([{ year: 2025, value: 4, label: '4', sharePct: 100 }]);
    expect(view.metaLabel).toBe('1 tier · 1 year');
  });

  it('fills the cells with revenue and its share in revenue mode', () => {
    const view = buildHealthMetricsMembersTiersView(TIERS, 'COMPLETED_YEAR', 'revenue');
    const column = view.years.findIndex((year) => year.year === 2025);
    const gold = view.tiers.find((tier) => tier.tier === 'Gold');

    expect(gold?.cells[column]).toEqual({ year: 2025, value: 750_000, label: '$750K', sharePct: 42.9 });
    expect(view.tiers.find((tier) => tier.tier === 'Platinum')?.cells[column].sharePct).toBe(57.1);
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

describe('members at risk', () => {
  const summary: HealthMetricsMembersAtRiskSummary = {
    outstandingBalanceUsd: 120_000,
    highRiskBalanceUsd: 90_000,
    mediumRiskBalanceUsd: 30_000,
    memberCount: 3,
  };

  function atRiskMember(overrides: Partial<HealthMetricsMembersAtRiskMember> = {}): HealthMetricsMembersAtRiskMember {
    return {
      accountId: '0014100000AcmeRsk1',
      accountName: 'Acme Robotics',
      membershipTier: 'Gold Membership',
      outstandingBalanceUsd: 20_000,
      daysOverdue: 71,
      lastEngagedDate: '2026-03-04',
      churnRisk: 'High',
      agingBucket: '60_89_days',
      ...overrides,
    };
  }

  it('labels the hero in compact currency', () => {
    expect(buildHealthMetricsMembersAtRiskSummary(summary)).toEqual({
      outstandingLabel: '$120K',
      highRiskLabel: '$90K',
      mediumRiskLabel: '$30K',
      memberCountLabel: '3',
    });
    expect(
      buildHealthMetricsMembersAtRiskSummary({ outstandingBalanceUsd: null, highRiskBalanceUsd: null, mediumRiskBalanceUsd: 0, memberCount: null })
    ).toEqual({
      outstandingLabel: '—',
      highRiskLabel: '—',
      mediumRiskLabel: '$0',
      memberCountLabel: '—',
    });
  });

  it('sizes the aging bars against the largest bucket and leaves out an empty bucket', () => {
    const bars = buildHealthMetricsMembersAtRiskAging([
      { bucket: '60_89_days', memberCount: 2, balanceUsd: 30_000 },
      { bucket: '90_plus_days', memberCount: 1, balanceUsd: 90_000 },
    ]);

    expect(bars).toEqual([
      { bucket: '60_89_days', label: '60–89 days · 2 members', balanceLabel: '$30K', widthPct: (30_000 / 90_000) * 100 },
      { bucket: '90_plus_days', label: '90+ days · 1 member', balanceLabel: '$90K', widthPct: 100 },
    ]);
    expect(buildHealthMetricsMembersAtRiskAging([{ bucket: '60_89_days', memberCount: 0, balanceUsd: 0 }])).toEqual([]);
  });

  it('keeps an aging bar whose totals are unset, drawn empty with dashes', () => {
    expect(
      buildHealthMetricsMembersAtRiskAging([
        { bucket: '60_89_days', memberCount: null, balanceUsd: null },
        { bucket: '90_plus_days', memberCount: 1, balanceUsd: 90_000 },
      ])
    ).toEqual([
      { bucket: '60_89_days', label: '60–89 days · —', balanceLabel: '—', widthPct: 0 },
      { bucket: '90_plus_days', label: '90+ days · 1 member', balanceLabel: '$90K', widthPct: 100 },
    ]);
  });

  it('renders a row with its age in days, and dashes for missing values', () => {
    expect(buildHealthMetricsMembersAtRiskRows([atRiskMember()])[0]).toMatchObject({
      accountId: '0014100000AcmeRsk1',
      tierLabel: 'Gold Membership',
      overdueLabel: '$20K',
      ageLabel: '71 days',
      agingLabel: '60–89 days',
      churnRiskLabel: 'High risk',
      churnRiskClass: 'bg-red-50 text-red-700',
    });
    expect(
      buildHealthMetricsMembersAtRiskRows([
        atRiskMember({ membershipTier: null, outstandingBalanceUsd: null, daysOverdue: null, lastEngagedDate: null, churnRisk: null, agingBucket: null }),
      ])[0]
    ).toMatchObject({ tierLabel: '—', overdueLabel: '—', ageLabel: '—', lastEngagedLabel: '—', agingLabel: '—', churnRiskLabel: null, churnRiskClass: '' });
  });

  it('notes the overdue count and balance, and nothing while no member is at risk', () => {
    expect(buildHealthMetricsMembersAtRiskNote(summary)).toBe('3 overdue · $120K');
    expect(buildHealthMetricsMembersAtRiskNote({ ...summary, memberCount: 0 })).toBe('');
    expect(buildHealthMetricsMembersAtRiskNote({ ...summary, memberCount: null })).toBe('');
    expect(buildHealthMetricsMembersAtRiskNote({ ...summary, outstandingBalanceUsd: null })).toBe('');
  });

  it('pluralizes the member count', () => {
    expect(buildHealthMetricsMembersAtRiskCountLabel(1)).toBe('1 member');
    expect(buildHealthMetricsMembersAtRiskCountLabel(12)).toBe('12 members');
  });
});

describe('buildHealthMetricsMembersRenewalsSummary', () => {
  it('labels the value and count, with no note when every renewal has dues', () => {
    expect(buildHealthMetricsMembersRenewalsSummary({ renewalCount: 3, valueUsd: 185_000, withoutDuesCount: 0 })).toEqual({
      valueLabel: '$185K',
      renewalCountLabel: '3',
      coverageNote: '',
    });
  });

  it('notes the renewals without dues, since the value counts only the known dues', () => {
    expect(buildHealthMetricsMembersRenewalsSummary({ renewalCount: 4, valueUsd: 95_000, withoutDuesCount: 1 }).coverageNote).toBe(
      '1 renewal without dues on record, so the value counts only the known dues.'
    );
    expect(buildHealthMetricsMembersRenewalsSummary({ renewalCount: 4, valueUsd: null, withoutDuesCount: 4 })).toEqual({
      valueLabel: '—',
      renewalCountLabel: '4',
      coverageNote: '4 renewals without dues on record, so the value counts only the known dues.',
    });
  });

  it('dashes unset totals rather than showing zeros', () => {
    expect(buildHealthMetricsMembersRenewalsSummary({ renewalCount: null, valueUsd: null, withoutDuesCount: null })).toEqual({
      valueLabel: '—',
      renewalCountLabel: '—',
      coverageNote: '',
    });
  });
});

describe('buildHealthMetricsMembersRenewalRows', () => {
  it('formats the date and dues and keeps the balance marker', () => {
    expect(
      buildHealthMetricsMembersRenewalRows([
        {
          accountId: 'acct-1',
          accountName: 'Acme Studios',
          membershipTier: 'General',
          renewalDate: '2026-11-18',
          duesUsd: 20_000,
          hasOutstandingBalance: true,
          daysUntilRenewal: 40,
          hasRenewed: false,
        },
      ])
    ).toEqual([
      {
        accountId: 'acct-1',
        accountName: 'Acme Studios',
        tierLabel: 'General',
        renewalDateLabel: 'Nov 18, 2026',
        duesLabel: '$20K',
        hasOutstandingBalance: true,
        daysUntilLabel: 'In 40 days',
        hasRenewed: false,
      },
    ]);
  });

  it('dashes a missing tier, date or dues instead of $0', () => {
    const [row] = buildHealthMetricsMembersRenewalRows([
      {
        accountId: 'acct-2',
        accountName: 'Acme Labs',
        membershipTier: null,
        renewalDate: null,
        duesUsd: null,
        hasOutstandingBalance: false,
        daysUntilRenewal: null,
        hasRenewed: true,
      },
    ]);
    expect(row).toMatchObject({ tierLabel: '—', renewalDateLabel: '—', duesLabel: '—', hasOutstandingBalance: false, daysUntilLabel: '—', hasRenewed: true });
  });

  it('counts down to the renewal date, and dashes a date already past', () => {
    const labels = [0, 1, 12, -3].map(
      (daysUntilRenewal) =>
        buildHealthMetricsMembersRenewalRows([
          {
            accountId: 'acct-3',
            accountName: 'Acme Works',
            membershipTier: 'Gold',
            renewalDate: '2026-10-09',
            duesUsd: 10_000,
            hasOutstandingBalance: false,
            daysUntilRenewal,
            hasRenewed: false,
          },
        ])[0].daysUntilLabel
    );
    expect(labels).toEqual(['Today', 'In 1 day', 'In 12 days', '—']);
  });

  it('gives a renewed membership no countdown', () => {
    const [row] = buildHealthMetricsMembersRenewalRows([
      {
        accountId: 'acct-4',
        accountName: 'Acme Works',
        membershipTier: 'Gold',
        renewalDate: '2026-11-01',
        duesUsd: 10_000,
        hasOutstandingBalance: false,
        daysUntilRenewal: 23,
        hasRenewed: true,
      },
    ]);
    expect(row).toMatchObject({ daysUntilLabel: '—', hasRenewed: true });
  });
});

describe('buildHealthMetricsMembersRenewalsCountLabel', () => {
  it('pluralizes the renewal count', () => {
    expect(buildHealthMetricsMembersRenewalsCountLabel(1)).toBe('1 renewal');
    expect(buildHealthMetricsMembersRenewalsCountLabel(61)).toBe('61 renewals');
  });
});

function boardCohort(overrides: Partial<HealthMetricsMembersBoardCohortSummary> = {}): HealthMetricsMembersBoardCohortSummary {
  return {
    latestAttendancePct: 0.82,
    latestAttendedCount: 9,
    latestInvitedCount: 11,
    meetingsInRangeCount: 7,
    neverAttendedCount: 2,
    isBelowExpectedLevel: true,
    ...overrides,
  };
}

describe('buildHealthMetricsMembersBoardSummary', () => {
  it('renders the selected cohort with the other cohort beside it, flagging a level below expected', () => {
    expect(buildHealthMetricsMembersBoardSummary('board', boardCohort(), boardCohort({ latestAttendancePct: 0.646 }))).toEqual({
      meetingsLabel: '7 meetings in range',
      latestPctLabel: '82%',
      latestCaption: 'Last board meeting · below the ~100% this should be',
      isBelowExpectedLevel: true,
      otherCohortLabel: 'Voting members',
      otherCohortPctLabel: '65%',
      attendedInvitedLabel: '9 / 11',
      neverAttendedLabel: '2',
      neverAttendedCount: 2,
    });
  });

  it('drops the caution at the expected level and names the board as the other cohort', () => {
    const view = buildHealthMetricsMembersBoardSummary('voting_members', boardCohort({ isBelowExpectedLevel: false, neverAttendedCount: 0 }), null);
    expect(view).toMatchObject({
      latestCaption: 'Last voting meeting',
      isBelowExpectedLevel: false,
      otherCohortLabel: 'Board',
      otherCohortPctLabel: '—',
      neverAttendedCount: 0,
    });
  });

  it('clamps a share recorded above the invited count to 100%, as the table and chart do', () => {
    const view = buildHealthMetricsMembersBoardSummary('board', boardCohort({ latestAttendancePct: 1.09 }), boardCohort({ latestAttendancePct: 1.2 }));
    expect(view).toMatchObject({ latestPctLabel: '100%', otherCohortPctLabel: '100%' });
  });

  it('dashes every figure for a cohort with no meeting in the period', () => {
    const empty = boardCohort({
      latestAttendancePct: null,
      latestAttendedCount: null,
      latestInvitedCount: null,
      meetingsInRangeCount: null,
      neverAttendedCount: null,
      isBelowExpectedLevel: null,
    });
    expect(buildHealthMetricsMembersBoardSummary('board', empty, null)).toMatchObject({
      meetingsLabel: '—',
      latestPctLabel: '—',
      latestCaption: 'Last board meeting',
      isBelowExpectedLevel: false,
      attendedInvitedLabel: '—',
      neverAttendedLabel: '—',
      neverAttendedCount: 0,
    });
  });
});

describe('buildHealthMetricsMembersBoardMeetingRows', () => {
  it('renders a meeting with its rate bar tone', () => {
    expect(
      buildHealthMetricsMembersBoardMeetingRows([
        {
          meetingId: 'm-1',
          committeeName: 'Acme Board',
          meetingDate: '2026-09-18',
          attendedCount: 4,
          invitedCount: 11,
          attendancePct: 0.3636,
          isLatestMeeting: false,
        },
      ])
    ).toEqual([
      {
        meetingId: 'm-1',
        committeeName: 'Acme Board',
        dateLabel: 'Sep 18, 2026',
        attendedLabel: '4 / 11',
        ratePct: 36,
        rateLabel: '36%',
        rateFillClass: 'bg-amber-500',
      },
    ]);
  });

  it('dashes missing figures and greys an unmeasured rate', () => {
    const [row] = buildHealthMetricsMembersBoardMeetingRows([
      { meetingId: 'm-2', committeeName: null, meetingDate: null, attendedCount: null, invitedCount: 5, attendancePct: null, isLatestMeeting: false },
    ]);
    expect(row).toMatchObject({ committeeName: '—', dateLabel: '—', attendedLabel: '—', ratePct: null, rateLabel: '—', rateFillClass: 'bg-gray-300' });
  });
});

describe('buildHealthMetricsMembersBoardTrend', () => {
  it('labels each bar by its short date and whole percent', () => {
    expect(
      buildHealthMetricsMembersBoardTrend([
        {
          meetingId: 'm-1',
          committeeName: 'Acme Board',
          meetingDate: '2026-08-31',
          attendedCount: 9,
          invitedCount: 11,
          attendancePct: 0.818,
          isLatestMeeting: true,
        },
      ])
    ).toEqual([{ meetingId: 'm-1', label: 'Aug 31', dateLabel: 'Aug 31, 2026', committeeName: 'Acme Board', pct: 82, pctLabel: '82%', isLatest: true }]);
  });

  it('keeps an unmeasured bar null and clamps an out-of-range share', () => {
    const [unmeasured, over] = buildHealthMetricsMembersBoardTrend([
      { meetingId: 'm-2', committeeName: null, meetingDate: null, attendedCount: null, invitedCount: null, attendancePct: null, isLatestMeeting: false },
      {
        meetingId: 'm-3',
        committeeName: 'Acme Board',
        meetingDate: '2026-09-18',
        attendedCount: 12,
        invitedCount: 11,
        attendancePct: 1.09,
        isLatestMeeting: false,
      },
    ]);
    expect(unmeasured).toMatchObject({ label: '—', dateLabel: '—', committeeName: '—', pct: null, pctLabel: '—' });
    expect(over).toMatchObject({ pct: 100, pctLabel: '100%' });
  });
});

describe('buildHealthMetricsMembersBoardNote', () => {
  it('counts unused seats first', () => {
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 1 }))).toBe('1 seat unused');
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 3 }))).toBe('3 seats unused');
  });

  it('falls back to the latest share only when below the expected level', () => {
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 0 }))).toBe('82% attended');
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 0, isBelowExpectedLevel: false }))).toBe('');
    expect(buildHealthMetricsMembersBoardNote(null)).toBe('');
  });
});

describe('buildHealthMetricsMembersBoardCountLabel', () => {
  it('pluralizes the meeting count', () => {
    expect(buildHealthMetricsMembersBoardCountLabel(1)).toBe('1 meeting');
    expect(buildHealthMetricsMembersBoardCountLabel(12)).toBe('12 meetings');
  });
});

describe('members nps', () => {
  const audience = (overrides: Partial<HealthMetricsMembersNpsAudience> = {}): HealthMetricsMembersNpsAudience => ({
    audience: 'Board',
    npsScore: 62,
    scoreChangePp: 4,
    recipientsCount: 26,
    responsesCount: 18,
    responseRatePct: 0.692,
    promotersCount: 11,
    passivesCount: 5,
    detractorsCount: 2,
    noResponseCount: 8,
    isSampleTooSmall: false,
    lastUpdatedQuarter: 'Q2 2026',
    ...overrides,
  });
  const quarter = (
    quarterStartDate: string,
    npsScore: number | null,
    responseRatePct: number | null,
    isSampleTooSmall = false
  ): HealthMetricsMembersNpsQuarter => ({
    quarterStartDate,
    quarterLabel: `Q${Math.floor(Number(quarterStartDate.slice(5, 7)) / 3) + 1} ${quarterStartDate.slice(2, 4)}`,
    npsScore,
    responseRatePct,
    isSampleTooSmall,
  });

  it('builds the audience toggle in the read order', () => {
    expect(buildHealthMetricsMembersNpsAudienceOptions([audience(), audience({ audience: 'Committers' })])).toEqual([
      { id: 'Board', label: 'Board' },
      { id: 'Committers', label: 'Committers' },
    ]);
  });

  it('reports a sample it can trust with its change and the non-response footer', () => {
    expect(buildHealthMetricsMembersNpsSummary(audience())).toEqual({
      isWithheld: false,
      scoreLabel: '+62',
      changeLabel: '+4pp',
      changeDirection: 'up',
      caption: 'Net Promoter Score · board audience',
      respondedLabel: '18 of 26',
      rateLabel: '69%',
      isRateBelowFloor: false,
      lowSampleNote: null,
      lastUpdatedLabel: 'Last updated Q2 2026',
      surveyedLabel: 'out of 26 surveyed',
      footer: {
        isBelowFloor: false,
        lead: null,
        text: 'Non-responses are rendered as the grey segment so the sample size is visible without reading a caption.',
      },
    });
  });

  it('signs negative scores and changes, and leaves zero unsigned', () => {
    expect(buildHealthMetricsMembersNpsSummary(audience({ npsScore: -12, scoreChangePp: -3 }))).toMatchObject({
      scoreLabel: '−12',
      changeLabel: '−3pp',
      changeDirection: 'down',
    });
    expect(buildHealthMetricsMembersNpsSummary(audience({ npsScore: 0, scoreChangePp: 0 }))).toMatchObject({
      scoreLabel: '0',
      changeLabel: '0pp',
      changeDirection: 'neutral',
    });
    expect(buildHealthMetricsMembersNpsSummary(audience({ scoreChangePp: null }))).toMatchObject({ changeLabel: null, changeDirection: 'neutral' });
  });

  it('withholds a flagged sample and explains why', () => {
    expect(
      buildHealthMetricsMembersNpsSummary(
        audience({ npsScore: 80, recipientsCount: 24, responsesCount: 5, responseRatePct: 0.208, noResponseCount: 19, isSampleTooSmall: true })
      )
    ).toMatchObject({
      isWithheld: true,
      scoreLabel: '—',
      changeLabel: null,
      caption: 'Not enough responses to report a score',
      lowSampleNote: 'Only 5 of 24 responded (21%). Below the confidence threshold — the score is suppressed rather than shown as precise.',
      isRateBelowFloor: true,
      footer: { isBelowFloor: true, lead: '19 of 24 did not respond.', text: 'A score computed on 5 replies is not a foundation-wide signal.' },
    });
  });

  it('keeps the singular reply and dashes a missing audience', () => {
    expect(buildHealthMetricsMembersNpsSummary(audience({ responsesCount: 1, responseRatePct: 0.1 })).footer.text).toBe(
      'A score computed on 1 reply is not a foundation-wide signal.'
    );
    expect(buildHealthMetricsMembersNpsSummary(null)).toMatchObject({
      isWithheld: true,
      scoreLabel: '—',
      respondedLabel: '—',
      rateLabel: '—',
      lowSampleNote: null,
      lastUpdatedLabel: '',
      surveyedLabel: 'out of — surveyed',
    });
  });

  it('sizes each segment against everyone surveyed', () => {
    expect(
      buildHealthMetricsMembersNpsSegments(audience({ recipientsCount: 20, promotersCount: 10, passivesCount: 4, detractorsCount: 2, noResponseCount: 4 }))
    ).toEqual([
      { key: 'promoters', label: 'Promoters', countLabel: '10', widthPct: 50, colorClass: 'bg-emerald-600' },
      { key: 'passives', label: 'Passives', countLabel: '4', widthPct: 20, colorClass: 'bg-amber-600' },
      { key: 'detractors', label: 'Detractors', countLabel: '2', widthPct: 10, colorClass: 'bg-red-600' },
      { key: 'noResponse', label: 'No response', countLabel: '4', widthPct: 20, colorClass: 'bg-gray-200' },
    ]);
    expect(buildHealthMetricsMembersNpsSegments(null).map((segment) => [segment.countLabel, segment.widthPct])).toEqual([
      ['—', 0],
      ['—', 0],
      ['—', 0],
      ['—', 0],
    ]);
  });

  it('withholds a flagged wave score but keeps its rate', () => {
    expect(buildHealthMetricsMembersNpsTrend([quarter('2025-07-01', 54, 0.71), quarter('2026-04-01', 80, 0.21, true)])).toEqual([
      { quarterStartDate: '2025-07-01', label: 'Q3 25', score: 54, scoreLabel: '+54', ratePct: 71, rateLabel: '71%', isRateBelowFloor: false },
      { quarterStartDate: '2026-04-01', label: 'Q2 26', score: null, scoreLabel: 'Withheld', ratePct: 21, rateLabel: '21%', isRateBelowFloor: true },
    ]);
  });

  it('flags a rising score on a materially falling rate', () => {
    const points = buildHealthMetricsMembersNpsTrend([quarter('2024-10-01', 45, 0.55), quarter('2025-07-01', 54, 0.5), quarter('2026-01-01', 60, 0.45)]);
    expect(buildHealthMetricsMembersNpsTrendNote(points)).toEqual({
      kind: 'diverging',
      scoreChangeLabel: '15 points',
      fromRateLabel: '55%',
      toRateLabel: '45%',
    });
  });

  it('flags a rising score whose last reportable rate is below the floor', () => {
    const points = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.41), quarter('2025-07-01', 51, 0.39)]);
    expect(buildHealthMetricsMembersNpsTrendNote(points)).toMatchObject({ kind: 'diverging', scoreChangeLabel: '1 point' });
  });

  it('never says a rising rate fell, sending one still below the floor to the floor note', () => {
    const points = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.2), quarter('2025-07-01', 58, 0.3)]);
    expect(buildHealthMetricsMembersNpsTrendNote(points)).toEqual({ kind: 'below-floor', scoreChangeLabel: '', fromRateLabel: '', toRateLabel: '30%' });
  });

  it('says nothing about a rate that moved materially without a rising score', () => {
    const falling = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 60, 0.8), quarter('2025-07-01', 50, 0.5)]);
    const rising = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.45), quarter('2025-07-01', 58, 0.7)]);
    expect(buildHealthMetricsMembersNpsTrendNote(falling)).toBeNull();
    expect(buildHealthMetricsMembersNpsTrendNote(rising)).toBeNull();
  });

  it('compares reportable scores only, then judges the latest rate', () => {
    const points = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.7), quarter('2025-07-01', 55, 0.68), quarter('2026-01-01', 90, 0.3, true)]);
    expect(buildHealthMetricsMembersNpsTrendNote(points)).toEqual({ kind: 'below-floor', scoreChangeLabel: '', fromRateLabel: '', toRateLabel: '30%' });
  });

  it('calls a steady rate meaningful, and says nothing without two waves or a rate', () => {
    const steady = buildHealthMetricsMembersNpsTrend([quarter('2025-07-01', 54, 0.71), quarter('2026-01-01', 62, 0.69)]);
    expect(buildHealthMetricsMembersNpsTrendNote(steady)).toEqual({ kind: 'holding', scoreChangeLabel: '', fromRateLabel: '', toRateLabel: '69%' });
    expect(buildHealthMetricsMembersNpsTrendNote(buildHealthMetricsMembersNpsTrend([quarter('2026-01-01', 62, 0.69)]))).toBeNull();
    expect(
      buildHealthMetricsMembersNpsTrendNote(buildHealthMetricsMembersNpsTrend([quarter('2025-07-01', 54, null), quarter('2026-01-01', 62, null)]))
    ).toBeNull();
  });
});

describe('members churn', () => {
  const churnYear = (year: number, overrides: Partial<HealthMetricsMembersChurnYear> = {}): HealthMetricsMembersChurnYear => ({
    year,
    isPartialYear: year === 2026,
    lostCount: 12,
    openingCount: 120,
    duesLostUsd: 1_500_000,
    duesLostPriorUsd: 900_000,
    revenueChurnRate: 16,
    revenueChurnRatePrior: 11.4,
    revenueChurnRateChangePp: 4.6,
    logoChurnRate: 10,
    ...overrides,
  });
  const tier = (year: number, name: string, rank: number, lost: number, dues: number, share: number, rate = 10): HealthMetricsMembersChurnTier => ({
    year,
    tier: name,
    tierSortRank: rank,
    lostCount: lost,
    churnRate: rate,
    duesLostUsd: dues,
    shareOfLossPct: share,
  });
  const CHURN: HealthMetricsMembersChurn = {
    years: [
      churnYear(2026),
      churnYear(2025, { logoChurnRate: 12.5, revenueChurnRate: 11.4 }),
      churnYear(2024, { revenueChurnRate: 8 }),
      churnYear(2023, { revenueChurnRate: 6 }),
      churnYear(2022, { revenueChurnRate: 5 }),
    ],
    tiers: [
      tier(2026, 'Gold', 1, 2, 1_000_000, 66.7, 40),
      tier(2026, 'Silver', 2, 10, 500_000, 33.3, 25),
      tier(2026, 'Bronze', 3, 0, 0, 0, 0),
      tier(2026, 'Associate', 4, 1, 4_000, 0.3, 2),
      tier(2025, 'Gold', 1, 1, 400_000, 100),
    ],
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the revenue hero, meta line and sides for the running year', () => {
    const view = buildHealthMetricsMembersChurnView(CHURN, 'YTD', 'revenue');

    expect(view).toMatchObject({
      measured: true,
      yearMeasured: true,
      year: 2026,
      hasChurn: true,
      lostCount: 12,
      metaLabel: '12 of 120 memberships lost',
      heroLabel: '16%',
      changeLabel: '+4.6pp vs 2025',
      changeTone: 'bad',
      caption: "of last year's dues did not renew",
      trendTitle: 'Revenue churn trend',
    });
    expect(view.sides).toEqual([
      { key: 'dues-lost', label: 'Dues lost this year', value: '$1.5M', note: null, isLoss: true },
      { key: 'dues-lost-prior', label: 'Dues lost last year', value: '$900K', note: null, isLoss: false },
      { key: 'logo', label: 'Logo churn', value: '10%', note: '(12 of 120)', isLoss: false },
    ]);
  });

  it('derives the logo change from the year before and swaps in the revenue rate', () => {
    const view = buildHealthMetricsMembersChurnView(CHURN, 'YTD', 'logo');

    expect(view.heroLabel).toBe('10%');
    expect(view.changeLabel).toBe('−2.5pp vs 2025');
    expect(view.changeTone).toBe('good');
    expect(view.caption).toBe('of the memberships held at the start of the year lapsed');
    expect(view.sides[2]).toEqual({ key: 'revenue', label: 'Revenue churn', value: '16%', note: null, isLoss: false });
    expect(view.trendSubtitle).toBe('share of memberships lost, by year');
  });

  it('names past years and shows no change when the year before is not in the read', () => {
    const view = buildHealthMetricsMembersChurnView(CHURN, 'COMPLETED_YEAR_4', 'revenue');

    expect(view.year).toBe(2022);
    expect(view.changeLabel).toBeNull();
    expect(view.changeTone).toBe('neutral');
    expect(view.caption).toBe("of 2021's dues did not renew");
    expect(view.sides.map((side) => side.label)).toEqual(['Dues lost in 2022', 'Dues lost in 2021', 'Logo churn']);
  });

  it('orders tiers by dues lost, flags high rates and keeps a stub only for a non-zero share', () => {
    const { tiers } = buildHealthMetricsMembersChurnView(CHURN, 'YTD', 'revenue');

    expect(tiers.map((row) => row.tier)).toEqual(['Gold', 'Silver', 'Associate', 'Bronze']);
    expect(tiers.map((row) => row.isHighRate)).toEqual([true, true, false, false]);
    expect(tiers.map((row) => row.shareWidthPct)).toEqual([66.7, 33.3, 1, 0]);
    expect(tiers.map((row) => row.shareLabel)).toEqual(['67%', '33%', '<1%', '0%']);
    expect(tiers[0]).toMatchObject({ lostLabel: '2', rateLabel: '40%', duesLabel: '$1M', shareLabel: '67%' });
  });

  it('notes the inversion when the tier losing most members is not the one losing most dues', () => {
    expect(buildHealthMetricsMembersChurnView(CHURN, 'YTD', 'revenue').inversion).toEqual({
      countLead: 'Silver lost 10 memberships',
      duesLead: 'Gold lost the money',
      text: "2 Gold departures cost $1M against Silver's $500K. That inversion is the whole argument for leading on revenue churn rather than logo churn.",
    });
  });

  it('skips the inversion when one tier leads both, or a lead is tied', () => {
    expect(buildHealthMetricsMembersChurnView(CHURN, 'COMPLETED_YEAR', 'revenue').inversion).toBeNull();

    const tied: HealthMetricsMembersChurn = {
      years: [churnYear(2026)],
      tiers: [tier(2026, 'Gold', 1, 5, 1_000_000, 50), tier(2026, 'Silver', 2, 5, 900_000, 50)],
    };
    expect(buildHealthMetricsMembersChurnView(tied, 'YTD', 'revenue').inversion).toBeNull();
  });

  it('plots the trend window ending at the selected year and warns when churn rose', () => {
    const view = buildHealthMetricsMembersChurnView(CHURN, 'YTD', 'revenue');

    expect(view.trend.map((point) => [point.label, point.valueLabel, point.isSelected])).toEqual([
      ['2023', '6%', false],
      ['2024', '8%', false],
      ['2025', '11%', false],
      ['2026', '16%', true],
    ]);
    expect(view.trendRose).toBe(true);
    expect(buildHealthMetricsMembersChurnView(CHURN, 'YTD', 'logo').trendRose).toBe(false);
  });

  it("colours the trend off the hero's change, not the two years' rates", () => {
    const falling: HealthMetricsMembersChurn = {
      years: [churnYear(2026, { revenueChurnRate: 16, revenueChurnRateChangePp: -1.2 }), churnYear(2025, { revenueChurnRate: 11.4 })],
      tiers: [],
    };
    expect(buildHealthMetricsMembersChurnView(falling, 'YTD', 'revenue')).toMatchObject({ changeTone: 'good', trendRose: false });
  });

  it('reports no churn for a year that lost nothing, and an unread year as unmeasured', () => {
    const quiet: HealthMetricsMembersChurn = { years: [churnYear(2026, { lostCount: 0, openingCount: null })], tiers: [] };
    expect(buildHealthMetricsMembersChurnView(quiet, 'YTD', 'revenue')).toMatchObject({ hasChurn: false, metaLabel: '0 memberships lost' });

    expect(buildHealthMetricsMembersChurnView(CHURN, 'COMPLETED_YEAR_3', 'revenue').yearMeasured).toBe(true);
    const unmeasured: HealthMetricsMembersChurn = { years: [churnYear(2026, { lostCount: null })], tiers: [] };
    expect(buildHealthMetricsMembersChurnView(unmeasured, 'YTD', 'revenue')).toMatchObject({ yearMeasured: false, hasChurn: false });
    expect(buildHealthMetricsMembersChurnView({ years: [], tiers: [] }, 'YTD', 'revenue')).toMatchObject({
      measured: false,
      yearMeasured: false,
      hasChurn: false,
      heroLabel: '—',
      inversion: null,
      trend: [],
    });
  });

  it('builds departure rows with a dash for what the model does not have', () => {
    expect(
      buildHealthMetricsMembersChurnDepartureRows([
        {
          accountId: 'acct-1',
          accountName: 'Acme Motors',
          membershipTier: 'Gold',
          duesLostUsd: 250_000,
          lapsedDate: '2026-03-31',
          lastEngagedDate: null,
        },
        { accountId: 'acct-2', accountName: 'Vendor Corp', membershipTier: null, duesLostUsd: null, lapsedDate: null, lastEngagedDate: '2025-11-02' },
      ])
    ).toEqual([
      { accountId: 'acct-1', accountName: 'Acme Motors', tierLabel: 'Gold', duesLabel: '$250K', lapsedLabel: 'Mar 31, 2026', lastEngagedLabel: '—' },
      { accountId: 'acct-2', accountName: 'Vendor Corp', tierLabel: '—', duesLabel: '—', lapsedLabel: '—', lastEngagedLabel: 'Nov 2, 2025' },
    ]);
  });

  it('claims the churn count only when the list matches it', () => {
    expect(buildHealthMetricsMembersChurnDeparturesSubtitle(12, 12)).toBe('largest dues lost first · the same 12 as lost above');
    expect(buildHealthMetricsMembersChurnDeparturesSubtitle(11, 12)).toBe('largest dues lost first');
  });

  it('notes a gap between the list and the churn count only when they differ', () => {
    expect(buildHealthMetricsMembersChurnCountNote(12, 12)).toBeNull();
    expect(buildHealthMetricsMembersChurnCountNote(11, 12)).toBe(
      '11 organizations listed, while churn counts 12 lost. The list and the churn count are counted separately, so they can differ slightly.'
    );
  });
});
