// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lfxColors } from '../constants/colors.constants';
import { HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import {
  buildHealthMetricsMembersAtRiskMetrics,
  buildHealthMetricsMembersAtRiskNote,
  buildHealthMetricsMembersAtRiskRows,
  buildHealthMetricsMembersBoardMeetingRows,
  buildHealthMetricsMembersBoardNote,
  buildHealthMetricsMembersBoardSummary,
  buildHealthMetricsMembersBoardTrend,
  buildHealthMetricsMembersBreakdownView,
  buildHealthMetricsMembersChurnDepartureRows,
  buildHealthMetricsMembersChurnView,
  buildHealthMetricsMembersDirectoryRows,
  buildHealthMetricsMembersGrowthView,
  buildHealthMetricsMembersNpsAudienceOptions,
  buildHealthMetricsMembersNpsSegments,
  buildHealthMetricsMembersNpsSummary,
  buildHealthMetricsMembersNpsTrend,
  buildHealthMetricsMembersNpsTrendNote,
  buildHealthMetricsMembersRenewalRows,
  buildHealthMetricsMembersRenewalsMetrics,
  buildHealthMetricsMembersSections,
  buildHealthMetricsMembersSubNavItems,
  parseHealthMetricsMembersAtRiskFilter,
  parseHealthMetricsMembersRenewalsWindow,
} from './health-metrics-members.utils';
import { healthMetricsRowSortValue, resolveHealthMetricsMembersTier, sortHealthMetricsRows } from './health-metrics-table.utils';

import type {
  HealthMetricsMembersAtRisk,
  HealthMetricsMembersAtRiskMember,
  HealthMetricsMembersBoardCohortSummary,
  HealthMetricsMembersBoardMeeting,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnTier,
  HealthMetricsMembersChurnTierSortKey,
  HealthMetricsMembersChurnYear,
  HealthMetricsMembersDirectoryMember,
  HealthMetricsMembersGrowthMonth,
  HealthMetricsMembersNpsAudience,
  HealthMetricsMembersNpsQuarter,
  HealthMetricsMembersTierYear,
} from '../interfaces/health-metrics-members.interface';
import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';

describe('buildHealthMetricsMembersSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsMembersSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.label));
  });

  it('renders no note while no section reports one', () => {
    expect(buildHealthMetricsMembersSubNavItems().every((item) => item.note === '')).toBe(true);
  });

  it('notes only the sections that report a note', () => {
    const items = buildHealthMetricsMembersSubNavItems({ risk: '3 overdue · $120K' });

    expect(items.find((item) => item.key === 'risk')?.note).toBe('3 overdue · $120K');
    expect(items.filter((item) => item.key !== 'risk').every((item) => item.note === '')).toBe(true);
  });
});

describe('buildHealthMetricsMembersDirectoryRows', () => {
  const member: HealthMetricsMembersDirectoryMember = {
    accountId: 'a-1',
    accountName: 'Acme Corp',
    logoUrl: 'https://logos.example/acme.png',
    membershipTier: 'Platinum Membership',
    annualDuesUsd: 120000,
    engagementLevel: 'Low',
    engagementScore: 2.34,
    npsCategory: 'Promoter',
    npsScore: 9,
    isAtRisk: true,
    renewalDate: '2027-03-31',
    renewalDuesUsd: 100000,
    lastEngagedDate: '2026-09-14',
    contributionCount: 12,
    sponsorshipUsd: 25000.4,
    trainingEnrollmentCount: 0,
    eventRegistrationCount: null,
  };

  it('leads with the company, its NPS line and the at-risk flag, then the tier, the renewal and the sponsorship', () => {
    expect(buildHealthMetricsMembersDirectoryRows([member])[0]).toMatchObject({
      accountId: 'a-1',
      name: 'Acme Corp',
      logoUrl: 'https://logos.example/acme.png',
      isAtRisk: true,
      npsLabel: 'Promoter · NPS 9',
      npsIconClass: 'fa-solid fa-circle-small text-emerald-500',
      membershipLabel: 'Platinum',
      tier: 'platinum',
      renewalLabel: 'Mar 31, 2027',
      renewalDuesLabel: '$100K dues',
      sponsorshipLabel: '$25K',
    });
  });

  it('opens a Level-and-score badge whose popup reads a zero or untracked count as a dash', () => {
    expect(buildHealthMetricsMembersDirectoryRows([member])[0].engagement).toEqual({
      label: 'Low 2.3',
      badgeClass: 'bg-red-50 text-red-700',
      tip: {
        title: 'Low engagement · 2.3',
        rows: [
          { label: 'Contribution', value: '12', color: null, separated: false },
          { label: 'Training', value: '—', color: null, separated: false },
          { label: 'Events', value: '—', color: null, separated: false },
          { label: 'Last engaged', value: 'Sep 14, 2026', color: null, separated: false },
        ],
      },
    });
  });

  it('reads a member with nothing on record as dashes, with no badge and the gray "No NPS response" dot', () => {
    const [row] = buildHealthMetricsMembersDirectoryRows([
      {
        ...member,
        membershipTier: null,
        engagementLevel: null,
        npsCategory: null,
        npsScore: null,
        isAtRisk: false,
        renewalDate: null,
        renewalDuesUsd: null,
        sponsorshipUsd: 0,
      },
    ]);

    expect(row).toMatchObject({
      npsLabel: 'No NPS response',
      npsIconClass: 'fa-solid fa-circle-small text-gray-300',
      membershipLabel: '—',
      tier: null,
      renewalLabel: '—',
      renewalDuesLabel: '',
      sponsorshipLabel: '—',
      engagement: null,
    });
  });

  it('shows the category alone without a score, renewal dues only when they differ, and an unreserved tier without an icon', () => {
    const [row] = buildHealthMetricsMembersDirectoryRows([
      { ...member, npsCategory: 'Detractor', npsScore: null, renewalDuesUsd: 120000, membershipTier: 'Associate Member', engagementScore: null },
    ]);

    expect(row).toMatchObject({
      npsLabel: 'Detractor',
      npsIconClass: 'fa-solid fa-circle-small text-red-400',
      renewalDuesLabel: '',
      membershipLabel: 'Associate',
      tier: null,
    });
    expect(row.engagement).toMatchObject({ label: 'Low', tip: { title: 'Low engagement' } });
  });
});

