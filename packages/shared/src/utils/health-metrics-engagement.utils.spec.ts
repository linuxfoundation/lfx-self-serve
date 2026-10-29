// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Engagement page's display rules. These encode the acceptance criteria that are
// easiest to get wrong: an em dash is not 0%, a thin period is "No data" not a percentage, and a
// group with no invited population is not the same as one nobody attended.

import { describe, expect, it } from 'vitest';

import {
  HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE,
  HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '../constants/health-metrics-engagement.constants';
import {
  HealthMetricsEngagementAttendanceMonth,
  HealthMetricsEngagementGroupRow,
  HealthMetricsEngagementNewsletter,
  HealthMetricsEngagementNewsletterPerformance,
  HealthMetricsEngagementNewsletterPeriod,
  HealthMetricsEngagementNonMemberRow,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementRecipient,
  HealthMetricsEngagementParticipationRow,
  HealthMetricsEngagementRepPeriodCounts,
  HealthMetricsEngagementRepRow,
  HealthMetricsEngagementSubNavCounts,
} from '../interfaces/health-metrics-engagement.interface';
import {
  buildHealthMetricsEngagementAttendanceTrendPoints,
  buildHealthMetricsEngagementAttendanceTrendSummary,
  buildHealthMetricsEngagementGroupTrend,
  buildHealthMetricsEngagementRepLabels,
  buildHealthMetricsEngagementSparkBars,
  buildHealthMetricsEngagementSubNavItems,
  filterHealthMetricsEngagementOrgRows,
  filterHealthMetricsEngagementRepRows,
  formatHealthMetricsEngagementAttendance,
  formatHealthMetricsEngagementAvgReps,
  buildHealthMetricsEngagementNewsletterView,
  buildHealthMetricsEngagementRecipientRow,
  countHealthMetricsEngagementRecipients,
  filterHealthMetricsEngagementRecipients,
  formatHealthMetricsRelativeTime,
  formatHealthMetricsEngagementCount,
  formatHealthMetricsEngagementPpDelta,
  formatHealthMetricsEngagementRatio,
  resolveHealthMetricsEngagementAttendanceTone,
  resolveHealthMetricsEngagementDeltaDirection,
  resolveHealthMetricsEngagementOrgTierPillClass,
  selectHealthMetricsEngagementGroupPeriod,
  selectHealthMetricsEngagementNonMemberCounts,
  selectHealthMetricsEngagementNonMemberPeriod,
  selectHealthMetricsEngagementParticipationPeriod,
  selectHealthMetricsEngagementRepCounts,
  selectHealthMetricsEngagementRepPeriod,
  filterHealthMetricsEngagementNonMemberRows,
} from './health-metrics-engagement.utils';

function counts(overrides: Partial<HealthMetricsEngagementSubNavCounts> = {}): HealthMetricsEngagementSubNavCounts {
  return {
    groups: 12,
    dormantGroups: 0,
    lowAttendanceGroups: 0,
    orgs: 40,
    lapsedOrgs: 0,
    reps: 88,
    neverAttendedReps: 0,
    nonMemberOrgs: 6,
    newsletters: 11,
    recipients: 1490,
    ...overrides,
  };
}

describe('formatHealthMetricsEngagementAttendance', () => {
  it('renders an em dash when there was no invited population, never 0%', () => {
    expect(formatHealthMetricsEngagementAttendance(null, 12)).toBe('—');
  });

  it('renders "No data" below the minimum meeting count, even with a real fraction', () => {
    expect(formatHealthMetricsEngagementAttendance(0.83, HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE - 1)).toBe('No data');
  });

  it('renders a rounded percentage at and above the minimum meeting count', () => {
    expect(formatHealthMetricsEngagementAttendance(0.826, HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE)).toBe('83%');
    expect(formatHealthMetricsEngagementAttendance(1, 27)).toBe('100%');
  });

  it('renders a genuine zero attendance as 0%, distinct from the em dash', () => {
    expect(formatHealthMetricsEngagementAttendance(0, 9)).toBe('0%');
  });

  it('renders "No data" when the meeting count itself is unmeasured, not a real fraction', () => {
    expect(formatHealthMetricsEngagementAttendance(0.83, null)).toBe('No data');
  });
});

describe('formatHealthMetricsEngagementCount', () => {
  it('renders an unmeasured count as an em dash and a genuine zero as 0', () => {
    expect(formatHealthMetricsEngagementCount(null)).toBe('—');
    expect(formatHealthMetricsEngagementCount(0)).toBe('0');
  });

  it('pins en-US grouping separators', () => {
    expect(formatHealthMetricsEngagementCount(12345)).toBe('12,345');
  });
});

describe('formatHealthMetricsEngagementRatio', () => {
  it('renders the "N / N" cell when both sides are measured', () => {
    expect(formatHealthMetricsEngagementRatio(12, 27)).toBe('12 / 27');
  });

  it('renders an em dash when either side is unmeasured, never a partial ratio', () => {
    expect(formatHealthMetricsEngagementRatio(null, 27)).toBe('—');
    expect(formatHealthMetricsEngagementRatio(12, null)).toBe('—');
    expect(formatHealthMetricsEngagementRatio(null, null)).toBe('—');
  });

  it('renders a genuine zero side as 0, distinct from the em dash', () => {
    expect(formatHealthMetricsEngagementRatio(0, 27)).toBe('0 / 27');
  });
});

describe('resolveHealthMetricsEngagementAttendanceTone', () => {
  it('treats both no-population and nobody-attended as the neutral empty bar', () => {
    expect(resolveHealthMetricsEngagementAttendanceTone(null)).toBe('empty');
    expect(resolveHealthMetricsEngagementAttendanceTone(0)).toBe('empty');
  });

  it('flags only the sub-50% band, leaving everything at or above it as ok', () => {
    expect(resolveHealthMetricsEngagementAttendanceTone(0.49)).toBe('low');
    expect(resolveHealthMetricsEngagementAttendanceTone(0.5)).toBe('ok');
    expect(resolveHealthMetricsEngagementAttendanceTone(0.92)).toBe('ok');
  });

  it('holds a board to its own rule: red below 90%', () => {
    expect(resolveHealthMetricsEngagementAttendanceTone(0.89, HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE)).toBe('critical');
    expect(resolveHealthMetricsEngagementAttendanceTone(0.9, HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE)).toBe('ok');
    expect(resolveHealthMetricsEngagementAttendanceTone(0, HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE)).toBe('empty');
  });

  // 26 of 29 reads "90%", so it must not be red under a 90% rule; 0.494 reads "49%" and stays amber.
  it('judges the whole percent the label shows, not the raw share', () => {
    expect(resolveHealthMetricsEngagementAttendanceTone(26 / 29, HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE)).toBe('ok');
    expect(resolveHealthMetricsEngagementAttendanceTone(0.496)).toBe('ok');
    expect(resolveHealthMetricsEngagementAttendanceTone(0.494)).toBe('low');
  });
});

describe('buildHealthMetricsEngagementSubNavItems', () => {
  it('returns one item per section, in the design order', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts());

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => section.key));
  });

  it('gives participation and trend no badge — neither is a countable list', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts());

    expect(items.find((item) => item.key === 'participation')?.count).toBeNull();
    expect(items.find((item) => item.key === 'trend')?.count).toBeNull();
  });

  it('spells the dormant and below-50% group notes together, dropping each at zero', () => {
    const note = (overrides: Partial<HealthMetricsEngagementSubNavCounts>) =>
      buildHealthMetricsEngagementSubNavItems(counts(overrides)).find((item) => item.key === 'committees')?.note;

    expect(note({ dormantGroups: 2, lowAttendanceGroups: 3 })).toBe('2 dormant · 3 below 50%');
    expect(note({ dormantGroups: 2 })).toBe('2 dormant');
    expect(note({ lowAttendanceGroups: 3 })).toBe('3 below 50%');
    expect(note({})).toBe('');
  });

  it('spells the lapsed-org and never-attended notes from the counts', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts({ lapsedOrgs: 7, neverAttendedReps: 3 }));

    expect(items.find((item) => item.key === 'orgs')?.note).toBe(`7 inactive ${HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS} days`);
    expect(items.find((item) => item.key === 'reps')?.note).toBe('3 never attended');
  });

  it('suppresses the note for a section whose total has not resolved yet', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts({ groups: null, dormantGroups: 2, lowAttendanceGroups: 1 }));
    const committees = items.find((item) => item.key === 'committees');

    expect(committees?.count).toBeNull();
    expect(committees?.note).toBe('');
  });

  it('carries the non-member count with no note of its own', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts());
    const nonmem = items.find((item) => item.key === 'nonmem');

    expect(nonmem?.count).toBe(6);
    expect(nonmem?.note).toBe('');
  });

  it('badges recipient engagement with the latest newsletter’s recipients', () => {
    expect(buildHealthMetricsEngagementSubNavItems(counts()).find((item) => item.key === 'recipients')?.count).toBe(1490);
  });

  it('badges newsletter performance with the newsletters sent, and none while unread', () => {
    expect(buildHealthMetricsEngagementSubNavItems(counts()).find((item) => item.key === 'newsletters')?.count).toBe(11);
    expect(buildHealthMetricsEngagementSubNavItems(counts({ newsletters: null })).find((item) => item.key === 'newsletters')?.count).toBeNull();
  });
});

