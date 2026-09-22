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
  HealthMetricsEngagementGroupPeriod,
  HealthMetricsEngagementGroupRow,
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
export function resolveHealthMetricsEngagementAttendanceTone(fraction: number | null): 'empty' | 'low' | 'ok' {
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
  return row.periods.find((period) => period.range === range) ?? row.periods[row.periods.length - 1] ?? null;
}

/**
 * Sparkline series, oldest → current. Periods with no invited population stay `null` so the chart
 * breaks the line instead of drawing a dip to zero.
 */
export function buildHealthMetricsEngagementGroupTrend(row: HealthMetricsEngagementGroupRow): (number | null)[] {
  return row.periods.map((period) => period.attendancePct);
}

/**
 * Sub-nav badges per the design's `counts()`. Each half of a note is dropped at zero, and a section
 * whose total has not resolved renders no badge at all.
 */
export function buildHealthMetricsEngagementSubNavItems(counts: HealthMetricsEngagementSubNavCounts): HealthMetricsEngagementSubNavItem[] {
  const notes: Partial<Record<HealthMetricsEngagementSectionKey, string>> = {
    committees: joinEngagementNoteParts([
      counts.dormantGroups > 0 ? `${counts.dormantGroups} dormant` : '',
      counts.lowAttendanceGroups > 0 ? `${counts.lowAttendanceGroups} below 50%` : '',
    ]),
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

function joinEngagementNoteParts(parts: string[]): string {
  return parts.filter(Boolean).join(' · ');
}