describe('resolveHealthMetricsMembersTier', () => {
  it.each([
    ['Gold Membership', 'Gold', 'gold'],
    ['DIAMOND', 'Diamond', 'diamond'],
    ['  Silver Member ', 'Silver', 'silver'],
    ['End User Supporter', 'End User Supporter', null],
    ['Membership', 'Membership', null],
  ])('reads %s as %s', (raw, label, reserved) => {
    expect(resolveHealthMetricsMembersTier(raw)).toEqual({ label, reserved });
  });
});

describe('buildHealthMetricsMembersBreakdownView', () => {
  const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  /** One row per year for a tier, from counts in year order; revenue is a thousand dollars a member. */
  const tier = (name: string, sortRank: number, counts: number[]): HealthMetricsMembersTierYear[] =>
    counts.map((count, index) => ({
      year: YEARS[index],
      tier: name,
      sortRank,
      memberCount: count,
      revenueUsd: count * 1000,
    }));
  const build = (rows: HealthMetricsMembersTierYear[]) => buildHealthMetricsMembersBreakdownView({ rows });
  const PGS = [
    ...tier('Platinum Membership', 1, [110, 118, 124, 131, 138, 142, 150, 158]),
    ...tier('Gold Membership', 2, [210, 224, 240, 262, 270, 281, 296, 322]),
    ...tier('Silver Membership', 3, [630, 692, 882, 989, 959, 992, 1081, 1365]),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tables every tier in rank order under its plain name, then the totals', () => {
    const view = build([
      ...tier('Associate Membership', 4, [82, 113, 168, 204, 236, 298, 362, 440]),
      ...PGS,
      ...tier('Diamond Membership', 0, [60, 61, 62, 63, 64, 65, 66, 67]),
    ]);

    expect(view.columns.map((column) => column.label)).toEqual(['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026 YTD']);
    expect(view.rows.map((row) => [row.label, row.kind, row.icon, row.striped])).toEqual([
      ['Diamond', 'tier', 'diamond', false],
      ['Platinum', 'tier', 'platinum', true],
      ['Gold', 'tier', 'gold', false],
      ['Silver', 'tier', 'silver', true],
      ['Associate', 'tier', null, false],
      ['Total members', 'total', null, false],
      ['Total revenue', 'total', null, false],
    ]);
    expect(view.rows[1].cells).toEqual(['110', '118', '124', '131', '138', '142', '150', '158']);
    expect(view.rows[5].cells[7]).toBe('2,352');
    expect(view.rows[6].cells[7]).toBe('$2.4M');
  });

  it('keeps a foundation’s own tiers, without grouping any as Others', () => {
    const view = build([
      ...tier('Premier', 1, [10, 11, 12, 13, 14, 15, 16, 17]),
      ...tier('General', 2, [40, 41, 42, 43, 44, 45, 46, 47]),
      ...tier('Associate', 3, [5, 5, 5, 5, 5, 5, 5, 5]),
      ...tier('Academic', 4, [2, 2, 2, 2, 2, 2, 2, 2]),
    ]);

    expect(view.rows.filter((row) => row.kind === 'tier').map((row) => row.label)).toEqual(['Premier', 'General', 'Associate', 'Academic']);
    expect(view.rows.some((row) => row.label === 'Others')).toBe(false);
  });

  it('drops tiers with no member in any year shown', () => {
    const rows = [...PGS, ...tier('Former', 9, [0, 0, 0, 0, 0, 0, 0, 0])];

    expect(build(rows).rows.map((row) => row.label)).not.toContain('Former');
  });

  it('keeps a measured zero as measured, with zero totals', () => {
    const view = build(tier('Platinum Membership', 1, [0, 0, 0, 0, 0, 0, 0, 0]));

    expect(view.measured).toBe(true);
    expect(view.rows.find((row) => row.key === 'members')?.cells[7]).toBe('0');
  });

  it('gives a tier the reserved icon only for the reserved name itself', () => {
    const view = build([...tier('Gold Legacy Membership', 1, [1, 1, 1, 1, 1, 1, 1, 1]), ...tier('Silver Member', 2, [2, 2, 2, 2, 2, 2, 2, 2])]);

    expect(view.rows.filter((row) => row.kind === 'tier').map((row) => [row.label, row.icon])).toEqual([
      ['Gold Legacy', null],
      ['Silver', 'silver'],
    ]);
  });

  it('ignores rows before the first year shown', () => {
    expect(build([{ year: 2018, tier: 'Gold', sortRank: 1, memberCount: 5, revenueUsd: 5000 }]).measured).toBe(false);
  });

  it('starts at a later first year, and is unmeasured with no rows', () => {
    const view = build(tier('Gold', 1, [0, 0, 0, 0, 0, 5, 6, 7]).slice(5));

    expect(view.columns.map((column) => column.year)).toEqual([2024, 2025, 2026]);
    expect(build([])).toEqual({ measured: false, columns: [], rows: [] });
  });
});