describe('selectHealthMetricsEngagementGroupPeriod / buildHealthMetricsEngagementGroupTrend', () => {
  const row: HealthMetricsEngagementGroupRow = {
    committeeId: 'c-1',
    committeeName: 'Technical Steering Committee',
    projectId: 'p-1',
    projectSlug: 'acme-core',
    projectName: 'Acme Core',
    groupTypeLabel: 'Technical Steering Committee',
    lastMetDate: '2026-08-14',
    periods: [
      { range: 'COMPLETED_YEAR_3', meetingsHeld: 10, invitedCount: 100, attendedCount: 54, attendancePct: 0.54, dormant: false },
      { range: 'COMPLETED_YEAR_2', meetingsHeld: 0, invitedCount: 0, attendedCount: 0, attendancePct: null, dormant: true },
      { range: 'COMPLETED_YEAR', meetingsHeld: 12, invitedCount: 120, attendedCount: 71, attendancePct: 0.59, dormant: false },
      { range: 'YTD', meetingsHeld: 8, invitedCount: 80, attendedCount: 50, attendancePct: 0.62, dormant: false },
    ],
  };

  it('returns the requested period', () => {
    expect(selectHealthMetricsEngagementGroupPeriod(row, 'COMPLETED_YEAR')?.attendancePct).toBe(0.59);
  });

  it('falls back to the most recent period for a range the view has no columns for', () => {
    expect(selectHealthMetricsEngagementGroupPeriod(row, 'COMPLETED_YEAR_4')?.range).toBe('YTD');
  });

  it('returns null rather than throwing when a row carries no periods at all', () => {
    expect(selectHealthMetricsEngagementGroupPeriod({ ...row, periods: [] }, 'YTD')).toBeNull();
  });

  it('builds the sparkline oldest to current, keeping a null period null', () => {
    expect(buildHealthMetricsEngagementGroupTrend(row)).toEqual([0.54, null, 0.59, 0.62]);
  });

  // The table reads "No data" below the floor, so plotting the same period would contradict it.
  it('nulls a period with too few meetings to rate', () => {
    const periods = [...row.periods];
    periods[3] = { ...periods[3], meetingsHeld: HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE - 1 };

    expect(buildHealthMetricsEngagementGroupTrend({ ...row, periods })).toEqual([0.54, null, 0.59, null]);
  });

  it('nulls a period whose meeting count is unmeasured, not just below the floor', () => {
    const periods = [...row.periods];
    periods[3] = { ...periods[3], meetingsHeld: null };

    expect(buildHealthMetricsEngagementGroupTrend({ ...row, periods })).toEqual([0.54, null, 0.59, null]);
  });
});

