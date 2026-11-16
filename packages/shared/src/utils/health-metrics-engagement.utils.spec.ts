// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Engagement page's display rules. These encode the acceptance criteria that are
// easiest to get wrong: an em dash is not 0%, a thin period is "No data" not a percentage, and a
// group with no invited population is not the same as one nobody attended.

import { describe, expect, it } from 'vitest';

import {
  HEALTH_METRICS_ENGAGEMENT_BOARD_ATTENDANCE_RULE,
  HEALTH_METRICS_ENGAGEMENT_BOARD_BAR_FILL,
  HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '../constants/health-metrics-engagement.constants';
import { HEALTH_METRICS_VALUE_BAR_FILL } from '../constants/health-metrics-table.constants';
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
  buildHealthMetricsEngagementGroupRowView,
  buildHealthMetricsEngagementParticipationMetrics,
  buildHealthMetricsEngagementParticipationRowView,
  buildHealthMetricsEngagementRepLabels,
  buildHealthMetricsEngagementSubNavItems,
  filterHealthMetricsEngagementOrgRows,
  filterHealthMetricsEngagementRepRows,
  formatHealthMetricsEngagementAttendance,
  formatHealthMetricsEngagementAvgReps,
  buildHealthMetricsEngagementNewsletterChart,
  buildHealthMetricsEngagementNewsletterView,
  buildHealthMetricsEngagementRecipientRow,
  countHealthMetricsEngagementRecipients,
  filterHealthMetricsEngagementRecipients,
  formatHealthMetricsShortAge,
  buildHealthMetricsEngagementRecipientMetrics,
  formatHealthMetricsEngagementCount,
  formatHealthMetricsEngagementPpDelta,
  formatHealthMetricsEngagementRatio,
  resolveHealthMetricsEngagementAttendanceTone,
  resolveHealthMetricsEngagementDeltaDirection,
  resolveHealthMetricsEngagementGroupKind,
  parseHealthMetricsEngagementGroupType,
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
  return { dormantGroups: 0, lowAttendanceGroups: 0, lapsedOrgs: 0, neverAttendedReps: 0, ...overrides };
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

  it('notes only committees, orgs and reps; every other section stays bare', () => {
    const items = buildHealthMetricsEngagementSubNavItems(counts({ dormantGroups: 2, lapsedOrgs: 7, neverAttendedReps: 3 }));

    expect(items.filter((item) => item.note !== '').map((item) => item.key)).toEqual(['committees', 'orgs', 'reps']);
  });
});