describe('buildHealthMetricsMembersGrowthView', () => {
  // Nov 6, 2026: this year runs through November.
  const TODAY = new Date(2026, 10, 6);
  const YEARS: Record<number, number[]> = {
    2017: [3, 12, 21, 38, 89, 105, 124, 132, 153, 175, 209, 232],
    2018: [40, 82, 125, 163, 189, 215, 252, 301, 344, 376, 404, 433],
    2019: [30, 60, 100, 130, 160, 192, 217, 249, 275, 305, 335, 359],
    2024: [45, 85, 120, 160, 190, 225, 262, 300, 350, 385, 420, 453],
    2025: [38, 70, 105, 150, 175, 215, 287, 306, 340, 375, 410, 480],
    2026: [74, 123, 184, 244, 293, 350, 408, 458, 523, 725, 801, 0],
  };

  function months(years: Record<number, (number | null)[]> = YEARS): HealthMetricsMembersGrowthMonth[] {
    return Object.entries(years).flatMap(([year, values]) => values.map((cumulative, index) => ({ year: Number(year), month: index + 1, cumulative })));
  }

  const build = (range: HealthMetricsRange = 'YTD', years?: Record<number, (number | null)[]>, today = TODAY) =>
    buildHealthMetricsMembersGrowthView({ months: months(years) }, range, today);

  it('draws one line per measured year, oldest first, in the newest-first palette', () => {
    const lines = build().lines;

    expect(lines.map((line) => line.year)).toEqual([2017, 2018, 2019, 2024, 2025, 2026]);
    expect(lines.map((line) => line.color)).toEqual([
      lfxColors.red[300],
      lfxColors.amber[300],
      lfxColors.emerald[300],
      lfxColors.emerald[400],
      lfxColors.violet[400],
      lfxColors.blue[500],
    ]);
  });

  it('draws only the period’s year solid', () => {
    expect(
      build()
        .lines.filter((line) => !line.dashed)
        .map((line) => line.year)
    ).toEqual([2026]);
    expect(
      build('COMPLETED_YEAR')
        .lines.filter((line) => !line.dashed)
        .map((line) => line.year)
    ).toEqual([2025]);
    // A period with no line of its own leaves every line dashed.
    expect(build('COMPLETED_YEAR_3').lines.every((line) => line.dashed)).toBe(true);
  });

  it('stops this year at today’s month and labels every point', () => {
    const lines = build().lines;
    const current = lines[lines.length - 1];

    expect(current.points).toHaveLength(11);
    expect(current.points[10].label).toBe('801');
    expect(lines[0].points.map((point) => point.label)).toEqual(YEARS[2017].map(String));
  });

  it('scales to a round top over the highest total and places January and December inside the plot', () => {
    const view = build();
    const current = view.lines[view.lines.length - 1];

    expect(view.yMax).toBe('1,000');
    expect(current.points[0].leftPct).toBe(4);
    expect(current.points[10].leftPct).toBeCloseTo(4 + (92 / 11) * 10, 5);
    // 801 of 1,000 sits 19.9% from the top.
    expect(current.points[10].topPct).toBeCloseTo(19.9, 5);
    expect(current.d.startsWith('M40 ')).toBe(true);
    expect(current.d.match(/C/g)).toHaveLength(10);
  });

  it('keeps every curve segment between its two totals, even a flat month before a jump', () => {
    const view = build('YTD', { 2025: [0, 0, 100, 100, 100, 500, 500, 500, 500, 500, 500, 500], 2026: [1] }, new Date(2026, 0, 1));
    const numbers = view.lines[0].d.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number);
    // After the move, each cubic is two handles and an end point: its handles' y must sit within its two ends' y.
    let start = numbers[1];
    for (let index = 2; index < numbers.length; index += 6) {
      const [, y1, , y2, , end] = numbers.slice(index, index + 6);
      const [low, high] = [Math.min(start, end), Math.max(start, end)];
      expect(y1).toBeGreaterThanOrEqual(low);
      expect(y1).toBeLessThanOrEqual(high);
      expect(y2).toBeGreaterThanOrEqual(low);
      expect(y2).toBeLessThanOrEqual(high);
      start = end;
    }
  });

  it('lists each month’s years newest first, leaving out this year past today', () => {
    const columns = build().columns;

    expect(columns).toHaveLength(12);
    expect(columns[10].tip.title).toBe('November');
    expect(columns[10].tip.rows.map((row) => [row.label, row.value])).toEqual([
      ['2026', '801'],
      ['2025', '410'],
      ['2024', '420'],
      ['2019', '335'],
      ['2018', '404'],
      ['2017', '209'],
    ]);
    expect(columns[11].tip.rows[0].label).toBe('2025');
    expect(columns[10].ariaLabel).toBe('November. 2026: 801, 2025: 410, 2024: 420, 2019: 335, 2018: 404, 2017: 209');
    expect(columns[0].widthPct).toBeCloseTo(92 / 11, 5);
  });

  it('treats a year with no measured month as missing and carries gaps forward', () => {
    const view = build('YTD', { 2024: Array(12).fill(null), 2025: [5, null, 9, ...Array(9).fill(9)], 2026: [1, 2] }, new Date(2026, 1, 1));

    expect(view.lines.map((line) => line.year)).toEqual([2025, 2026]);
    expect(view.lines[0].points.slice(0, 3).map((point) => point.label)).toEqual(['5', '5', '9']);
    expect(view.ariaLabel).toBe('Cumulative new members by month, one line per year, 2025 to 2026');
  });

  it('draws at most one line per colour, dropping the oldest years', () => {
    const years = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [2015 + index, Array(12).fill(index + 1)]));
    const view = build('YTD', years);

    expect(view.lines.map((line) => line.year)).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(view.lines[0].color).toBe(lfxColors.red[300]);
  });

  it('is unmeasured when no year has a measured month', () => {
    expect(build('YTD', { 2026: [null, null] }).measured).toBe(false);
    expect(build('YTD', {}).lines).toEqual([]);
  });
});