describe('buildHealthMetricsEngagementSparkBars', () => {
  // The design's spark2: 3px floor plus up to 19px, scaled to the series' own range.
  it('scales to the series own min-max, so a tight run still shows its movement', () => {
    expect(buildHealthMetricsEngagementSparkBars([0.54, 0.58, 0.59, 0.62])).toEqual([
      { heightPx: 3, last: false },
      { heightPx: 12.5, last: false },
      { heightPx: 14.9, last: false },
      { heightPx: 22, last: true },
    ]);
  });

  it('keeps an unrated period as an empty slot, so later periods do not slide left', () => {
    expect(buildHealthMetricsEngagementSparkBars([0.4, null, 0.8])).toEqual([
      { heightPx: 3, last: false },
      { heightPx: null, last: false },
      { heightPx: 22, last: true },
    ]);
  });

  it('highlights nothing when the current period is unrated', () => {
    const bars = buildHealthMetricsEngagementSparkBars([0.4, 0.8, null]);

    expect(bars.map((bar) => bar.last)).toEqual([false, false, false]);
    expect(bars[2]?.heightPx).toBeNull();
  });

  it('draws a flat series at the floor rather than dividing by a zero range', () => {
    expect(buildHealthMetricsEngagementSparkBars([0.5, 0.5]).map((bar) => bar.heightPx)).toEqual([3, 3]);
  });

  it('returns no bars below two rated values, which cannot express a direction', () => {
    expect(buildHealthMetricsEngagementSparkBars([0.5, null, null])).toEqual([]);
    expect(buildHealthMetricsEngagementSparkBars([])).toEqual([]);
  });
});

describe('group-type filter cuts', () => {
  // The view buckets committee categories itself, so a cut that lists a category instead of a label
  // matches nothing and silently empties the table — the bug this assertion exists to catch.
  it('maps every cut onto labels the view actually emits', () => {
    for (const labels of Object.values(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS)) {
      for (const label of labels) {
        expect(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES).toContain(label);
      }
    }
  });

  it('leaves the all-types cut without a predicate', () => {
    expect(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS).not.toHaveProperty('all');
  });
});

describe('participation period selection and delta formatting', () => {
  const participationRow: HealthMetricsEngagementParticipationRow = {
    level: 'group',
    group: 'Board',
    label: 'Board',
    totalGroups: 8,
    governance: true,
    periods: [
      {
        range: 'COMPLETED_YEAR_3',
        meetingsHeld: 9,
        invitedCount: 90,
        attendedCount: 72,
        attendancePct: 0.8,
        activeGroups: 6,
        neverAttended: 2,
        attendanceChangePp: null,
        meetingsChangePct: null,
      },
      {
        range: 'COMPLETED_YEAR_2',
        meetingsHeld: 10,
        invitedCount: 100,
        attendedCount: 83,
        attendancePct: 0.83,
        activeGroups: 7,
        neverAttended: 1,
        attendanceChangePp: 0.03,
        meetingsChangePct: 0.111,
      },
      {
        range: 'COMPLETED_YEAR',
        meetingsHeld: 12,
        invitedCount: 120,
        attendedCount: 96,
        attendancePct: 0.8,
        activeGroups: 7,
        neverAttended: 1,
        attendanceChangePp: -0.03,
        meetingsChangePct: 0.2,
      },
      {
        range: 'YTD',
        meetingsHeld: 7,
        invitedCount: 70,
        attendedCount: 60,
        attendancePct: 0.857,
        activeGroups: 8,
        neverAttended: 0,
        attendanceChangePp: 0.057,
        meetingsChangePct: -0.4167,
      },
    ],
  };

  it('returns the requested period', () => {
    expect(selectHealthMetricsEngagementParticipationPeriod(participationRow, 'COMPLETED_YEAR')?.meetingsHeld).toBe(12);
  });

  it('falls back to the most recent period for a range the view has no columns for', () => {
    expect(selectHealthMetricsEngagementParticipationPeriod(participationRow, 'COMPLETED_YEAR_4')?.range).toBe('YTD');
  });

  it('returns null rather than throwing when a row carries no periods at all', () => {
    expect(selectHealthMetricsEngagementParticipationPeriod({ ...participationRow, periods: [] }, 'YTD')).toBeNull();
  });

  // An unmeasured delta and a measured no-change both read as "no movement", so neither is coloured.
  it.each([
    [null, 'neutral'],
    [0, 'neutral'],
    [0.01, 'up'],
    [-0.01, 'down'],
  ])('resolves %s as %s', (value, expected) => {
    expect(resolveHealthMetricsEngagementDeltaDirection(value as number | null)).toBe(expected);
  });

  it('renders a point change on a share as pp, never as a percent', () => {
    expect(formatHealthMetricsEngagementPpDelta(0.032)).toBe('+3.2pp');
    expect(formatHealthMetricsEngagementPpDelta(-0.032)).toBe('−3.2pp');
    expect(formatHealthMetricsEngagementPpDelta(null)).toBe('—');
  });

  // A decline too small to show at one decimal must not print as a signed zero or paint the
  // label red — the label and its colour read the same rounded value.
  it('treats a change that rounds away as no movement, in both the label and the direction', () => {
    expect(formatHealthMetricsEngagementPpDelta(-0.0004)).toBe('+0.0pp');
    expect(resolveHealthMetricsEngagementDeltaDirection(-0.0004)).toBe('neutral');
    // One decimal is still movement.
    expect(resolveHealthMetricsEngagementDeltaDirection(-0.0006)).toBe('down');
  });
});

