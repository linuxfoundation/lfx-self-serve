// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS,
  HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '../constants/health-metrics-engagement.constants';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type {
  HealthMetricsEngagementAttendanceTone,
  HealthMetricsEngagementGroupPeriod,
  HealthMetricsEngagementGroupRow,
  HealthMetricsEngagementOrgFilter,
  HealthMetricsEngagementOrgPeriod,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementParticipationPeriod,
  HealthMetricsEngagementParticipationRow,
  HealthMetricsEngagementSectionKey,
  HealthMetricsEngagementSubNavCounts,
  HealthMetricsEngagementSubNavItem,
} from '../interfaces/health-metrics-engagement.interface';

/** DOM id for a section; the URL fragment stays the bare key. */
export function buildHealthMetricsEngagementSectionId(key: HealthMetricsEngagementSectionKey): string {
  return `${HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX}${key}`;
}

/** True when `fragment` names one of the six sections — the deep-link allowlist. */
export function isHealthMetricsEngagementSectionKey(fragment: string | null | undefined): fragment is HealthMetricsEngagementSectionKey {
  return HEALTH_METRICS_ENGAGEMENT_SECTIONS.some((section) => section.key === fragment);
}

/**
 * Attendance display rule. `null` means no invited population at all (em dash, never `0%`), and a
 * period with too few meetings reads "No data" rather than a percentage built on one or two events.
 */
export function formatHealthMetricsEngagementAttendance(fraction: number | null, meetingsHeld: number): string {
  if (fraction === null) {
    return '—';
  }
  if (meetingsHeld < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE) {
    return 'No data';
  }

  return `${Math.round(fraction * 100)}%`;
}

/**
 * Three bar states, not the Overview's five classification codes: nobody showed up, showing up
 * badly, or fine. Blue is the design's interaction colour and is deliberately reused for "fine".
 */
export function resolveHealthMetricsEngagementAttendanceTone(fraction: number | null): HealthMetricsEngagementAttendanceTone {
  if (fraction === null || fraction === 0) {
    return 'empty';
  }

  return fraction < HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD ? 'low' : 'ok';
}

/**
 * The row's numbers for one period. `ENGAGEMENT_GROUP_ATTENDANCE` carries four periods and no
 * `COMPLETED_YEAR_4`, so an unsupported range falls back to the most recent one rather than blanking.
 */
export function selectHealthMetricsEngagementGroupPeriod(
  row: HealthMetricsEngagementGroupRow,
  range: HealthMetricsRange
): HealthMetricsEngagementGroupPeriod | null {
  return selectPeriod(row.periods, range);
}

/**
 * Sparkline series, oldest → current. A period stays `null` when it had no invited population or
 * too few meetings to rate, matching `formatHealthMetricsEngagementAttendance` — the chart breaks
 * the line rather than plotting a point the table itself refuses to state.
 */
export function buildHealthMetricsEngagementGroupTrend(row: HealthMetricsEngagementGroupRow): (number | null)[] {
  return row.periods.map((period) => (period.meetingsHeld < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE ? null : period.attendancePct));
}

/**
 * Sub-nav badges per the design's `counts()`. A note is dropped at zero, and a section whose total
 * has not resolved renders no badge at all.
 */
export function buildHealthMetricsEngagementSubNavItems(counts: HealthMetricsEngagementSubNavCounts): HealthMetricsEngagementSubNavItem[] {
  const notes: Partial<Record<HealthMetricsEngagementSectionKey, string>> = {
    committees: counts.dormantGroups > 0 ? `${counts.dormantGroups} dormant` : '',
    orgs: counts.lapsedOrgs > 0 ? `${counts.lapsedOrgs} inactive ${HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS} days` : '',
    reps: counts.neverAttendedReps > 0 ? `${counts.neverAttendedReps} never attended` : '',
  };
  const totals: Record<HealthMetricsEngagementSectionKey, number | null> = {
    // The design gives these two no badge — neither is a countable list.
    participation: null,
    trend: null,
    committees: counts.groups,
    orgs: counts.orgs,
    reps: counts.reps,
    nonmem: counts.nonMemberOrgs,
  };

  return HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => ({
    key: section.key,
    label: section.label,
    count: totals[section.key],
    note: totals[section.key] === null ? '' : (notes[section.key] ?? ''),
  }));
}