describe('buildHealthMetricsMembersSections', () => {
  it('names the running year in the breakdown description', () => {
    const breakdown = buildHealthMetricsMembersSections(2026).find((section) => section.key === 'breakdown')!;

    expect(breakdown.description).toBe('Members per tier at each year end. 2026 is year to date.');
  });
});

describe('members at risk', () => {
  const response: HealthMetricsMembersAtRisk = {
    rows: [],
    totalRecords: 3,
    summary: { outstandingBalanceUsd: 120_000, memberCount: 3 },
    aging: [
      { bucket: '60_89_days', memberCount: 2, balanceUsd: 30_000 },
      { bucket: '90_plus_days', memberCount: 1, balanceUsd: 90_000 },
    ],
  };

  function atRiskMember(overrides: Partial<HealthMetricsMembersAtRiskMember> = {}): HealthMetricsMembersAtRiskMember {
    return {
      accountId: '0014100000AcmeRsk1',
      accountName: 'Acme Robotics',
      logoUrl: 'https://logos.example/acme.png',
      membershipTier: 'Gold Membership',
      outstandingBalanceUsd: 20_000,
      daysOverdue: 71,
      lastEngagedDate: '2026-03-04',
      churnRisk: 'High',
      agingBucket: '60_89_days',
      ...overrides,
    };
  }

  it('reads the balance with its members, then High risk (90+ days) and Medium risk (60–89), each with its dot and tip', () => {
    expect(buildHealthMetricsMembersAtRiskMetrics(response, 'all')).toEqual([
      { key: 'outstanding', label: 'Outstanding balance', value: '$120K', description: '3 members at risk' },
      {
        key: '90_plus_days',
        label: 'High risk',
        value: '$90K',
        description: '1 member',
        dotClass: 'bg-red-400',
        tip: 'Dues overdue for 90 days or more. These members are the most likely to churn.',
      },
      {
        key: '60_89_days',
        label: 'Medium risk',
        value: '$30K',
        description: '2 members',
        dotClass: 'bg-amber-400',
        tip: 'Dues overdue for 60 to 89 days. Still recoverable with a timely follow-up.',
      },
    ]);
  });

  it('shows only the outstanding balance, for that bucket, with one bucket switched on', () => {
    expect(buildHealthMetricsMembersAtRiskMetrics(response, '90_plus_days')).toEqual([
      { key: 'outstanding', label: 'Outstanding balance', value: '$90K', description: '1 member at risk' },
    ]);
  });

  it('dashes unset totals rather than showing zeros', () => {
    const unset: HealthMetricsMembersAtRisk = {
      ...response,
      summary: { outstandingBalanceUsd: null, memberCount: null },
      aging: [{ bucket: '60_89_days', memberCount: null, balanceUsd: null }],
    };
    expect(buildHealthMetricsMembersAtRiskMetrics(unset, 'all').map((item) => [item.value, item.description])).toEqual([
      ['—', '— at risk'],
      ['—', '—'],
      ['—', '—'],
    ]);
  });

  it('renders a row with its logo, last engaged date, tier icon and a dotted age, and dashes for missing values', () => {
    expect(buildHealthMetricsMembersAtRiskRows([atRiskMember()])[0]).toEqual({
      accountId: '0014100000AcmeRsk1',
      name: 'Acme Robotics',
      logoUrl: 'https://logos.example/acme.png',
      lastEngagedLabel: 'Last engaged Mar 4, 2026',
      membershipLabel: 'Gold',
      tier: 'gold',
      overdueLabel: '$20K',
      ageLabel: '71 days',
      ageDotClass: 'bg-amber-400',
    });
    expect(buildHealthMetricsMembersAtRiskRows([atRiskMember({ agingBucket: '90_plus_days', daysOverdue: 120 })])[0]).toMatchObject({
      ageLabel: '120 days',
      ageDotClass: 'bg-red-400',
    });
    expect(
      buildHealthMetricsMembersAtRiskRows([
        atRiskMember({ membershipTier: null, outstandingBalanceUsd: null, daysOverdue: null, lastEngagedDate: null, churnRisk: null, agingBucket: null }),
      ])[0]
    ).toMatchObject({ membershipLabel: '—', tier: null, overdueLabel: '—', ageLabel: '—', ageDotClass: '', lastEngagedLabel: '' });
  });

  it('notes the overdue count and balance, and nothing while no member is at risk', () => {
    const summary = response.summary;
    expect(buildHealthMetricsMembersAtRiskNote(summary)).toBe('3 overdue · $120K');
    expect(buildHealthMetricsMembersAtRiskNote({ ...summary, memberCount: 0 })).toBe('');
    expect(buildHealthMetricsMembersAtRiskNote({ ...summary, memberCount: null })).toBe('');
    expect(buildHealthMetricsMembersAtRiskNote({ ...summary, outstandingBalanceUsd: null })).toBe('');
  });

  it.each([
    ['60_89_days', '60_89_days'],
    ['90_plus_days', '90_plus_days'],
    ['all', 'all'],
    ['30_days', 'all'],
    [null, 'all'],
  ] as const)('reads the bucket %s from the URL as %s', (value, expected) => {
    expect(parseHealthMetricsMembersAtRiskFilter(value)).toBe(expected);
  });
});