describe('organization participation rules', () => {
  function orgRow(name: string, sortRank: number | null, overrides: Partial<HealthMetricsEngagementOrgRow> = {}): HealthMetricsEngagementOrgRow {
    return {
      accountId: name.toLowerCase(),
      accountName: name,
      membershipTier: 'Silver',
      isMember: true,
      lastEngagedDate: '2026-08-14',
      daysSinceLastEngaged: 39,
      lapsed: false,
      // Oldest-first, as the server builds them from `HEALTH_METRICS_ENGAGEMENT_RANGES`.
      periods: [
        {
          range: 'COMPLETED_YEAR',
          meetingsHeld: 30,
          meetingsTotal: 27,
          invitedCount: 27,
          attendedCount: 9,
          attendancePct: 0.33,
          avgReps: 1.1,
          sortRank: sortRank === null ? null : 10 - sortRank,
        },
        { range: 'YTD', meetingsHeld: 30, meetingsTotal: 27, invitedCount: 27, attendedCount: 21, attendancePct: 0.78, avgReps: 1.75, sortRank },
      ],
      ...overrides,
    };
  }

  it('pills the top tiers blue in any case, and every other tier grey', () => {
    expect(resolveHealthMetricsEngagementOrgTierPillClass('Platinum')).toBe(HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS.top);
    expect(resolveHealthMetricsEngagementOrgTierPillClass('PREMIER')).toBe(HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS.top);
    expect(resolveHealthMetricsEngagementOrgTierPillClass(' founding ')).toBe(HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS.top);
    expect(resolveHealthMetricsEngagementOrgTierPillClass('Silver')).toBe(HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS.other);
    expect(resolveHealthMetricsEngagementOrgTierPillClass('Non-Member')).toBe(HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS.other);
  });

  // `null` is "attended nothing this period", which is not the same as averaging zero reps.
  it('renders mean representatives at one decimal, and an em dash when the org attended nothing', () => {
    expect(formatHealthMetricsEngagementAvgReps(1.75)).toBe('1.8');
    expect(formatHealthMetricsEngagementAvgReps(2)).toBe('2.0');
    expect(formatHealthMetricsEngagementAvgReps(null)).toBe('—');
  });

  it('ranks by the selected period, so the period pill re-sorts rather than re-reads', () => {
    const rows = [orgRow('Acme Motors', 4), orgRow('Vendor Corp', 1)];

    expect(filterHealthMetricsEngagementOrgRows(rows, 'all', '', 'YTD').map((row) => row.accountName)).toEqual(['Vendor Corp', 'Acme Motors']);
    expect(filterHealthMetricsEngagementOrgRows(rows, 'all', '', 'COMPLETED_YEAR').map((row) => row.accountName)).toEqual(['Acme Motors', 'Vendor Corp']);
  });

  // An unranked row is not the best row — sorting it first would put a blank at the top of the table.
  it('sorts an unranked organization last, and breaks a rank tie by name', () => {
    const rows = [orgRow('Unranked Co', null), orgRow('Zeta Labs', 2), orgRow('Alpha Works', 2)];

    expect(filterHealthMetricsEngagementOrgRows(rows, 'all', '', 'YTD').map((row) => row.accountName)).toEqual(['Alpha Works', 'Zeta Labs', 'Unranked Co']);
  });

  it('narrows to the view flag on the lapsed cut, and matches the search case-insensitively', () => {
    const rows = [orgRow('Acme Motors', 1), orgRow('Vendor Corp', 2, { lapsed: true })];

    expect(filterHealthMetricsEngagementOrgRows(rows, 'lapsed', '', 'YTD').map((row) => row.accountName)).toEqual(['Vendor Corp']);
    expect(filterHealthMetricsEngagementOrgRows(rows, 'all', '  ACME ', 'YTD').map((row) => row.accountName)).toEqual(['Acme Motors']);
    expect(filterHealthMetricsEngagementOrgRows(rows, 'all', 'motors', 'YTD').map((row) => row.accountName)).toEqual(['Acme Motors']);
  });

  it("leaves the caller's array untouched, since the rows are shared with the response signal", () => {
    const rows = [orgRow('Zeta Labs', 5), orgRow('Alpha Works', 1)];
    filterHealthMetricsEngagementOrgRows(rows, 'all', '', 'YTD');

    expect(rows.map((row) => row.accountName)).toEqual(['Zeta Labs', 'Alpha Works']);
  });
});

describe('non-member participation rules', () => {
  function nonMemberRow(name: string, sortRank: number | null): HealthMetricsEngagementNonMemberRow {
    return {
      accountId: name.toLowerCase().replace(/\s+/g, '-'),
      accountName: name,
      membershipStatus: 'Non-member',
      // Oldest-first, as the server builds them from `HEALTH_METRICS_ENGAGEMENT_RANGES`.
      periods: [
        { range: 'COMPLETED_YEAR', meetingsAttended: 8, distinctPeople: 3, sortRank: sortRank === null ? null : 10 - sortRank },
        { range: 'YTD', meetingsAttended: 12, distinctPeople: 4, sortRank },
      ],
    };
  }

  it('selects the period the pill asks for, falling back to the newest period held', () => {
    const row = nonMemberRow('Acme Motors', 1);

    expect(selectHealthMetricsEngagementNonMemberPeriod(row, 'COMPLETED_YEAR')?.meetingsAttended).toBe(8);
    // A period the read never returned falls back rather than blanking every cell in the row.
    expect(selectHealthMetricsEngagementNonMemberPeriod(row, 'COMPLETED_YEAR_3')?.range).toBe('YTD');
    expect(selectHealthMetricsEngagementNonMemberPeriod({ ...row, periods: [] }, 'YTD')).toBeNull();
  });

  it('filters and ranks by the selected period, so the period pill re-cuts rather than re-reads', () => {
    const rows = [nonMemberRow('Acme Motors', 4), nonMemberRow('Vendor Corp', 1)];

    expect(filterHealthMetricsEngagementNonMemberRows(rows, 'YTD').map((row) => row.accountName)).toEqual(['Vendor Corp', 'Acme Motors']);
    expect(filterHealthMetricsEngagementNonMemberRows(rows, 'COMPLETED_YEAR').map((row) => row.accountName)).toEqual(['Acme Motors', 'Vendor Corp']);
  });

  // An unranked row is not the best row — sorting it first would put a blank at the top of the table.
  it('filters and ranks an unranked organization last, breaking a rank tie by name', () => {
    const rows = [nonMemberRow('Unranked Co', null), nonMemberRow('Zeta Labs', 2), nonMemberRow('Alpha Works', 2)];

    expect(filterHealthMetricsEngagementNonMemberRows(rows, 'YTD').map((row) => row.accountName)).toEqual(['Alpha Works', 'Zeta Labs', 'Unranked Co']);
  });

  it("leaves the caller's array untouched, since the rows are shared with the response signal", () => {
    const rows = [nonMemberRow('Zeta Labs', 5), nonMemberRow('Alpha Works', 1)];
    filterHealthMetricsEngagementNonMemberRows(rows, 'YTD');

    expect(rows.map((row) => row.accountName)).toEqual(['Zeta Labs', 'Alpha Works']);
  });

  // The period caption counts organizations that attended in it, so the table lists only those.
  it('drops an organization with no meetings attended in the selected period, or none measured', () => {
    const quiet = nonMemberRow('Quiet Co', 3);
    quiet.periods[1] = { ...quiet.periods[1], meetingsAttended: 0 };
    const unmeasured = nonMemberRow('Unmeasured Co', 2);
    unmeasured.periods[1] = { ...unmeasured.periods[1], meetingsAttended: null };
    const rows = [quiet, unmeasured, nonMemberRow('Acme Motors', 1)];

    expect(filterHealthMetricsEngagementNonMemberRows(rows, 'YTD').map((row) => row.accountName)).toEqual(['Acme Motors']);
    expect(filterHealthMetricsEngagementNonMemberRows(rows, 'COMPLETED_YEAR').map((row) => row.accountName)).toEqual([
      'Quiet Co',
      'Unmeasured Co',
      'Acme Motors',
    ]);
  });

  it('selects the caption count for the selected period, and none when the view reported none', () => {
    const counts = [
      { range: 'COMPLETED_YEAR' as const, orgs: 33 },
      { range: 'YTD' as const, orgs: 19 },
    ];

    expect(selectHealthMetricsEngagementNonMemberCounts(counts, 'YTD')).toEqual({ range: 'YTD', orgs: 19 });
    expect(selectHealthMetricsEngagementNonMemberCounts(counts, 'COMPLETED_YEAR')?.orgs).toBe(33);
    expect(selectHealthMetricsEngagementNonMemberCounts(null, 'YTD')).toBeNull();
  });
});

