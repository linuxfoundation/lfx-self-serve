// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lfxColors } from '../constants/colors.constants';
import { HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import {
  buildHealthMetricsMembersAtRiskAging,
  buildHealthMetricsMembersAtRiskCountLabel,
  buildHealthMetricsMembersAtRiskNote,
  buildHealthMetricsMembersAtRiskRows,
  buildHealthMetricsMembersAtRiskSummary,
  buildHealthMetricsMembersBoardMeetingRows,
  buildHealthMetricsMembersBoardNote,
  buildHealthMetricsMembersBoardSummary,
  buildHealthMetricsMembersBoardTrend,
  buildHealthMetricsMembersBreakdownView,
  buildHealthMetricsMembersChurnDepartureRows,
  buildHealthMetricsMembersChurnCountNote,
  buildHealthMetricsMembersChurnDeparturesSubtitle,
  buildHealthMetricsMembersChurnView,
  buildHealthMetricsMembersDirectoryRows,
  buildHealthMetricsMembersDirectorySearchPlaceholder,
  buildHealthMetricsMembersDirectorySummary,
  buildHealthMetricsMembersGrowthView,
  buildHealthMetricsMembersNpsAudienceOptions,
  buildHealthMetricsMembersNpsSegments,
  buildHealthMetricsMembersNpsSummary,
  buildHealthMetricsMembersNpsTrend,
  buildHealthMetricsMembersNpsTrendNote,
  buildHealthMetricsMembersRenewalRows,
  buildHealthMetricsMembersRenewalsCountLabel,
  buildHealthMetricsMembersRenewalsSummary,
  buildHealthMetricsMembersSections,
  buildHealthMetricsMembersSubNavItems,
} from './health-metrics-members.utils';

import type {
  HealthMetricsMembersAtRiskMember,
  HealthMetricsMembersAtRiskSummary,
  HealthMetricsMembersBoardCohortSummary,
  HealthMetricsMembersBoardMeeting,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnTier,
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
  const build = (rows: HealthMetricsMembersTierYear[], range: HealthMetricsRange = 'YTD') => buildHealthMetricsMembersBreakdownView({ rows }, range);
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

  it('counts the selected year’s members for the sub-nav, and drops tiers with no member in any year shown', () => {
    const rows = [...PGS, ...tier('Former', 9, [0, 0, 0, 0, 0, 0, 0, 0])];

    expect(build(rows).count).toBe(1845);
    expect(build(rows, 'COMPLETED_YEAR').count).toBe(1527);
    expect(build(rows).rows.map((row) => row.label)).not.toContain('Former');
  });

  it('starts at a later first year, and is unmeasured with no rows', () => {
    const view = build(tier('Gold', 1, [0, 0, 0, 0, 0, 5, 6, 7]).slice(5));

    expect(view.columns.map((column) => column.year)).toEqual([2024, 2025, 2026]);
    expect(build([])).toEqual({ measured: false, columns: [], rows: [], count: null });
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
    });
    expect(
      buildHealthMetricsMembersAtRiskRows([
        atRiskMember({ membershipTier: null, outstandingBalanceUsd: null, daysOverdue: null, lastEngagedDate: null, churnRisk: null, agingBucket: null }),
      ])[0]
    ).toMatchObject({ tierLabel: '—', overdueLabel: '—', ageLabel: '—', lastEngagedLabel: '—' });
    // The design draws no risk chip or aging bucket on a row, so the view carries neither.
    expect(Object.keys(buildHealthMetricsMembersAtRiskRows([atRiskMember()])[0])).toEqual([
      'accountId',
      'accountName',
      'tierLabel',
      'overdueLabel',
      'ageLabel',
      'lastEngagedLabel',
    ]);
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
    expect(row).toMatchObject({ tierLabel: '—', renewalDateLabel: '—', duesLabel: '—', hasOutstandingBalance: false, hasRenewed: true });
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

  // The view's own rate and change are now net of upgrades, so the change is the two years' not-renewed shares.
  it('derives the revenue change from the not-renewed shares, colouring the trend the same way', () => {
    const falling: HealthMetricsMembersChurn = {
      years: [churnYear(2026, { revenueNotRenewedRate: 10.2 }), churnYear(2025, { revenueNotRenewedRate: 11.4 })],
      tiers: [],
    };
    expect(buildHealthMetricsMembersChurnView(falling, 'YTD', 'revenue')).toMatchObject({
      heroLabel: '10.2%',
      changeLabel: '−1.2pp vs 2025',
      changeTone: 'good',
      trendRose: false,
    });
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
          key: 'term-1',
          accountId: 'acct-1',
          accountName: 'Acme Motors',
          membershipTier: 'Gold',
          duesLostUsd: 250_000,
          lapsedDate: '2026-03-31',
          lastEngagedDate: null,
        },
        {
          key: 'term-2',
          accountId: 'acct-2',
          accountName: 'Vendor Corp',
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
        accountName: 'Acme Motors',
        tierLabel: 'Gold',
        duesLabel: '$250K',
        lapsedLabel: 'Mar 31, 2026',
        lastEngagedLabel: '—',
      },
      { key: 'term-2', accountId: 'acct-2', accountName: 'Vendor Corp', tierLabel: '—', duesLabel: '—', lapsedLabel: '—', lastEngagedLabel: 'Nov 2, 2025' },
    ]);
  });

  it('claims the churn count only when the list matches it', () => {
    expect(buildHealthMetricsMembersChurnDeparturesSubtitle(12, 12)).toBe('largest dues lost first · the same 12 as lost above');
    expect(buildHealthMetricsMembersChurnDeparturesSubtitle(11, 12)).toBe('largest dues lost first');
  });

  it('notes a gap between the list and the churn count only when they differ', () => {
    expect(buildHealthMetricsMembersChurnCountNote(12, 12)).toBeNull();
    expect(buildHealthMetricsMembersChurnCountNote(11, 12)).toBe(
      '11 memberships listed, while churn counts 12 lost. The list and the churn count are counted separately, so they can differ slightly.'
    );
  });
});