describe('group attendance rows', () => {
  const row: HealthMetricsEngagementGroupRow = {
    committeeId: 'c-1',
    committeeName: 'Technical Steering Committee',
    projectId: 'p-1',
    projectSlug: 'acme-core',
    projectName: 'Acme Core',
    groupTypeLabel: 'Governance',
    meetingTypeGroup: 'Technical',
    lastMetDate: '2026-08-14',
    periods: [
      { range: 'COMPLETED_YEAR_3', meetingsHeld: 10, invitedCount: 100, attendedCount: 54, attendancePct: 0.54, dormant: false },
      { range: 'COMPLETED_YEAR_2', meetingsHeld: 0, invitedCount: 0, attendedCount: 0, attendancePct: null, dormant: true },
      { range: 'COMPLETED_YEAR', meetingsHeld: 12, invitedCount: 120, attendedCount: 71, attendancePct: 0.59, dormant: false },
      { range: 'YTD', meetingsHeld: 8, invitedCount: 80, attendedCount: 50, attendancePct: 0.625, dormant: false },
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

  it.each([
    ['wg', 'wg'],
    ['gov', 'gov'],
    ['toString', 'all'],
    [null, 'all'],
  ])('reads the group type %s from the URL as %s', (value, expected) => {
    expect(parseHealthMetricsEngagementGroupType(value)).toBe(expected);
  });

  it.each([
    ['Governance', 'Board', HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.board],
    ['Governance', 'Technical', HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.oversight],
    ['Governance', null, HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.oversight],
    ['Working groups', 'Working Group', HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.workingGroup],
    ['SIG / TAG', 'Other', HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.sigTag],
    ['Other', 'Board', HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.other],
    [null, null, HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.other],
  ])('reads a %s group of meeting type %s as its kind', (groupTypeLabel, meetingTypeGroup, kind) => {
    expect(resolveHealthMetricsEngagementGroupKind({ ...row, groupTypeLabel, meetingTypeGroup })).toBe(kind);
  });

  it('builds a measured row with its rounded rate, date and kind', () => {
    expect(buildHealthMetricsEngagementGroupRowView(row, 'YTD')).toEqual({
      key: 'c-1',
      name: 'Technical Steering Committee',
      kind: HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS.oversight,
      meetings: '8',
      lastMetLabel: 'Aug 14, 2026',
      dormant: false,
      attendanceLabel: '63%',
      attendancePct: 63,
    });
  });

  it('shows a dash for no meetings, no rate and no last meeting', () => {
    const view = buildHealthMetricsEngagementGroupRowView({ ...row, lastMetDate: null }, 'COMPLETED_YEAR_2');

    expect(view).toMatchObject({ meetings: '—', lastMetLabel: '—', dormant: true, attendanceLabel: '—', attendancePct: null });
  });

  // Too few meetings to rate reads as no rate, not as a percentage built on one or two meetings.
  it('drops the rate below the minimum meetings', () => {
    const periods = row.periods.map((period) =>
      period.range === 'YTD' ? { ...period, meetingsHeld: HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE - 1 } : period
    );

    expect(buildHealthMetricsEngagementGroupRowView({ ...row, periods }, 'YTD')).toMatchObject({ meetings: '2', attendanceLabel: '—', attendancePct: null });
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

  it('names a row by its short meeting type, with its icon, Members pointer and board bar rule', () => {
    expect(buildHealthMetricsEngagementParticipationRowView(participationRow, 'YTD')).toEqual({
      key: 'Board',
      name: 'Board',
      icon: 'fa-light fa-user-check',
      description: 'Board & voting-member attendance',
      governance: true,
      meetings: '7',
      attendanceLabel: '86%',
      attendancePct: 86,
      fillRule: HEALTH_METRICS_ENGAGEMENT_BOARD_BAR_FILL,
    });
  });

  it('gives a type the view adds later the Other icon and the default bar rule', () => {
    const view = buildHealthMetricsEngagementParticipationRowView(
      { ...participationRow, group: 'Outreach', label: 'Outreach groups', governance: false },
      'YTD'
    );

    expect(view).toMatchObject({ name: 'Outreach', icon: 'fa-light fa-calendar-days', description: '', fillRule: HEALTH_METRICS_VALUE_BAR_FILL });
  });

  it('turns the board bar danger below 90%', () => {
    expect(HEALTH_METRICS_ENGAGEMENT_BOARD_BAR_FILL.thresholds).toEqual([{ below: 90, fillClass: 'bg-red-500' }]);
  });

  it('builds the metrics row with the attendance change as a coloured lead', () => {
    expect(buildHealthMetricsEngagementParticipationMetrics(participationRow, 'COMPLETED_YEAR')).toEqual([
      {
        key: 'attendance',
        label: 'All-meeting attendance',
        value: '80%',
        descriptionLead: '−3.0pp',
        description: 'vs previous period',
        descriptionLeadTone: 'down',
      },
      { key: 'meetings', label: 'Meetings held', value: '12' },
      { key: 'groups', label: 'Active groups', value: '7 / 8' },
      { key: 'never', label: 'Never attended', value: '1' },
    ]);
  });

  // A change that rounds to zero is not movement, so it reads grey rather than as a rise.
  it('greys a change that rounds away', () => {
    const flat = { ...participationRow, periods: participationRow.periods.map((period) => ({ ...period, attendanceChangePp: 0.0004 })) };

    expect(buildHealthMetricsEngagementParticipationMetrics(flat, 'YTD')[0]).toMatchObject({ descriptionLead: '+0.0pp', descriptionLeadTone: 'flat' });
  });

  it('leaves the change out when there is no prior period, and dashes an unread total', () => {
    expect(buildHealthMetricsEngagementParticipationMetrics(participationRow, 'COMPLETED_YEAR_3')[0]).toEqual({
      key: 'attendance',
      label: 'All-meeting attendance',
      value: '80%',
    });
    expect(buildHealthMetricsEngagementParticipationMetrics(null, 'YTD').map((item) => item.value)).toEqual(['—', '—', '—', '—']);
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

  it('builds the metrics row, with growth since its baseline month and the delivery and click-to-open rates as descriptions', () => {
    const view = buildHealthMetricsEngagementNewsletterView(performance, 'YTD');

    expect(view.isEmpty).toBe(false);
    expect(view.metrics).toEqual([
      { key: 'subscribers', label: 'Subscribers', value: '1,490', descriptionLead: '+21%', descriptionLeadTone: 'up', description: 'since Aug' },
      { key: 'sent', label: 'Newsletters sent', value: '3', description: '96% delivered' },
      { key: 'open', label: 'Avg. open rate', value: '45%' },
      { key: 'click', label: 'Avg. click rate', value: '5.7%', description: '13% of opens' },
    ]);
  });

  it('leaves out a description with no rate behind it', () => {
    const view = buildHealthMetricsEngagementNewsletterView(
      { ...performance, periods: { ...performance.periods, YTD: { ...period, avgDeliveryRate: null, avgClickToOpenRate: null } } },
      'YTD'
    );

    expect(view.metrics[1]).toEqual({ key: 'sent', label: 'Newsletters sent', value: '3' });
    expect(view.metrics[3]).toEqual({ key: 'click', label: 'Avg. click rate', value: '5.7%' });
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
      openRatePct: expect.closeTo(43.42),
      clickRateLabel: '5%',
      clickToOpenLabel: '12%',
    });
    expect(rows[1]).toMatchObject({
      recipientsLabel: '1,490',
      failedLabel: '',
      uniqueOpensLabel: '—',
      totalOpensLabel: '',
      openRateLabel: '—',
      openRatePct: null,
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
    expect(buildHealthMetricsEngagementNewsletterView(performance, 'COMPLETED_YEAR')).toMatchObject({ isEmpty: true });
    expect(buildHealthMetricsEngagementNewsletterView({ ...performance, measured: false }, 'YTD')).toMatchObject({ isEmpty: true });
    expect(buildHealthMetricsEngagementNewsletterView(performance, 'COMPLETED_YEAR_4')).toMatchObject({ isEmpty: true, rows: [] });
  });

  it('names the baseline year when it is not the period’s, and draws no delta without growth', () => {
    const view = buildHealthMetricsEngagementNewsletterView(
      { ...performance, periods: { ...performance.periods, YTD: { ...period, growthBaselineDate: `${year - 1}-03-02` } } },
      'YTD'
    );
    expect(view.metrics[0]).toMatchObject({ descriptionLead: '+21%', description: `since Mar ${year - 1}` });

    const flat = buildHealthMetricsEngagementNewsletterView(
      { ...performance, periods: { ...performance.periods, YTD: { ...period, subscribersGrowth: 0.001 } } },
      'YTD'
    );
    expect(flat.metrics[0]).toEqual({ key: 'subscribers', label: 'Subscribers', value: '1,490' });
  });
});

describe('buildHealthMetricsEngagementNewsletterChart', () => {
  const point = (key: string, tick: string, open: number | null, click: number | null, cto: number | null, recipients: number, opens: number | null) => ({
    key,
    tick,
    title: `${key} · ${tick} 1, 2026`,
    openPct: open,
    clickPct: click,
    clickToOpenPct: cto,
    recipients,
    uniqueOpens: opens,
  });
  const points = [point('a', 'Jan', 41.2, 5.1, 12.4, 1400, 577), point('b', 'Feb', 47.9, 6.0, 12.5, 1458, 698)];

  it('plots the rates to the peak open rate rounded up to the next 10%, click-to-open dashed', () => {
    const { chart, legend } = buildHealthMetricsEngagementNewsletterChart(points, 'rates');

    expect(chart.yTicks).toEqual(['50%', '38%', '25%', '13%', '0%']);
    expect(chart.paths.map((path) => [path.key, path.dashed])).toEqual([
      ['open', false],
      ['click', false],
      ['cto', true],
    ]);
    expect(chart.area?.color).toBe('#009AFF');
    expect(chart.ticks.map((tick) => tick.label)).toEqual(['Jan', 'Feb']);
    expect(chart.ariaLabel).toBe('Open, click and click-to-open rate by newsletter');
    expect(legend.map((item) => [item.label, item.color])).toEqual([
      ['Open rate', '#009AFF'],
      ['Click rate', '#AD46FF'],
      ['Click-to-open rate', '#00BC7D'],
    ]);
  });

  it('titles each popup with the newsletter and its date, one inline row per series', () => {
    const tip = buildHealthMetricsEngagementNewsletterChart(points, 'rates').chart.columns[1].tip;

    expect(tip.title).toBe('b · Feb 1, 2026');
    expect(tip.rows.map((row) => [row.label, row.value, row.inline])).toEqual([
      ['Open rate', '48%', true],
      ['Click rate', '6%', true],
      ['Click-to-open rate', '13%', true],
    ]);
  });

  it('keeps the rate axis between 10% and 100%', () => {
    expect(buildHealthMetricsEngagementNewsletterChart([point('a', 'Jan', 2, 1, 1, 10, 1)], 'rates').chart.yTicks[0]).toBe('10%');
    expect(buildHealthMetricsEngagementNewsletterChart([point('a', 'Jan', 100, 1, 1, 10, 1)], 'rates').chart.yTicks[0]).toBe('100%');
    // 0.3 * 100 is 30.000000000000004 in JavaScript; the axis still tops out at 30%.
    expect(buildHealthMetricsEngagementNewsletterChart([point('a', 'Jan', 0.3 * 100, 1, 1, 10, 1)], 'rates').chart.yTicks[0]).toBe('30%');
  });

  it('plots the audience to a round ceiling over its peak, with counts in the popup', () => {
    const { chart, legend } = buildHealthMetricsEngagementNewsletterChart(points, 'audience');

    expect(chart.yTicks).toEqual(['1,600', '1,200', '800', '400', '0']);
    expect(chart.columns[0].tip.rows.map((row) => [row.label, row.value])).toEqual([
      ['Recipients', '1,400'],
      ['Unique opens', '577'],
    ]);
    expect(legend.map((item) => item.label)).toEqual(['Recipients', 'Unique opens']);
    expect(chart.ariaLabel).toBe('Recipients and unique opens by newsletter');
  });
});

describe('newsletter recipient rules', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  // Synthetic recipients: the names are placeholders and the organizations come from the synthetic-org fixtures.
  const recipient = (overrides: Partial<HealthMetricsEngagementRecipient>): HealthMetricsEngagementRecipient => ({
    rank: 1,
    name: 'Recipient Alpha',
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
    recipient({ rank: 2, name: 'Recipient Bravo', organization: 'Vendor Corp', segment: 'not-opened', opens: 0, lastOpenedAt: null }),
    recipient({ rank: 3, name: null, organization: null, segment: 'not-opened', clicked: false, opens: 0, clicks: 0, lastOpenedAt: null, lastClickedAt: null }),
    // The view can carry an open time on a failed delivery; the row still reads "—".
    recipient({
      rank: 4,
      name: 'Recipient Charlie',
      deliveryStatus: 'Failed',
      segment: 'failed',
      clicked: false,
      opens: null,
      clicks: null,
      lastClickedAt: null,
    }),
  ];

  it('counts each cut, with a click outside any open counted under both Clicked and Not opened', () => {
    expect(countHealthMetricsEngagementRecipients(recipients)).toEqual({ all: 4, opened: 1, clicked: 2, 'not-opened': 2, failed: 1 });
  });

  it('counts a failed delivery only as Failed, even where the view still segments it as not opened', () => {
    const bounced = recipient({ rank: 5, deliveryStatus: 'Failed', segment: 'not-opened', clicked: false });
    expect(countHealthMetricsEngagementRecipients([bounced])).toEqual({ all: 1, opened: 0, clicked: 0, 'not-opened': 0, failed: 1 });
    // A stray click on a failed delivery does not put it under Clicked either.
    const clickedBounce = recipient({ rank: 6, deliveryStatus: 'Failed', segment: 'failed', clicked: true });
    expect(countHealthMetricsEngagementRecipients([clickedBounce])).toEqual({ all: 1, opened: 0, clicked: 0, 'not-opened': 0, failed: 1 });
    expect(buildHealthMetricsEngagementRecipientRow(bounced, now).deliveryLabel).toBe('Failed');
  });

  it('cuts by segment or click and searches name and organization, keeping the engagement order', () => {
    expect(filterHealthMetricsEngagementRecipients(recipients, 'clicked', '').map((row) => row.rank)).toEqual([1, 2]);
    expect(filterHealthMetricsEngagementRecipients(recipients, 'all', '  vendor ').map((row) => row.rank)).toEqual([2]);
    expect(filterHealthMetricsEngagementRecipients(recipients, 'not-opened', 'bravo').map((row) => row.rank)).toEqual([2]);
  });

  it('labels a row, with dashes for a failed delivery and for a missing name or organization', () => {
    expect(buildHealthMetricsEngagementRecipientRow(recipients[0], now)).toMatchObject({
      nameLabel: 'Recipient Alpha',
      deliveryLabel: 'Delivered',
      engagementLabel: 'Opened',
      deliveryTone: 'success',
      engagementTone: 'accent',
      opensLabel: '2',
      opensDescription: 'Last opened 12h',
      clicksLabel: '5',
      clicksDescription: 'Last clicked 1d',
    });
    expect(buildHealthMetricsEngagementRecipientRow(recipients[2], now)).toMatchObject({
      nameLabel: '—',
      description: '',
      engagementLabel: 'Not opened',
      engagementTone: 'neutral',
    });
    expect(buildHealthMetricsEngagementRecipientRow(recipients[3], now)).toMatchObject({
      deliveryLabel: 'Failed',
      deliveryTone: 'danger',
      engagementLabel: '',
      opensLabel: '—',
      clicksLabel: '—',
      opensDescription: '',
      clicksDescription: '',
    });
  });

  // A pending delivery has not landed, so it reads and counts as not opened, whatever the view segments it as.
  it('badges a pending delivery neutral and reads and counts it as not opened', () => {
    const pending = { ...recipients[0], deliveryStatus: 'Pending' };

    expect(buildHealthMetricsEngagementRecipientRow(pending, now)).toMatchObject({
      deliveryLabel: 'Pending',
      deliveryTone: 'neutral',
      engagementLabel: 'Not opened',
      engagementTone: 'neutral',
      opensDescription: '',
      clicksDescription: '',
    });
    expect(filterHealthMetricsEngagementRecipients([pending], 'opened', '')).toEqual([]);
    expect(filterHealthMetricsEngagementRecipients([pending], 'clicked', '')).toEqual([]);
    expect(filterHealthMetricsEngagementRecipients([pending], 'not-opened', '')).toEqual([pending]);
  });

  it('gives a nameless recipient an empty avatar name, so the avatar shows its glyph', () => {
    expect(buildHealthMetricsEngagementRecipientRow(recipients[2], now)).toMatchObject({ nameLabel: '—', avatarName: '' });
    expect(buildHealthMetricsEngagementRecipientRow(recipients[0], now).avatarName).toBe('Recipient Alpha');
  });

  it('builds the status counts as a metrics row, each with its dot and tooltip', () => {
    const metrics = buildHealthMetricsEngagementRecipientMetrics(recipients);

    expect(metrics.map((metric) => [metric.label, metric.dotClass])).toEqual([
      ['Opened', 'bg-blue-500'],
      ['Clicked', 'bg-violet-500'],
      ['Not opened', 'bg-gray-400'],
      ['Failed', 'bg-red-500'],
    ]);
    expect(metrics.map((metric) => metric.value)).toEqual(['1', '2', '2', '1']);
    expect(metrics[0].tip).toBe('Recipients who opened the newsletter at least once. Some mail clients block tracking, so this is a floor.');
  });

  it("words a time in the design's short units, and leaves no time empty", () => {
    expect(formatHealthMetricsShortAge(null, now)).toBe('');
    expect(formatHealthMetricsShortAge('2026-10-28T11:59:40Z', now)).toBe('1m');
    expect(formatHealthMetricsShortAge('2026-10-28T11:15:00Z', now)).toBe('45m');
    expect(formatHealthMetricsShortAge('2026-10-28T09:00:00Z', now)).toBe('3h');
    expect(formatHealthMetricsShortAge('2026-10-24T12:00:00Z', now)).toBe('4d');
    expect(formatHealthMetricsShortAge('2026-10-10T12:00:00Z', now)).toBe('2w');
    expect(formatHealthMetricsShortAge('2026-08-01T12:00:00Z', now)).toBe('2mo');
  });
});