describe('representatives rules', () => {
  function repRow(personName: string, accountName: string, overrides: Partial<HealthMetricsEngagementRepRow> = {}): HealthMetricsEngagementRepRow {
    return {
      key: `${personName}|${accountName}`.toLowerCase(),
      personName,
      identityUnresolved: false,
      accountName,
      membershipTier: null,
      committeeName: 'Technical Steering Committee',
      lastAttendedDate: '2026-08-14',
      // Oldest-first, as the server builds them from `HEALTH_METRICS_ENGAGEMENT_RANGES`.
      periods: [
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: null },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 2, neverAttended: false, lapsed: false, sortRank: null },
      ],
      ...overrides,
    };
  }

  it('selects the period the pill asks for, falling back to the newest period held', () => {
    const row = repRow('Dana Fields', 'Acme Motors');

    expect(selectHealthMetricsEngagementRepPeriod(row, 'COMPLETED_YEAR')?.meetingsAttended).toBe(0);
    // A period the read never returned falls back rather than blanking every cell in the row.
    expect(selectHealthMetricsEngagementRepPeriod(row, 'COMPLETED_YEAR_3')?.range).toBe('YTD');
    expect(selectHealthMetricsEngagementRepPeriod({ ...row, periods: [] }, 'YTD')).toBeNull();
  });

  // Unlike the org and non-member captions, this view counts its scope per period.
  it('selects the caption counts for the period, and reports an unmeasured scope as null', () => {
    const counts: HealthMetricsEngagementRepPeriodCounts[] = [
      { range: 'COMPLETED_YEAR', reps: 40, neverAttendedReps: 9 },
      { range: 'YTD', reps: 48, neverAttendedReps: 12 },
    ];

    expect(selectHealthMetricsEngagementRepCounts(counts, 'COMPLETED_YEAR')).toEqual({ range: 'COMPLETED_YEAR', reps: 40, neverAttendedReps: 9 });
    expect(selectHealthMetricsEngagementRepCounts(counts, 'YTD')?.reps).toBe(48);
    expect(selectHealthMetricsEngagementRepCounts(null, 'YTD')).toBeNull();
  });

  // The caption counts the period's invited population, so the table cannot show anyone outside it.
  it('drops rows that were not invited in the selected period, on every cut', () => {
    const invitedLater = repRow('Sam Rivera', 'Vendor Corp', {
      periods: [
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: null },
        { range: 'YTD', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false, sortRank: null },
      ],
    });
    const rows = [repRow('Dana Fields', 'Acme Motors'), invitedLater];

    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '', 'YTD').map((row) => row.personName)).toEqual(['Dana Fields']);
    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '', 'COMPLETED_YEAR').map((row) => row.personName)).toEqual(['Dana Fields', 'Sam Rivera']);
  });

  // A null invited count is unmeasured, the same as a real 0 — neither belongs in the counted population.
  it('drops a row whose invited count is unmeasured for the selected period', () => {
    const unmeasured = repRow('Sam Rivera', 'Vendor Corp', {
      periods: [
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false, sortRank: null },
        { range: 'YTD', meetingsInvited: null, meetingsAttended: null, neverAttended: false, lapsed: false, sortRank: null },
      ],
    });
    const rows = [repRow('Dana Fields', 'Acme Motors'), unmeasured];

    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '', 'YTD').map((row) => row.personName)).toEqual(['Dana Fields']);
  });

  it('cuts on the selected period own flags rather than a client-side date comparison', () => {
    const lapsed = repRow('Sam Rivera', 'Vendor Corp', {
      periods: [
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 1, neverAttended: false, lapsed: false, sortRank: null },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: true, sortRank: null },
      ],
    });
    const rows = [repRow('Dana Fields', 'Acme Motors'), lapsed];

    expect(filterHealthMetricsEngagementRepRows(rows, 'lapsed', '', 'YTD').map((row) => row.personName)).toEqual(['Sam Rivera']);
    // The same pair reads differently in the completed year, where neither flag is set.
    expect(filterHealthMetricsEngagementRepRows(rows, 'lapsed', '', 'COMPLETED_YEAR')).toEqual([]);
    expect(filterHealthMetricsEngagementRepRows(rows, 'never', '', 'COMPLETED_YEAR').map((row) => row.personName)).toEqual(['Dana Fields']);
  });

  // One term searches the displayed name and the organization column.
  it('searches the person and the organization together, case-insensitively', () => {
    const rows = [repRow('Dana Fields', 'Acme Motors'), repRow('Sam Rivera', 'Vendor Corp')];

    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '  DANA ', 'YTD').map((row) => row.personName)).toEqual(['Dana Fields']);
    expect(filterHealthMetricsEngagementRepRows(rows, 'all', 'vendor', 'YTD').map((row) => row.personName)).toEqual(['Sam Rivera']);
    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '', 'YTD')).toHaveLength(2);
  });

  it("leaves the caller's array untouched, since the rows are shared with the response signal", () => {
    const rows = [repRow('Zeta Labs', 'Zeta Labs'), repRow('Alpha Works', 'Alpha Works')];
    filterHealthMetricsEngagementRepRows(rows, 'all', '', 'YTD');

    expect(rows.map((row) => row.personName)).toEqual(['Zeta Labs', 'Alpha Works']);
  });

  // The view ranks each period on its own, so the period pill re-sorts the cut.
  it('orders by the selected period rank, unranked last, ties by name', () => {
    const ranked = (name: string, completedYear: number | null, ytd: number | null): HealthMetricsEngagementRepRow =>
      repRow(name, 'Acme Motors', {
        periods: [
          { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 1, neverAttended: false, lapsed: false, sortRank: completedYear },
          { range: 'YTD', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: false, sortRank: ytd },
        ],
      });
    const rows = [ranked('Unranked Rep', null, null), ranked('Sam Rivera', 1, 2), ranked('Dana Fields', 2, 1), ranked('Alex Kim', 2, 1)];

    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '', 'YTD').map((row) => row.personName)).toEqual([
      'Alex Kim',
      'Dana Fields',
      'Sam Rivera',
      'Unranked Rep',
    ]);
    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '', 'COMPLETED_YEAR').map((row) => row.personName)).toEqual([
      'Sam Rivera',
      'Alex Kim',
      'Dana Fields',
      'Unranked Rep',
    ]);
  });

  // The placeholder name of an unresolved identity is not a person, so it is neither shown nor searched.
  it('searches an unresolved identity by its label rather than its placeholder name', () => {
    const rows = [repRow('Dana Fields', 'Acme Motors'), repRow('Placeholder', 'Vendor Corp', { identityUnresolved: true })];

    expect(filterHealthMetricsEngagementRepRows(rows, 'all', 'placeholder', 'YTD')).toEqual([]);
    expect(filterHealthMetricsEngagementRepRows(rows, 'all', 'unresolved', 'YTD').map((row) => row.accountName)).toEqual(['Vendor Corp']);
  });
});

