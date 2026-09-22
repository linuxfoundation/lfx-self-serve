// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the Engagement page's display rules. These encode the acceptance criteria that are
// easiest to get wrong: an em dash is not 0%, a thin period is "No data" not a percentage, and a
// group with no invited population is not the same as one nobody attended.

import { describe, expect, it } from 'vitest';

import {
  HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '../constants/health-metrics-engagement.constants';
import { HealthMetricsEngagementGroupRow, HealthMetricsEngagementSubNavCounts } from '../interfaces/health-metrics-engagement.interface';
import {
  buildHealthMetricsEngagementGroupTrend,
  buildHealthMetricsEngagementSectionId,
  buildHealthMetricsEngagementSubNavItems,
  formatHealthMetricsEngagementAttendance,
  isHealthMetricsEngagementSectionKey,
  resolveHealthMetricsEngagementAttendanceTone,
  selectHealthMetricsEngagementGroupPeriod,
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

  it('joins both halves of the group note, and drops either half at zero', () => {
    const both = buildHealthMetricsEngagementSubNavItems(counts({ dormantGroups: 2, lowAttendanceGroups: 5 }));
    expect(both.find((item) => item.key === 'committees')?.note).toBe('2 dormant · 5 below 50%');

    const dormantOnly = buildHealthMetricsEngagementSubNavItems(counts({ dormantGroups: 2 }));
    expect(dormantOnly.find((item) => item.key === 'committees')?.note).toBe('2 dormant');

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
});