/**
 * The participation row's numbers for one period. Same fallback as the group table: the view
 * carries four periods, so an unsupported range reads the most recent one rather than blanking.
 */
export function selectHealthMetricsEngagementParticipationPeriod(
  row: HealthMetricsEngagementParticipationRow,
  range: HealthMetricsRange
): HealthMetricsEngagementParticipationPeriod | null {
  return selectPeriod(row.periods, range);
}

/**
 * Which way a delta moved. Judged on the rounded value the label prints, not the raw one: a change
 * too small to show at one decimal must not be coloured as movement the reader cannot see.
 */
export function resolveHealthMetricsEngagementDeltaDirection(value: number | null): 'up' | 'down' | 'neutral' {
  if (value === null || roundDeltaForDisplay(value) === 0) {
    return 'neutral';
  }

  return value > 0 ? 'up' : 'down';
}

/** A point change on an attendance share: `+3.2pp`. Not a percent — the share itself is one. */
export function formatHealthMetricsEngagementPpDelta(pointChange: number | null): string {
  return formatDelta(pointChange, 'pp');
}

/** A fractional change in a count, rendered as a percent: `+12.0%`. */
export function formatHealthMetricsEngagementPctDelta(fractionChange: number | null): string {
  return formatDelta(fractionChange, '%');
}

/**
 * The org row's numbers for one period. Same four-period fallback as the group and participation
 * tables.
 */
export function selectHealthMetricsEngagementOrgPeriod(row: HealthMetricsEngagementOrgRow, range: HealthMetricsRange): HealthMetricsEngagementOrgPeriod | null {
  return selectPeriod(row.periods, range);
}

/** Mean reps at one decimal. `null` is "attended nothing this period", which is an em dash, not `0`. */
export function formatHealthMetricsEngagementAvgReps(avgReps: number | null): string {
  return avgReps === null ? '—' : avgReps.toFixed(1);
}

/**
 * The org table's client-side cut: the lapsed segment, then the search box, then the selected
 * period's own ranking. Ranking is per period, so the pill re-sorts rather than re-reads.
 */
export function filterHealthMetricsEngagementOrgRows(
  rows: readonly HealthMetricsEngagementOrgRow[],
  filter: HealthMetricsEngagementOrgFilter,
  search: string,
  range: HealthMetricsRange
): HealthMetricsEngagementOrgRow[] {
  const term = search.trim().toLowerCase();
  const matched = rows.filter((row) => {
    if (filter === 'lapsed' && !row.lapsed) return false;
    return term === '' || row.accountName.toLowerCase().includes(term);
  });

  // A row the view left unranked sorts last rather than ahead of every ranked org.
  return matched.sort((a, b) => {
    const rankA = selectPeriod(a.periods, range)?.sortRank ?? Number.MAX_SAFE_INTEGER;
    const rankB = selectPeriod(b.periods, range)?.sortRank ?? Number.MAX_SAFE_INTEGER;
    // Locale pinned: an unpinned compare can order same-rank rows differently on SSR and the client.
    return rankA === rankB ? a.accountName.localeCompare(b.accountName, 'en-US') : rankA - rankB;
  });
}

/** Both views carry the same four periods, so the same fallback serves either row shape. */
function selectPeriod<T extends { range: HealthMetricsRange }>(periods: readonly T[], range: HealthMetricsRange): T | null {
  return periods.find((period) => period.range === range) ?? periods[periods.length - 1] ?? null;
}

/** The one decimal both delta labels print; the direction resolver reads the same value. */
function roundDeltaForDisplay(fractionChange: number): number {
  return Number((fractionChange * 100).toFixed(1));
}

/** `pp` and `%` differ only in unit — the sign comes from the rounded value, never the raw one. */
function formatDelta(fractionChange: number | null, unit: 'pp' | '%'): string {
  if (fractionChange === null) {
    return '—';
  }

  const rounded = roundDeltaForDisplay(fractionChange);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}${unit}`;
}