describe('buildHealthMetricsEngagementRepLabels', () => {
  const base: HealthMetricsEngagementRepRow = {
    key: 'rep-1',
    personName: 'Dana Fields',
    identityUnresolved: false,
    accountName: 'Acme Motors',
    membershipTier: 'Gold',
    committeeName: 'Governing Board',
    lastAttendedDate: '2026-08-14',
    periods: [],
  };

  it('joins the organization with its tier', () => {
    expect(buildHealthMetricsEngagementRepLabels(base)).toEqual({
      displayName: 'Dana Fields',
      orgLabel: 'Acme Motors · Gold',
      lastAttendedLabel: 'Aug 14, 2026',
    });
    expect(buildHealthMetricsEngagementRepLabels({ ...base, membershipTier: null }).orgLabel).toBe('Acme Motors');
  });

  it('drops the missing pieces rather than printing them, and renders an unresolved identity as such', () => {
    const labels = buildHealthMetricsEngagementRepLabels({
      ...base,
      identityUnresolved: true,
      accountName: '',
      membershipTier: ' ',
      lastAttendedDate: null,
    });

    expect(labels).toEqual({ displayName: 'Unresolved identity', orgLabel: '—', lastAttendedLabel: '—' });
  });
});

describe('attendance trend rules', () => {
  // The view's window ends with the current month, so "today" decides which month is still collecting meetings.
  const today = new Date('2026-10-20T12:00:00Z');

  function month(
    monthStartDate: string,
    attendancePct: number | null,
    overrides: Partial<HealthMetricsEngagementAttendanceMonth> = {}
  ): HealthMetricsEngagementAttendanceMonth {
    return { monthStartDate, meetingsHeld: 10, invited: 100, attended: 50, attendancePct, attendanceChangePp: null, ...overrides };
  }

  /** Twelve months ending October 2026, every one rated at 40% + 1pp per month. */
  function fullYear(): HealthMetricsEngagementAttendanceMonth[] {
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 10 + index, 1)).toISOString().slice(0, 10);
      return month(date, 0.4 + index * 0.01, { attendanceChangePp: index === 0 ? null : 0.01 });
    });
  }

  it('labels each point and marks the current month as to date', () => {
    const points = buildHealthMetricsEngagementAttendanceTrendPoints(fullYear(), today);

    expect(points[0]).toMatchObject({ label: 'Nov 25', monthLabel: 'November 2025', rateLabel: '40%', meetingsLabel: '10 meetings', isInProgress: false });
    expect(points[0]?.rate).toBeCloseTo(40);
    expect(points[11]).toMatchObject({ label: 'Oct 26', monthLabel: 'October 2026 (to date)', isInProgress: true });
  });

  // A gap, not a collapse to 0%: no invited population and a thin month both leave the line.
  it('gaps a month with no invited population, and one with too few meetings to report a rate', () => {
    const months = [
      month('2026-08-01', null, { meetingsHeld: 0 }),
      month('2026-09-01', 0.8, { meetingsHeld: HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE - 1 }),
    ];
    const points = buildHealthMetricsEngagementAttendanceTrendPoints(months, today);

    expect(points.map((point) => point.rate)).toEqual([null, null]);
    expect(points.map((point) => point.rateLabel)).toEqual(['—', 'No data']);
    expect(points[0]?.meetingsLabel).toBe('0 meetings');
  });

  it('reads the headline off the latest full month, with its change from the view', () => {
    const summary = buildHealthMetricsEngagementAttendanceTrendSummary(fullYear(), today);

    // October is in progress, so September (50%) leads and the range runs November to September.
    expect(summary).toMatchObject({
      state: 'trend',
      ratedMonths: 12,
      latestLabel: '50%',
      latestCaption: 'September 2026',
      deltaLabel: '+1.0pp',
      deltaDirection: 'up',
      rangeChangeLabel: '+10.0pp',
      rangeHighLabel: '50%',
      rangeLowLabel: '40%',
      isLowConfidence: false,
    });
  });

  // The view's change is measured against a rate the hero hides, so it must not headline.
  it('drops the change when the previous month has no reportable rate', () => {
    const months = fullYear();
    months[9] = month('2026-08-01', 0.9, { meetingsHeld: 1 });

    expect(buildHealthMetricsEngagementAttendanceTrendSummary(months, today)).toMatchObject({ deltaLabel: '—', deltaDirection: 'neutral' });
  });

  it('reports no rated month as empty, and one as too little to chart', () => {
    const quiet = fullYear().map((entry) => ({ ...entry, attendancePct: null, meetingsHeld: 0 }));
    expect(buildHealthMetricsEngagementAttendanceTrendSummary(quiet, today)).toMatchObject({
      state: 'empty',
      ratedMonths: 0,
      latestLabel: '—',
      rangeHighLabel: '—',
    });

    const single = quiet.map((entry, index) => (index === 6 ? month(entry.monthStartDate, 0.5) : entry));
    expect(buildHealthMetricsEngagementAttendanceTrendSummary(single, today)).toMatchObject({ state: 'insufficient', ratedMonths: 1 });
  });

  // Short history still draws the line, under a banner, so two points do not read as a pattern.
  it('flags fewer than six rated months as low confidence, with the count in the note', () => {
    const months = fullYear().map((entry, index) => (index < 8 ? { ...entry, attendancePct: null, meetingsHeld: 0 } : entry));
    const summary = buildHealthMetricsEngagementAttendanceTrendSummary(months, today);

    expect(summary).toMatchObject({ state: 'trend', ratedMonths: 4, isLowConfidence: true });
    expect(summary.lowConfidenceNote).toBe('Only 4 of the last 12 months have attendance from 3 or more meetings, so the trend is indicative, not reliable.');
  });

  // The month in progress counts toward having a trend, but never toward the full-month headline.
  it('leaves the headline unset when the only rated full month is missing', () => {
    const months = [month('2026-09-01', null, { meetingsHeld: 0 }), month('2026-10-01', 0.6)];
    const summary = buildHealthMetricsEngagementAttendanceTrendSummary(months, today);

    expect(summary).toMatchObject({ state: 'insufficient', latestLabel: '—', latestCaption: 'No full month with attendance yet', rangeChangeLabel: '—' });
  });
});

