// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Engagement page's display rules. These encode the acceptance criteria that are
// easiest to get wrong: an em dash is not 0%, a thin period is "No data" not a percentage, and a
// group with no invited population is not the same as one nobody attended.

import { describe, expect, it } from 'vitest';

import {
  HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '../constants/health-metrics-engagement.constants';
import {
  HealthMetricsEngagementGroupRow,
  HealthMetricsEngagementNonMemberRow,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementParticipationRow,
  HealthMetricsEngagementRepPeriodCounts,
  HealthMetricsEngagementRepRow,
  HealthMetricsEngagementSubNavCounts,
} from '../interfaces/health-metrics-engagement.interface';
import {
  buildHealthMetricsEngagementGroupTrend,
  buildHealthMetricsEngagementSubNavItems,
  filterHealthMetricsEngagementOrgRows,
  filterHealthMetricsEngagementRepRows,
  formatHealthMetricsEngagementAttendance,
  formatHealthMetricsEngagementAvgReps,
  formatHealthMetricsEngagementCount,
  formatHealthMetricsEngagementPctDelta,
  formatHealthMetricsEngagementPpDelta,
  formatHealthMetricsEngagementRatio,
  resolveHealthMetricsEngagementAttendanceTone,
  resolveHealthMetricsEngagementDeltaDirection,
  selectHealthMetricsEngagementGroupPeriod,
  selectHealthMetricsEngagementNonMemberPeriod,
  selectHealthMetricsEngagementParticipationPeriod,
  selectHealthMetricsEngagementRepCounts,
  selectHealthMetricsEngagementRepPeriod,
  sortHealthMetricsEngagementNonMemberRows,
} from './health-metrics-engagement.utils';

function counts(overrides: Partial<HealthMetricsEngagementSubNavCounts> = {}): HealthMetricsEngagementSubNavCounts {
  return {
    groups: 12,
    dormantGroups: 0,
    orgs: 40,
    lapsedOrgs: 0,
    reps: 88,
    neverAttendedReps: 0,
    nonMemberOrgs: 6,
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

  it('spells the dormant-group note, and drops it at zero', () => {
    const dormant = buildHealthMetricsEngagementSubNavItems(counts({ dormantGroups: 2 }));
    expect(dormant.find((item) => item.key === 'committees')?.note).toBe('2 dormant');

    const neither = buildHealthMetricsEngagementSubNavItems(counts());
    expect(neither.find((item) => item.key === 'committees')?.note).toBe('');
  });

  it('spells the lapsed-org and never-attended notes from the counts', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts({ lapsedOrgs: 7, neverAttendedReps: 3 }));

    expect(items.find((item) => item.key === 'orgs')?.note).toBe(`7 inactive ${HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS} days`);
    expect(items.find((item) => item.key === 'reps')?.note).toBe('3 never attended');
  });

  it('suppresses the note for a section whose total has not resolved yet', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts({ groups: null, dormantGroups: 2 }));
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
});

