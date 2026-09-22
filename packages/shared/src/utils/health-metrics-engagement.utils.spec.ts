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
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementParticipationRow,
  HealthMetricsEngagementSubNavCounts,
} from '../interfaces/health-metrics-engagement.interface';
import {
  buildHealthMetricsEngagementGroupTrend,
  buildHealthMetricsEngagementSectionId,
  buildHealthMetricsEngagementSubNavItems,
  filterHealthMetricsEngagementOrgRows,
  formatHealthMetricsEngagementAttendance,
  formatHealthMetricsEngagementAvgReps,
  formatHealthMetricsEngagementPctDelta,
  formatHealthMetricsEngagementPpDelta,
  isHealthMetricsEngagementSectionKey,
  resolveHealthMetricsEngagementAttendanceTone,
  resolveHealthMetricsEngagementDeltaDirection,
  selectHealthMetricsEngagementGroupPeriod,
  selectHealthMetricsEngagementParticipationPeriod,
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

describe('buildHealthMetricsEngagementSectionId', () => {
  it('prefixes the key so the DOM id never collides with the bare URL fragment', () => {
    expect(buildHealthMetricsEngagementSectionId('committees')).toBe('sec-eng-committees');
  });
});

describe('isHealthMetricsEngagementSectionKey', () => {
  it('accepts every shipped section key', () => {
    for (const section of HEALTH_METRICS_ENGAGEMENT_SECTIONS) {
      expect(isHealthMetricsEngagementSectionKey(section.key)).toBe(true);
    }
  });

  it('rejects anything else, including the prefixed DOM id and an absent fragment', () => {
    expect(isHealthMetricsEngagementSectionKey('sec-eng-committees')).toBe(false);
    expect(isHealthMetricsEngagementSectionKey('groups')).toBe(false);
    expect(isHealthMetricsEngagementSectionKey(null)).toBe(false);
    expect(isHealthMetricsEngagementSectionKey(undefined)).toBe(false);
  });
});

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
      periods: [
        { range: 'YTD', meetingsHeld: 30, meetingsTotal: 27, invitedCount: 27, attendedCount: 21, attendancePct: 0.78, avgReps: 1.75, sortRank },
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