describe('buildHealthMetricsEngagementNewsletterView', () => {
  const year = new Date().getFullYear();
  const period: HealthMetricsEngagementNewsletterPeriod = {
    subscribers: 1490,
    subscribersGrowth: 0.207,
    growthBaselineDate: `${year}-08-10`,
    newslettersSent: 3,
    avgOpenRate: 0.4465,
    avgClickRate: 0.0567,
    avgClickToOpenRate: 0.128,
    avgDeliveryRate: 0.9643,
  };
  const newsletter: HealthMetricsEngagementNewsletter = {
    key: 'n3',
    name: 'Monthly: Latest',
    sentDate: `${year}-10-26`,
    hasEngagementData: true,
    recipients: 1490,
    failed: 61,
    uniqueOpens: 647,
    totalOpens: 997,
    uniqueClicks: 76,
    totalClicks: 1462,
    openRate: 0.4342,
    clickRate: 0.051,
    clickToOpenRate: 0.1175,
  };
  const unengaged: HealthMetricsEngagementNewsletter = {
    ...newsletter,
    key: 'n2',
    name: 'Monthly: No data',
    sentDate: `${year}-09-14`,
    hasEngagementData: false,
    failed: null,
    uniqueOpens: null,
    totalOpens: null,
    uniqueClicks: null,
    totalClicks: null,
    openRate: null,
    clickRate: null,
    clickToOpenRate: null,
  };
  const performance: HealthMetricsEngagementNewsletterPerformance = {
    measured: true,
    periods: { YTD: period, COMPLETED_YEAR: { ...period, newslettersSent: 0 }, COMPLETED_YEAR_2: null, COMPLETED_YEAR_3: null },
    // Latest first, as the server returns them; the last one falls in last year.
    newsletters: [newsletter, unengaged, { ...newsletter, key: 'n1', sentDate: `${year - 1}-12-01` }],
  };

  it('labels the KPIs, with subscriber growth since its baseline month', () => {
    const view = buildHealthMetricsEngagementNewsletterView(performance, 'YTD');

    expect(view.isEmpty).toBe(false);
    expect(view.newslettersSent).toBe(3);
    expect(view.headline).toMatchObject({ value: '1,490', delta: '+21% since Aug', deltaDirection: 'up' });
    expect(view.side.map((kpi) => [kpi.label, kpi.value])).toEqual([
      ['Newsletters sent', '3'],
      ['Avg. open rate', '45%'],
      ['Avg. click rate', '5.7%'],
      ['Click-to-open rate', '13%'],
      ['Delivery rate', '96%'],
    ]);
  });

  it('keeps the period’s newsletters latest first in the table, with dashes where there is no engagement data', () => {
    const rows = buildHealthMetricsEngagementNewsletterView(performance, 'YTD').rows;

    expect(rows.map((row) => row.key)).toEqual(['n3', 'n2']);
    expect(rows[0]).toMatchObject({
      sentLabel: `Sent Oct 26, ${year}`,
      recipientsLabel: '1,490',
      failedLabel: '61 failed',
      uniqueOpensLabel: '647',
      totalOpensLabel: '997 total',
      openRateLabel: '43%',
      clickRateLabel: '5%',
      clickToOpenLabel: '12%',
    });
    expect(rows[1]).toMatchObject({
      recipientsLabel: '1,490',
      failedLabel: '',
      uniqueOpensLabel: '—',
      totalOpensLabel: '',
      openRateLabel: '—',
      openRateWidthPct: 0,
      clickToOpenLabel: '—',
    });
  });

  it('charts oldest first, with rates only for newsletters that have engagement data', () => {
    const view = buildHealthMetricsEngagementNewsletterView(performance, 'YTD');

    expect(view.audiencePoints.map((point) => [point.key, point.tick, point.uniqueOpens])).toEqual([
      ['n2', 'Sep', null],
      ['n3', 'Oct', 647],
    ]);
    expect(view.ratePoints.map((point) => point.key)).toEqual(['n3']);
    expect(view.ratePoints[0].title).toBe(`Monthly: Latest · Oct 26, ${year}`);
    expect(view.ratePoints[0].openPct).toBeCloseTo(43.42);
  });

  it('is empty for a period with no newsletter sent, or a foundation the view has never measured', () => {
    expect(buildHealthMetricsEngagementNewsletterView(performance, 'COMPLETED_YEAR')).toMatchObject({ isEmpty: true, newslettersSent: 0 });
    expect(buildHealthMetricsEngagementNewsletterView({ ...performance, measured: false }, 'YTD')).toMatchObject({ isEmpty: true, newslettersSent: null });
    expect(buildHealthMetricsEngagementNewsletterView(performance, 'COMPLETED_YEAR_4')).toMatchObject({ isEmpty: true, newslettersSent: null, rows: [] });
  });

  it('names the baseline year when it is not the period’s, and draws no delta without growth', () => {
    const view = buildHealthMetricsEngagementNewsletterView(
      { ...performance, periods: { ...performance.periods, YTD: { ...period, growthBaselineDate: `${year - 1}-03-02` } } },
      'YTD'
    );
    expect(view.headline.delta).toBe(`+21% since Mar ${year - 1}`);

    const flat = buildHealthMetricsEngagementNewsletterView(
      { ...performance, periods: { ...performance.periods, YTD: { ...period, subscribersGrowth: 0.001 } } },
      'YTD'
    );
    expect(flat.headline).toMatchObject({ delta: null, deltaDirection: 'neutral' });
  });
});