describe('members renewals', () => {
  it('reads the known dues up for renewal and how many renew', () => {
    expect(buildHealthMetricsMembersRenewalsMetrics({ renewalCount: 3, valueUsd: 185_000 })).toEqual([
      { key: 'value', label: 'Value up for renewal', value: '$185K' },
      { key: 'due', label: 'Renewals due', value: '3' },
    ]);
    expect(buildHealthMetricsMembersRenewalsMetrics({ renewalCount: null, valueUsd: null }).map((item) => item.value)).toEqual(['—', '—']);
  });

  it('formats a renewal with its logo and tier icon, and dashes a missing tier, date or dues instead of $0', () => {
    const [row, empty] = buildHealthMetricsMembersRenewalRows([
      {
        accountId: 'acct-1',
        accountName: 'Acme Studios',
        logoUrl: '',
        membershipTier: 'Platinum Membership',
        renewalDate: '2026-11-18',
        duesUsd: 20_000,
      },
      { accountId: 'acct-2', accountName: 'Acme Labs', logoUrl: '', membershipTier: null, renewalDate: null, duesUsd: null },
    ]);
    expect(row).toEqual({
      accountId: 'acct-1',
      name: 'Acme Studios',
      logoUrl: '',
      membershipLabel: 'Platinum',
      tier: 'platinum',
      renewalDateLabel: 'Nov 18, 2026',
      duesLabel: '$20K',
    });
    expect(empty).toMatchObject({ membershipLabel: '—', tier: null, renewalDateLabel: '—', duesLabel: '—' });
  });

  it.each([
    ['180_days', '180_days'],
    ['this_year', 'this_year'],
    ['next_week', '90_days'],
    [null, '90_days'],
  ] as const)('reads the window %s from the URL as %s', (value, expected) => {
    expect(parseHealthMetricsMembersRenewalsWindow(value)).toBe(expected);
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
      latestTone: 'critical',
      latestTextClass: 'text-red-600',
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

  // The view flags both cohorts at 90%; the rules hold voting members to the 50% a voting group needs.
  it('judges each cohort against its own rule rather than the view flag', () => {
    expect(buildHealthMetricsMembersBoardSummary('board', boardCohort({ latestAttendancePct: 0.95 }), null)).toMatchObject({
      isBelowExpectedLevel: false,
      latestTone: 'ok',
      latestTextClass: 'text-gray-900',
    });
    expect(buildHealthMetricsMembersBoardSummary('voting_members', boardCohort({ latestAttendancePct: 0.42 }), null)).toMatchObject({
      latestCaption: 'Last voting meeting · below the 50% a voting group needs',
      isBelowExpectedLevel: true,
      latestTone: 'low',
      latestTextClass: 'text-amber-600',
    });
  });

  it('falls back to the view flag only when the latest share is missing', () => {
    const flagged = buildHealthMetricsMembersBoardSummary('board', boardCohort({ latestAttendancePct: null }), null);
    expect(flagged).toMatchObject({ isBelowExpectedLevel: true, latestTone: 'critical' });
    // The flag is the board's 90% line, so it says nothing about a voting group's 50% one.
    const voting = buildHealthMetricsMembersBoardSummary('voting_members', boardCohort({ latestAttendancePct: null }), null);
    expect(voting).toMatchObject({ isBelowExpectedLevel: false, latestTone: 'ok', latestCaption: 'Last voting meeting' });
  });

  it('judges the whole percent the hero shows, so a share reading 90% is not below the board rule', () => {
    expect(buildHealthMetricsMembersBoardSummary('board', boardCohort({ latestAttendancePct: 26 / 29 }), null)).toMatchObject({
      latestPctLabel: '90%',
      isBelowExpectedLevel: false,
      latestTone: 'ok',
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
      buildHealthMetricsMembersBoardMeetingRows(
        [
          {
            meetingId: 'm-1',
            committeeName: 'Acme Board',
            meetingDate: '2026-09-18',
            attendedCount: 4,
            invitedCount: 11,
            attendancePct: 0.3636,
            isLatestMeeting: false,
          },
        ],
        'voting_members'
      )
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

  it('holds board meetings to the board rule: red below 90%, blue at or above it', () => {
    const meeting = (meetingId: string, attendancePct: number): HealthMetricsMembersBoardMeeting => ({
      meetingId,
      committeeName: 'Acme Board',
      meetingDate: '2026-09-18',
      attendedCount: null,
      invitedCount: null,
      attendancePct,
      isLatestMeeting: false,
    });
    const rows = buildHealthMetricsMembersBoardMeetingRows([meeting('m-1', 0.85), meeting('m-2', 0.9)], 'board');
    expect(rows.map((row) => row.rateFillClass)).toEqual(['bg-red-500', 'bg-blue-500']);
    expect(buildHealthMetricsMembersBoardMeetingRows([meeting('m-3', 0.85)], 'voting_members')[0].rateFillClass).toBe('bg-blue-500');
  });

  it('dashes missing figures and greys an unmeasured rate', () => {
    const [row] = buildHealthMetricsMembersBoardMeetingRows(
      [{ meetingId: 'm-2', committeeName: null, meetingDate: null, attendedCount: null, invitedCount: 5, attendancePct: null, isLatestMeeting: false }],
      'board'
    );
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

    // A share under 1% reads to one decimal, and the bar is drawn to the same value.
    const [faint] = buildHealthMetricsMembersBoardTrend([
      {
        meetingId: 'm-4',
        committeeName: 'Acme Board',
        meetingDate: '2026-10-01',
        attendedCount: 1,
        invitedCount: 250,
        attendancePct: 0.004,
        isLatestMeeting: false,
      },
    ]);
    expect(faint).toMatchObject({ pct: 0.4, pctLabel: '0.4%' });
  });
});

describe('buildHealthMetricsMembersBoardNote', () => {
  it('counts unused seats first', () => {
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 1 }))).toBe('1 seat unused');
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 3 }))).toBe('3 seats unused');
  });

  it('falls back to the latest share only when below the expected level', () => {
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 0 }))).toBe('82% attended');
    expect(buildHealthMetricsMembersBoardNote(boardCohort({ neverAttendedCount: 0, latestAttendancePct: 0.95 }))).toBe('');
    expect(buildHealthMetricsMembersBoardNote(null)).toBe('');
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
      isUnscored: false,
      isLowConfidence: false,
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

  it('reports a flagged sample as low confidence and explains why', () => {
    expect(
      buildHealthMetricsMembersNpsSummary(
        audience({ npsScore: 80, recipientsCount: 24, responsesCount: 5, responseRatePct: 0.208, noResponseCount: 19, isSampleTooSmall: true })
      )
    ).toMatchObject({
      isUnscored: false,
      isLowConfidence: true,
      scoreLabel: '+80',
      changeLabel: '+4pp',
      caption: 'Net Promoter Score · board audience',
      lowSampleNote: 'Only 5 of 24 responded (21%). Below the confidence threshold, so read this score with caution.',
      isRateBelowFloor: true,
      footer: { isBelowFloor: true, lead: '19 of 24 did not respond.', text: 'A score computed on 5 replies is not a foundation-wide signal.' },
    });
  });

  it('marks a below-floor rate as low confidence without the flag, and an unscored audience as neither', () => {
    expect(buildHealthMetricsMembersNpsSummary(audience({ responseRatePct: 0.34 }))).toMatchObject({
      isLowConfidence: true,
      lowSampleNote: 'Only 18 of 26 responded (34%). Below the confidence threshold, so read this score with caution.',
    });
    expect(buildHealthMetricsMembersNpsSummary(audience({ npsScore: null, responseRatePct: 0.2, isSampleTooSmall: true }))).toMatchObject({
      isUnscored: true,
      isLowConfidence: false,
      scoreLabel: '—',
      changeLabel: null,
      caption: 'Not enough responses to report a score',
      lowSampleNote: null,
    });
  });

  // The view's flag sits at 40%; the rules put the floor at 35%, so the flag counts only without a rate.
  it('judges the sample from the rate, reading the view flag only when the rate is missing', () => {
    expect(buildHealthMetricsMembersNpsSummary(audience({ responseRatePct: 0.39, isSampleTooSmall: true }))).toMatchObject({
      isLowConfidence: false,
      isRateBelowFloor: false,
      lowSampleNote: null,
    });
    expect(buildHealthMetricsMembersNpsSummary(audience({ responseRatePct: null, isSampleTooSmall: true }))).toMatchObject({ isLowConfidence: true });
  });

  it('keeps the singular reply and dashes a missing audience', () => {
    expect(buildHealthMetricsMembersNpsSummary(audience({ responsesCount: 1, responseRatePct: 0.1 })).footer.text).toBe(
      'A score computed on 1 reply is not a foundation-wide signal.'
    );
    expect(buildHealthMetricsMembersNpsSummary(null)).toMatchObject({
      isUnscored: true,
      isLowConfidence: false,
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

  it('keeps a flagged or below-floor wave score, marked as low confidence', () => {
    expect(
      buildHealthMetricsMembersNpsTrend([
        quarter('2025-07-01', 54, 0.71),
        quarter('2025-10-01', 61, null, true),
        quarter('2026-01-01', 70, 0.34),
        quarter('2026-04-01', 80, 0.21, true),
        quarter('2026-07-01', null, 0.1, true),
      ])
    ).toEqual([
      {
        quarterStartDate: '2025-07-01',
        label: 'Q3 25',
        score: 54,
        scoreLabel: '+54',
        scoreDescription: '+54',
        ratePct: 71,
        rateLabel: '71%',
        isRateBelowFloor: false,
        isLowConfidence: false,
      },
      {
        quarterStartDate: '2025-10-01',
        label: 'Q4 25',
        score: 61,
        scoreLabel: '+61',
        scoreDescription: '+61 (low response)',
        ratePct: null,
        rateLabel: '—',
        isRateBelowFloor: false,
        isLowConfidence: true,
      },
      {
        quarterStartDate: '2026-01-01',
        label: 'Q1 26',
        score: 70,
        scoreLabel: '+70',
        scoreDescription: '+70 (low response)',
        ratePct: 34,
        rateLabel: '34%',
        isRateBelowFloor: true,
        isLowConfidence: true,
      },
      {
        quarterStartDate: '2026-04-01',
        label: 'Q2 26',
        score: 80,
        scoreLabel: '+80',
        scoreDescription: '+80 (low response)',
        ratePct: 21,
        rateLabel: '21%',
        isRateBelowFloor: true,
        isLowConfidence: true,
      },
      {
        quarterStartDate: '2026-07-01',
        label: 'Q3 26',
        score: null,
        scoreLabel: '—',
        scoreDescription: '—',
        ratePct: 10,
        rateLabel: '10%',
        isRateBelowFloor: true,
        isLowConfidence: false,
      },
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
    const points = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.36), quarter('2025-07-01', 51, 0.34)]);
    expect(buildHealthMetricsMembersNpsTrendNote(points)).toMatchObject({ kind: 'diverging', scoreChangeLabel: '1 point' });
  });

  it('plots a rate under 1% as shown and flags its fall under a rising score', () => {
    const points = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.004), quarter('2025-07-01', 58, 0.001)]);
    expect(points.map((point) => [point.ratePct, point.rateLabel])).toEqual([
      [0.4, '0.4%'],
      [0.1, '0.1%'],
    ]);
    expect(buildHealthMetricsMembersNpsTrendNote(points)).toEqual({
      kind: 'diverging',
      scoreChangeLabel: '8 points',
      fromRateLabel: '0.4%',
      toRateLabel: '0.1%',
    });
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

  it('counts a flagged wave score in the comparison', () => {
    const points = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.7), quarter('2025-07-01', 55, 0.68), quarter('2026-01-01', 90, 0.3, true)]);
    expect(buildHealthMetricsMembersNpsTrendNote(points)).toEqual({
      kind: 'diverging',
      scoreChangeLabel: '40 points',
      fromRateLabel: '70%',
      toRateLabel: '30%',
    });
  });

  it('compares scored waves only, then judges the latest rate', () => {
    const points = buildHealthMetricsMembersNpsTrend([quarter('2025-01-01', 50, 0.7), quarter('2025-07-01', 55, 0.68), quarter('2026-01-01', null, 0.3, true)]);
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
    revenueNotRenewedRate: 16,
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
      churnYear(2025, { logoChurnRate: 12.5, revenueNotRenewedRate: 11.4 }),
      churnYear(2024, { revenueNotRenewedRate: 8 }),
      churnYear(2023, { revenueNotRenewedRate: 6 }),
      churnYear(2022, { revenueNotRenewedRate: 5 }),
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

  it('reads revenue churn with its change, logo churn with its memberships, and the dues lost for the running year', () => {
    const view = buildHealthMetricsMembersChurnView(CHURN, 'YTD');

    expect(view).toMatchObject({ measured: true, yearMeasured: true, year: 2026 });
    expect(view.metrics).toEqual([
      { key: 'revenue', label: 'Revenue churn', value: '16.0%', descriptionLead: '+4.6pp', descriptionLeadTone: 'down', description: ' vs 2025' },
      { key: 'logo', label: 'Logo churn', value: '10%', description: '12 of 120 memberships' },
      { key: 'dues', label: 'Dues lost this year', value: '$1.5M', description: '$900K last year' },
    ]);
  });

  it('colours a fall in revenue churn green, and names a past year and the year before it', () => {
    const falling: HealthMetricsMembersChurn = {
      years: [churnYear(2025, { revenueNotRenewedRate: 10.2 }), churnYear(2024, { revenueNotRenewedRate: 11.4 })],
      tiers: [],
    };
    const [revenue, , dues] = buildHealthMetricsMembersChurnView(falling, 'COMPLETED_YEAR').metrics;

    expect(revenue).toMatchObject({ value: '10.2%', descriptionLead: '−1.2pp', descriptionLeadTone: 'up', description: ' vs 2024' });
    expect(dues).toMatchObject({ label: 'Dues lost in 2025', description: '$900K in 2024' });
  });

  it('leaves the change out when the year before is not in the read', () => {
    const [revenue] = buildHealthMetricsMembersChurnView(CHURN, 'COMPLETED_YEAR_4').metrics;

    expect(revenue).toEqual({ key: 'revenue', label: 'Revenue churn', value: '5.0%' });
  });

  it('orders tiers by dues lost with their icon, flags a high rate, and shows a small share to one decimal', () => {
    const { tiers } = buildHealthMetricsMembersChurnView(CHURN, 'YTD');

    expect(tiers.map((row) => [row.membershipLabel, row.tier, row.isHighRate, row.shareLabel])).toEqual([
      ['Gold', 'gold', true, '67%'],
      ['Silver', 'silver', true, '33%'],
      ['Associate', null, false, '0.3%'],
      ['Bronze', null, false, '0%'],
    ]);
    expect(tiers[0]).toMatchObject({ lostLabel: '2', rateLabel: '40%', duesLabel: '$1M' });
    // A churn rate under 1% reads to one decimal, never 0%.
    const faint = buildHealthMetricsMembersChurnView({ ...CHURN, tiers: [tier(2026, 'Gold', 1, 1, 1_000, 100, 0.04)] }, 'YTD').tiers;
    expect(faint.map((row) => row.rateLabel)).toEqual(['0.1%']);
  });

  it('sorts By tier by tier rank, and by the rate and share each cell shows', () => {
    const { tiers } = buildHealthMetricsMembersChurnView(CHURN, 'YTD');
    const sorted = (key: HealthMetricsMembersChurnTierSortKey, direction: 'asc' | 'desc') =>
      sortHealthMetricsRows(tiers, { key, direction }, healthMetricsRowSortValue).map((row) => row.membershipLabel);

    expect(sorted('membership', 'desc')).toEqual(['Gold', 'Silver', 'Associate', 'Bronze']);
    expect(sorted('lost', 'desc')).toEqual(['Silver', 'Gold', 'Associate', 'Bronze']);
    expect(sorted('share', 'asc')).toEqual(['Bronze', 'Associate', 'Silver', 'Gold']);
    expect(tiers[2].sortValues).toMatchObject({ rate: 2, share: 0.3 });
  });

  it('sorts a rate under 1% by the tenth it shows, above a real 0%', () => {
    const { tiers } = buildHealthMetricsMembersChurnView(
      { ...CHURN, tiers: [tier(2026, 'Gold', 1, 1, 10, 50, 0.04), tier(2026, 'Silver', 2, 0, 0, 0, 0)] },
      'YTD'
    );

    expect(tiers.map((row) => [row.rateLabel, row.sortValues.rate])).toEqual([
      ['0.1%', 0.1],
      ['0%', 0],
    ]);
  });

  it('plots the revenue churn trend ending at the selected year and warns when churn rose', () => {
    const view = buildHealthMetricsMembersChurnView(CHURN, 'YTD');

    expect(view.trend.map((point) => [point.label, point.valueLabel, point.isSelected])).toEqual([
      ['2023', '6%', false],
      ['2024', '8%', false],
      ['2025', '11%', false],
      ['2026', '16%', true],
    ]);
    expect(view.trendRose).toBe(true);
  });

  it('reads 0% for a year that lost nothing, and an unread year as unmeasured', () => {
    const quiet: HealthMetricsMembersChurn = {
      years: [churnYear(2026, { lostCount: 0, revenueNotRenewedRate: 0, logoChurnRate: 0, duesLostUsd: 0 }), churnYear(2025, { revenueNotRenewedRate: 0 })],
      // The view keeps a zero row per tier for a year that lost nothing.
      tiers: [tier(2026, 'Gold', 1, 0, 0, 0, 0), tier(2026, 'Silver', 2, 0, 0, 0, 0)],
    };
    const view = buildHealthMetricsMembersChurnView(quiet, 'YTD');
    expect(view.yearMeasured).toBe(true);
    expect(view.tiers).toEqual([]);
    expect(view.metrics.map((item) => item.value)).toEqual(['0%', '0%', '$0']);

    const unmeasured: HealthMetricsMembersChurn = { years: [churnYear(2026, { lostCount: null })], tiers: [] };
    expect(buildHealthMetricsMembersChurnView(unmeasured, 'YTD').yearMeasured).toBe(false);
    expect(buildHealthMetricsMembersChurnView({ years: [], tiers: [] }, 'YTD')).toMatchObject({ measured: false, yearMeasured: false, trend: [] });
  });

  it('builds Members lost rows with the logo and tier icon, and a dash for what the model does not have', () => {
    expect(
      buildHealthMetricsMembersChurnDepartureRows([
        {
          key: 'term-1',
          accountId: 'acct-1',
          accountName: 'Acme Motors',
          logoUrl: 'https://logos.example/acme.png',
          membershipTier: 'Gold Membership',
          duesLostUsd: 250_000,
          lapsedDate: '2026-03-31',
          lastEngagedDate: null,
        },
        {
          key: 'term-2',
          accountId: 'acct-2',
          accountName: 'Vendor Corp',
          logoUrl: '',
          membershipTier: null,
          duesLostUsd: null,
          lapsedDate: null,
          lastEngagedDate: '2025-11-02',
        },
      ])
    ).toEqual([
      {
        key: 'term-1',
        accountId: 'acct-1',
        name: 'Acme Motors',
        logoUrl: 'https://logos.example/acme.png',
        membershipLabel: 'Gold',
        tier: 'gold',
        duesLabel: '$250K',
        lapsedLabel: 'Mar 31, 2026',
        lastEngagedLabel: '—',
      },
      {
        key: 'term-2',
        accountId: 'acct-2',
        name: 'Vendor Corp',
        logoUrl: '',
        membershipLabel: '—',
        tier: null,
        duesLabel: '—',
        lapsedLabel: '—',
        lastEngagedLabel: 'Nov 2, 2025',
      },
    ]);
  });
});