describe('selectHealthMetricsEngagementGroupPeriod / buildHealthMetricsEngagementGroupTrend', () => {
  const row: HealthMetricsEngagementGroupRow = {
    committeeId: 'c-1',
    committeeName: 'Technical Steering Committee',
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

  it('renders a fractional change in a count as a percent', () => {
    expect(formatHealthMetricsEngagementPctDelta(0.12)).toBe('+12.0%');
    expect(formatHealthMetricsEngagementPctDelta(-0.12)).toBe('−12.0%');
    expect(formatHealthMetricsEngagementPctDelta(null)).toBe('—');
  });

  // A decline too small to show at one decimal must not print as a signed zero or paint the
  // label red — the label and its colour read the same rounded value.
  it('treats a change that rounds away as no movement, in both the label and the direction', () => {
    expect(formatHealthMetricsEngagementPpDelta(-0.0004)).toBe('+0.0pp');
    expect(formatHealthMetricsEngagementPctDelta(-0.0004)).toBe('+0.0%');
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

  it('ranks by the selected period, so the period pill re-sorts rather than re-reads', () => {
    const rows = [nonMemberRow('Acme Motors', 4), nonMemberRow('Vendor Corp', 1)];

    expect(sortHealthMetricsEngagementNonMemberRows(rows, 'YTD').map((row) => row.accountName)).toEqual(['Vendor Corp', 'Acme Motors']);
    expect(sortHealthMetricsEngagementNonMemberRows(rows, 'COMPLETED_YEAR').map((row) => row.accountName)).toEqual(['Acme Motors', 'Vendor Corp']);
  });

  // An unranked row is not the best row — sorting it first would put a blank at the top of the table.
  it('sorts an unranked organization last, and breaks a rank tie by name', () => {
    const rows = [nonMemberRow('Unranked Co', null), nonMemberRow('Zeta Labs', 2), nonMemberRow('Alpha Works', 2)];

    expect(sortHealthMetricsEngagementNonMemberRows(rows, 'YTD').map((row) => row.accountName)).toEqual(['Alpha Works', 'Zeta Labs', 'Unranked Co']);
  });

  it("leaves the caller's array untouched, since the rows are shared with the response signal", () => {
    const rows = [nonMemberRow('Zeta Labs', 5), nonMemberRow('Alpha Works', 1)];
    sortHealthMetricsEngagementNonMemberRows(rows, 'YTD');

    expect(rows.map((row) => row.accountName)).toEqual(['Zeta Labs', 'Alpha Works']);
  });
});

describe('representatives rules', () => {
  function repRow(personName: string, accountName: string, overrides: Partial<HealthMetricsEngagementRepRow> = {}): HealthMetricsEngagementRepRow {
    return {
      key: `${personName}|${accountName}`.toLowerCase(),
      personName,
      accountName,
      committeeName: 'Technical Steering Committee',
      lastAttendedDate: '2026-08-14',
      // Oldest-first, as the server builds them from `HEALTH_METRICS_ENGAGEMENT_RANGES`.
      periods: [
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 2, neverAttended: false, lapsed: false },
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
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false },
        { range: 'YTD', meetingsInvited: 0, meetingsAttended: 0, neverAttended: false, lapsed: false },
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
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 0, neverAttended: true, lapsed: false },
        { range: 'YTD', meetingsInvited: null, meetingsAttended: null, neverAttended: false, lapsed: false },
      ],
    });
    const rows = [repRow('Dana Fields', 'Acme Motors'), unmeasured];

    expect(filterHealthMetricsEngagementRepRows(rows, 'all', '', 'YTD').map((row) => row.personName)).toEqual(['Dana Fields']);
  });

  it('cuts on the selected period own flags rather than a client-side date comparison', () => {
    const lapsed = repRow('Sam Rivera', 'Vendor Corp', {
      periods: [
        { range: 'COMPLETED_YEAR', meetingsInvited: 4, meetingsAttended: 1, neverAttended: false, lapsed: false },
        { range: 'YTD', meetingsInvited: 6, meetingsAttended: 1, neverAttended: false, lapsed: true },
      ],
    });
    const rows = [repRow('Dana Fields', 'Acme Motors'), lapsed];

    expect(filterHealthMetricsEngagementRepRows(rows, 'lapsed', '', 'YTD').map((row) => row.personName)).toEqual(['Sam Rivera']);
    // The same pair reads differently in the completed year, where neither flag is set.
    expect(filterHealthMetricsEngagementRepRows(rows, 'lapsed', '', 'COMPLETED_YEAR')).toEqual([]);
    expect(filterHealthMetricsEngagementRepRows(rows, 'never', '', 'COMPLETED_YEAR').map((row) => row.personName)).toEqual(['Dana Fields']);
  });

  // The name and its organization sub-line read as one cell, so one term searches both.
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
});
