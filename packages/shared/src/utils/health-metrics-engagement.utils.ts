// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_MIN_MONTHS,
  HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS,
  HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS,
  HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS,
  HEALTH_METRICS_ENGAGEMENT_ORG_TOP_TIERS,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
  HEALTH_METRICS_ENGAGEMENT_SPARK_BAR_MIN_PX,
  HEALTH_METRICS_ENGAGEMENT_SPARK_BAR_RANGE_PX,
  HEALTH_METRICS_ENGAGEMENT_UNRESOLVED_IDENTITY_LABEL,
} from '../constants/health-metrics-engagement.constants';
import { MONTH_NAMES } from '../constants/marketing-impact.constants';
import { formatIsoDateLabel } from './date-time.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type {
  HealthMetricsEngagementAttendanceMonth,
  HealthMetricsEngagementAttendanceTone,
  HealthMetricsEngagementAttendanceTrendPointView,
  HealthMetricsEngagementAttendanceTrendSummaryView,
  HealthMetricsEngagementGroupPeriod,
  HealthMetricsEngagementGroupRow,
  HealthMetricsEngagementNonMemberPeriod,
  HealthMetricsEngagementNonMemberPeriodCounts,
  HealthMetricsEngagementNonMemberRow,
  HealthMetricsEngagementOrgFilter,
  HealthMetricsEngagementOrgPeriod,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementRepFilter,
  HealthMetricsEngagementRepPeriod,
  HealthMetricsEngagementRepPeriodCounts,
  HealthMetricsEngagementRepRow,
  HealthMetricsEngagementRepRowLabels,
  HealthMetricsEngagementParticipationPeriod,
  HealthMetricsEngagementParticipationRow,
  HealthMetricsEngagementSectionKey,
  HealthMetricsEngagementSparkBar,
  HealthMetricsEngagementSubNavCounts,
  HealthMetricsEngagementSubNavItem,
} from '../interfaces/health-metrics-engagement.interface';

/**
 * Attendance display rule. `null` means no invited population at all (em dash, never `0%`), and a
 * period with too few meetings reads "No data" rather than a percentage built on one or two events.
 */
export function formatHealthMetricsEngagementAttendance(fraction: number | null, meetingsHeld: number | null): string {
  if (fraction === null) {
    return '—';
  }
  if (meetingsHeld === null || meetingsHeld < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE) {
    return 'No data';
  }

  return `${Math.round(fraction * 100)}%`;
}

/** A count cell: "—" when unmeasured, else the count with its locale pinned so SSR and hydration agree. */
export function formatHealthMetricsEngagementCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

/**
 * "12 / 27"-style ratio cell shared by the org, rep and participation tables. Either side unmeasured
 * makes the whole cell "—" — a partial "12 / —" would wrongly imply the other side is a real zero.
 */
export function formatHealthMetricsEngagementRatio(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null) {
    return '—';
  }

  return `${numerator} / ${denominator}`;
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
 * too few meetings to rate, matching `formatHealthMetricsEngagementAttendance` — the chart leaves
 * that slot empty rather than drawing a bar the table itself refuses to state.
 */
export function buildHealthMetricsEngagementGroupTrend(row: HealthMetricsEngagementGroupRow): (number | null)[] {
  return row.periods.map((period) =>
    period.meetingsHeld === null || period.meetingsHeld < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE ? null : period.attendancePct
  );
}

/**
 * The design's `spark2` bars, oldest → current, scaled to the rated values' own min-max so a tight run
 * still shows its movement. A `null` period keeps its slot with no bar; empty below two rated values.
 */
export function buildHealthMetricsEngagementSparkBars(series: readonly (number | null)[]): HealthMetricsEngagementSparkBar[] {
  const values = series.filter((value): value is number => value !== null);
  if (values.length < HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS) return [];

  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const heightOf = (value: number): number =>
    Number((HEALTH_METRICS_ENGAGEMENT_SPARK_BAR_MIN_PX + ((value - min) / span) * HEALTH_METRICS_ENGAGEMENT_SPARK_BAR_RANGE_PX).toFixed(1));
  return series.map((value, index) => ({
    heightPx: value === null ? null : heightOf(value),
    last: value !== null && index === series.length - 1,
  }));
}