describe('newsletter recipient rules', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const recipient = (overrides: Partial<HealthMetricsEngagementRecipient>): HealthMetricsEngagementRecipient => ({
    rank: 1,
    name: 'Maya Okonkwo',
    organization: 'Acme Motors',
    deliveryStatus: 'Delivered',
    segment: 'opened',
    clicked: true,
    opens: 2,
    lastOpenedAt: '2026-10-28T00:00:00Z',
    clicks: 5,
    lastClickedAt: '2026-10-27T11:00:00Z',
    ...overrides,
  });
  const recipients = [
    recipient({ rank: 1 }),
    // Clicked without a recorded open: not opened, yet still in the Clicked cut.
    recipient({ rank: 2, name: 'Daniel Reyes', organization: 'Vendor Corp', segment: 'not-opened', opens: 0, lastOpenedAt: null }),
    recipient({ rank: 3, name: null, organization: null, segment: 'not-opened', clicked: false, opens: 0, clicks: 0, lastOpenedAt: null, lastClickedAt: null }),
    // The view can carry an open time on a failed delivery; the row still reads "—".
    recipient({ rank: 4, name: 'Chen Yu', deliveryStatus: 'Failed', segment: 'failed', clicked: false, opens: null, clicks: null, lastClickedAt: null }),
  ];

  it('counts each cut, with a click outside any open counted under both Clicked and Not opened', () => {
    expect(countHealthMetricsEngagementRecipients(recipients)).toEqual({ all: 4, opened: 1, clicked: 2, 'not-opened': 2, failed: 1 });
  });

  it('cuts by segment or click and searches name and organization, keeping the engagement order', () => {
    expect(filterHealthMetricsEngagementRecipients(recipients, 'clicked', '').map((row) => row.rank)).toEqual([1, 2]);
    expect(filterHealthMetricsEngagementRecipients(recipients, 'all', '  vendor ').map((row) => row.rank)).toEqual([2]);
    expect(filterHealthMetricsEngagementRecipients(recipients, 'not-opened', 'reyes').map((row) => row.rank)).toEqual([2]);
  });

  it('labels a row, with dashes for a failed delivery and for a missing name or organization', () => {
    expect(buildHealthMetricsEngagementRecipientRow(recipients[0], now)).toMatchObject({
      nameLabel: 'Maya Okonkwo',
      deliveryLabel: 'Delivered',
      engagementLabel: 'Opened',
      opensLabel: '2',
      lastOpenedLabel: '12 hr ago',
      clicksLabel: '5',
      lastClickedLabel: '1 day ago',
    });
    expect(buildHealthMetricsEngagementRecipientRow(recipients[2], now)).toMatchObject({
      nameLabel: '—',
      organizationLabel: '—',
      engagementLabel: 'Not opened',
    });
    expect(buildHealthMetricsEngagementRecipientRow(recipients[3], now)).toMatchObject({
      deliveryLabel: 'Failed',
      engagementLabel: '',
      opensLabel: '—',
      clicksLabel: '—',
      lastOpenedLabel: '—',
      lastClickedLabel: '—',
    });
  });

  it('words a time relative to now, falling back to the date past 30 days', () => {
    expect(formatHealthMetricsRelativeTime(null, now)).toBe('—');
    expect(formatHealthMetricsRelativeTime('2026-10-28T11:59:40Z', now)).toBe('Just now');
    expect(formatHealthMetricsRelativeTime('2026-10-28T11:15:00Z', now)).toBe('45 min ago');
    expect(formatHealthMetricsRelativeTime('2026-10-24T12:00:00Z', now)).toBe('4 days ago');
    expect(formatHealthMetricsRelativeTime('2026-08-01T12:00:00Z', now)).toBe('Aug 1, 2026');
  });
});