/**
 * Sub-nav badges per the design's `counts()`. A note is dropped at zero, and a section whose total
 * has not resolved renders no badge at all.
 */
export function buildHealthMetricsEngagementSubNavItems(counts: HealthMetricsEngagementSubNavCounts): HealthMetricsEngagementSubNavItem[] {
  const lowPct = Math.round(HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD * 100);
  const groupNotes = [
    counts.dormantGroups > 0 ? `${counts.dormantGroups} dormant` : '',
    counts.lowAttendanceGroups > 0 ? `${counts.lowAttendanceGroups} below ${lowPct}%` : '',
  ];
  const notes: Partial<Record<HealthMetricsEngagementSectionKey, string>> = {
    committees: groupNotes.filter(Boolean).join(' · '),
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
  if (pointChange === null) {
    return '—';
  }

  // The sign comes from the rounded value, never the raw one.
  const rounded = roundDeltaForDisplay(pointChange);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}pp`;
}

/**
 * The trend's chart points, oldest first. A month reports a rate only on the hero's own rule — an
 * invited population and enough meetings — so the line gaps exactly where the hero reads "No data".
 */
export function buildHealthMetricsEngagementAttendanceTrendPoints(
  months: readonly HealthMetricsEngagementAttendanceMonth[],
  today: Date
): HealthMetricsEngagementAttendanceTrendPointView[] {
  return months.map((month) => {
    const isInProgress = isCurrentAttendanceMonth(month, today);
    const name = attendanceMonthName(month);

    return {
      monthStartDate: month.monthStartDate,
      label: `${name.slice(0, 3)} ${month.monthStartDate.slice(2, 4)}`,
      monthLabel: `${name} ${month.monthStartDate.slice(0, 4)}${isInProgress ? ' (to date)' : ''}`,
      rate: isRatedAttendanceMonth(month) ? (month.attendancePct as number) * 100 : null,
      rateLabel: formatHealthMetricsEngagementAttendance(month.attendancePct, month.meetingsHeld),
      meetingsLabel:
        month.meetingsHeld === null ? '—' : `${formatHealthMetricsEngagementCount(month.meetingsHeld)} ${month.meetingsHeld === 1 ? 'meeting' : 'meetings'}`,
      isInProgress,
    };
  });
}

/**
 * The trend's headline and side stats. They describe full months only: the month in progress is
 * plotted but still collecting meetings, so the headline is the latest full month with a rate.
 */
export function buildHealthMetricsEngagementAttendanceTrendSummary(
  months: readonly HealthMetricsEngagementAttendanceMonth[],
  today: Date
): HealthMetricsEngagementAttendanceTrendSummaryView {
  const ratedMonths = months.filter(isRatedAttendanceMonth).length;
  const full = months.map((month) => ({ month, rated: isRatedAttendanceMonth(month) && !isCurrentAttendanceMonth(month, today) }));
  let latestIndex = full.length - 1;
  while (latestIndex >= 0 && !full[latestIndex].rated) latestIndex--;
  const latest = latestIndex >= 0 ? full[latestIndex].month : null;
  // The view compares against the previous month even when that month's rate is one the hero hides.
  const delta = latest && full[latestIndex - 1]?.rated ? latest.attendanceChangePp : null;
  const rated = full.filter((entry) => entry.rated).map((entry) => entry.month);
  const byRate = [...rated].sort((a, b) => (a.attendancePct as number) - (b.attendancePct as number));
  const first = rated[0];
  const last = rated[rated.length - 1];

  let state: HealthMetricsEngagementAttendanceTrendSummaryView['state'] = 'trend';
  if (ratedMonths === 0) state = 'empty';
  else if (ratedMonths < HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS) state = 'insufficient';

  return {
    state,
    ratedMonths,
    latestLabel: latest ? formatHealthMetricsEngagementAttendance(latest.attendancePct, latest.meetingsHeld) : '—',
    latestCaption: latest ? `${attendanceMonthName(latest)} ${latest.monthStartDate.slice(0, 4)}` : 'No full month with attendance yet',
    deltaLabel: formatHealthMetricsEngagementPpDelta(delta),
    deltaDirection: resolveHealthMetricsEngagementDeltaDirection(delta),
    rangeChangeLabel: rated.length >= 2 ? formatHealthMetricsEngagementPpDelta((last.attendancePct as number) - (first.attendancePct as number)) : '—',
    rangeHighLabel: formatRatedMonth(byRate[byRate.length - 1]),
    rangeLowLabel: formatRatedMonth(byRate[0]),
    isLowConfidence: state === 'trend' && ratedMonths < HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_MIN_MONTHS,
    lowConfidenceNote: `Only ${ratedMonths} of the last ${months.length} months have attendance from ${HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE} or more meetings, so the trend is indicative, not reliable.`,
  };
}

/**
 * The org row's numbers for one period. Same four-period fallback as the group and participation
 * tables.
 */
export function selectHealthMetricsEngagementOrgPeriod(row: HealthMetricsEngagementOrgRow, range: HealthMetricsRange): HealthMetricsEngagementOrgPeriod | null {
  return selectPeriod(row.periods, range);
}

/** The org table's tier pill: blue for the top tiers (any case), grey for everything else. */
export function resolveHealthMetricsEngagementOrgTierPillClass(tier: string): string {
  return HEALTH_METRICS_ENGAGEMENT_ORG_TOP_TIERS.includes(tier.trim().toLowerCase())
    ? HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS.top
    : HEALTH_METRICS_ENGAGEMENT_ORG_TIER_PILL_CLASS.other;
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

  return matched.sort((a, b) => compareByPeriodRank(a, b, range, accountNameOf));
}

/** The selected period's numbers for one non-member row, falling back to the newest period held. */
export function selectHealthMetricsEngagementNonMemberPeriod(
  row: HealthMetricsEngagementNonMemberRow,
  range: HealthMetricsRange
): HealthMetricsEngagementNonMemberPeriod | null {
  return selectPeriod(row.periods, range);
}

/**
 * The organizations that attended a meeting in the selected period, best-first by the view's rank —
 * the population the period's caption counts, so the table and its caption cannot disagree.
 */
export function filterHealthMetricsEngagementNonMemberRows(
  rows: readonly HealthMetricsEngagementNonMemberRow[],
  range: HealthMetricsRange
): HealthMetricsEngagementNonMemberRow[] {
  // Null is unmeasured, like a real 0 attended — the population the caption counts is missing either way.
  return rows.filter((row) => !!selectPeriod(row.periods, range)?.meetingsAttended).sort((a, b) => compareByPeriodRank(a, b, range, accountNameOf));
}

/** The selected period's caption count, which the view counts per period. */
export function selectHealthMetricsEngagementNonMemberCounts(
  counts: readonly HealthMetricsEngagementNonMemberPeriodCounts[] | null,
  range: HealthMetricsRange
): HealthMetricsEngagementNonMemberPeriodCounts | null {
  return counts ? selectPeriod(counts, range) : null;
}

/** The selected period's numbers for one representative, falling back to the newest period held. */
export function selectHealthMetricsEngagementRepPeriod(row: HealthMetricsEngagementRepRow, range: HealthMetricsRange): HealthMetricsEngagementRepPeriod | null {
  return selectPeriod(row.periods, range);
}

/** The selected period's caption counts. This view counts its scope per period, unlike the org view. */
export function selectHealthMetricsEngagementRepCounts(
  counts: readonly HealthMetricsEngagementRepPeriodCounts[] | null,
  range: HealthMetricsRange
): HealthMetricsEngagementRepPeriodCounts | null {
  return counts ? selectPeriod(counts, range) : null;
}

/**
 * The representatives table's client-side cut. Every cut starts from the people invited in the
 * selected period — the population the view's own caption counts — so the table and its caption
 * cannot disagree. The view's rank is per period, so the pill re-sorts the cut as well.
 */
export function filterHealthMetricsEngagementRepRows(
  rows: readonly HealthMetricsEngagementRepRow[],
  filter: HealthMetricsEngagementRepFilter,
  search: string,
  range: HealthMetricsRange
): HealthMetricsEngagementRepRow[] {
  const term = search.trim().toLowerCase();

  const matched = rows.filter((row) => {
    const period = selectPeriod(row.periods, range);
    // Null is unmeasured, like a real 0 invited — the population the caption counts is missing either way.
    if (!period || !period.meetingsInvited) return false;
    if (filter === 'never' && !period.neverAttended) return false;
    if (filter === 'lapsed' && !period.lapsed) return false;

    // One term searches the displayed name and the organization, the two columns a reader scans.
    return term === '' || repDisplayName(row).toLowerCase().includes(term) || row.accountName.toLowerCase().includes(term);
  });

  // The key breaks name ties so one person on two groups keeps a stable order across pills.
  return matched.sort((a, b) => compareByPeriodRank(a, b, range, repDisplayName) || a.key.localeCompare(b.key, 'en-US'));
}

/** The labels a representatives row renders; every unknown piece drops out rather than printing "null". */
export function buildHealthMetricsEngagementRepLabels(row: HealthMetricsEngagementRepRow): HealthMetricsEngagementRepRowLabels {
  const org = [row.accountName, row.membershipTier].filter((part): part is string => !!part?.trim()).join(' · ');

  return {
    displayName: repDisplayName(row),
    orgLabel: org || '—',
    // Pre-rendered off a UTC-anchored parse: a `DatePipe` render reads a date-only value a day early west of UTC.
    lastAttendedLabel: row.lastAttendedDate ? formatIsoDateLabel(row.lastAttendedDate) : '—',
  };
}

/** One rank order for every engagement table: a divergent copy would sort them differently. */
function compareByPeriodRank<T extends { periods: readonly { range: HealthMetricsRange; sortRank: number | null }[] }>(
  a: T,
  b: T,
  range: HealthMetricsRange,
  name: (row: T) => string
): number {
  // A row the view left unranked sorts last rather than ahead of every ranked row.
  const rankA = selectPeriod(a.periods, range)?.sortRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = selectPeriod(b.periods, range)?.sortRank ?? Number.MAX_SAFE_INTEGER;
  // Locale pinned: an unpinned compare can order same-rank rows differently on SSR and the client.
  return rankA === rankB ? name(a).localeCompare(name(b), 'en-US') : rankA - rankB;
}

/** An unresolved identity's name is a source placeholder, and two of them would read as one person. */
function repDisplayName(row: HealthMetricsEngagementRepRow): string {
  return row.identityUnresolved || !row.personName.trim() ? HEALTH_METRICS_ENGAGEMENT_UNRESOLVED_IDENTITY_LABEL : row.personName;
}

function accountNameOf(row: { accountName: string }): string {
  return row.accountName;
}

/** Both views carry the same four periods, so the same fallback serves either row shape. */
function selectPeriod<T extends { range: HealthMetricsRange }>(periods: readonly T[], range: HealthMetricsRange): T | null {
  return periods.find((period) => period.range === range) ?? periods[periods.length - 1] ?? null;
}

/** The one decimal the delta label prints; the direction resolver reads the same value. */
function roundDeltaForDisplay(fractionChange: number): number {
  return Number((fractionChange * 100).toFixed(1));
}

/** A month the trend can report a rate for: an invited population and enough meetings to mean something. */
function isRatedAttendanceMonth(month: HealthMetricsEngagementAttendanceMonth): boolean {
  return month.attendancePct !== null && month.meetingsHeld !== null && month.meetingsHeld >= HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE;
}

/** The view's window ends with the current UTC month, which is still collecting meetings. */
function isCurrentAttendanceMonth(month: HealthMetricsEngagementAttendanceMonth, today: Date): boolean {
  return month.monthStartDate.slice(0, 7) === today.toISOString().slice(0, 7);
}

function attendanceMonthName(month: HealthMetricsEngagementAttendanceMonth): string {
  return MONTH_NAMES[Number(month.monthStartDate.slice(5, 7)) - 1] ?? month.monthStartDate.slice(0, 7);
}

/** A rated month's rate on the section's one display rule; "—" when the range holds none. */
function formatRatedMonth(month: HealthMetricsEngagementAttendanceMonth | undefined): string {
  return month ? formatHealthMetricsEngagementAttendance(month.attendancePct, month.meetingsHeld) : '—';
}
