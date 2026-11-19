// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_RULE,
  HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_MIN_MONTHS,
  HEALTH_METRICS_ENGAGEMENT_DORMANCY_DAYS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_LOW_ATTENDANCE_THRESHOLD,
  HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE,
  HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS,
  HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_LABEL,
  HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_BAR_FILLS,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_DESCRIPTION,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ICONS,
  HEALTH_METRICS_ENGAGEMENT_RECIPIENT_METRICS,
  HEALTH_METRICS_ENGAGEMENT_REP_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
  HEALTH_METRICS_ENGAGEMENT_UNRESOLVED_IDENTITY_LABEL,
} from '../constants/health-metrics-engagement.constants';
import { MONTH_NAMES } from '../constants/calendar.constants';
import { getYearForRange } from '../constants/dashboard-metrics.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
import { HEALTH_METRICS_LINE_CHART_COLORS } from '../constants/health-metrics-line-chart.constants';
import { HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS, HEALTH_METRICS_MEMBERS_RESERVED_TIERS } from '../constants/health-metrics-members.constants';
import { HEALTH_METRICS_TABLE_DASH, HEALTH_METRICS_VALUE_BAR_FILL } from '../constants/health-metrics-table.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { buildHealthMetricsLineChart, healthMetricsLineChartCountCeiling } from './health-metrics-line-chart.utils';
import { formatHealthMetricsNewsletterGrowthSince } from './health-metrics-overview.utils';
import { healthMetricsBarFillClass, healthMetricsTierSortRank } from './health-metrics-table.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type {
  HealthMetricsEngagementAttendanceMonth,
  HealthMetricsEngagementAttendanceRule,
  HealthMetricsEngagementAttendanceTone,
  HealthMetricsEngagementAttendanceTrendPointView,
  HealthMetricsEngagementAttendanceTrendView,
  HealthMetricsEngagementGroupKind,
  HealthMetricsEngagementGroupPeriod,
  HealthMetricsEngagementGroupRow,
  HealthMetricsEngagementGroupRowView,
  HealthMetricsEngagementGroupTypeFilter,
  HealthMetricsEngagementNewsletter,
  HealthMetricsEngagementNewsletterChartView,
  HealthMetricsEngagementNewsletterMode,
  HealthMetricsEngagementNewsletterPerformance,
  HealthMetricsEngagementNewsletterPointView,
  HealthMetricsEngagementNewsletterRowView,
  HealthMetricsEngagementNewsletterView,
  HealthMetricsEngagementNonMemberRow,
  HealthMetricsEngagementNonMemberRowView,
  HealthMetricsEngagementOrgFilter,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementOrgRowView,
  HealthMetricsEngagementRecipient,
  HealthMetricsEngagementRecipientFilter,
  HealthMetricsEngagementRecipientRowView,
  HealthMetricsEngagementRecipientTone,
  HealthMetricsEngagementRepFilter,
  HealthMetricsEngagementRepPeriodCounts,
  HealthMetricsEngagementRepRow,
  HealthMetricsEngagementRepRowView,
  HealthMetricsEngagementParticipationPeriod,
  HealthMetricsEngagementParticipationRow,
  HealthMetricsEngagementParticipationRowView,
  HealthMetricsEngagementSectionKey,
  HealthMetricsEngagementSubNavCounts,
  HealthMetricsEngagementSubNavItem,
} from '../interfaces/health-metrics-engagement.interface';
import type { HealthMetricsMembersReservedTier } from '../interfaces/health-metrics-members.interface';
import type { HealthMetricsL2Range, HealthMetricsMetricItem } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsLineChartSeries, HealthMetricsLineChartView } from '../interfaces/health-metrics-line-chart.interface';

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
 * Bar states, not the Overview's five classification codes: nobody showed up, below the group's rule
 * (amber, or red for the board), or fine. Blue is the design's interaction colour, reused for "fine".
 */
export function resolveHealthMetricsEngagementAttendanceTone(
  fraction: number | null,
  rule: HealthMetricsEngagementAttendanceRule = HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_RULE
): HealthMetricsEngagementAttendanceTone {
  if (fraction === null || fraction === 0) {
    return 'empty';
  }

  // Judged on the whole percent the label shows, so a bar reading "90%" is never red under a 90% rule.
  return Math.round(fraction * 100) < Math.round(rule.threshold * 100) ? rule.tone : 'ok';
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

/** A group-type cut from the URL; anything unknown reads as every type. */
export function parseHealthMetricsEngagementGroupType(value: string | null): HealthMetricsEngagementGroupTypeFilter {
  return HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS.find((filter) => filter.key === value)?.key ?? 'all';
}

/** What a group is, from the view's type label; a governance group is the board or one of its oversight committees. */
export function resolveHealthMetricsEngagementGroupKind(row: HealthMetricsEngagementGroupRow): HealthMetricsEngagementGroupKind {
  // Read off the filter cuts' own labels, so the kinds cannot drift from the view's values.
  const label = row.groupTypeLabel ?? '';
  const labels = HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS;
  const kinds = HEALTH_METRICS_ENGAGEMENT_GROUP_KINDS;
  if (labels.gov?.includes(label)) return row.meetingTypeGroup === 'Board' ? kinds.board : kinds.oversight;
  if (labels.wg?.includes(label)) return kinds.workingGroup;
  if (labels.sigtag?.includes(label)) return kinds.sigTag;
  return kinds.other;
}

/** One Group attendance row for the selected period. A group that held no meetings shows "—" rather than 0. */
export function buildHealthMetricsEngagementGroupRowView(row: HealthMetricsEngagementGroupRow, range: HealthMetricsRange): HealthMetricsEngagementGroupRowView {
  const period = selectPeriod(row.periods, range);
  const meetings = period?.meetingsHeld ?? null;
  const pct = ratedAttendancePct(period?.attendancePct ?? null, meetings);

  return {
    key: row.committeeId,
    name: row.committeeName,
    kind: resolveHealthMetricsEngagementGroupKind(row),
    meetings: meetings ? formatHealthMetricsEngagementCount(meetings) : HEALTH_METRICS_TABLE_DASH,
    lastMetLabel: row.lastMetDate ? formatIsoDateLabel(row.lastMetDate) : HEALTH_METRICS_TABLE_DASH,
    dormant: period?.dormant ?? false,
    attendanceLabel: pct === null ? HEALTH_METRICS_TABLE_DASH : `${pct}%`,
    attendancePct: pct,
  };
}

/** Sub-nav entries per the design's `counts()`; a note is dropped at zero. */
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

  return HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => ({ key: section.key, label: section.label, note: notes[section.key] ?? '' }));
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

/** One Meeting participation row for the selected period, named by its short meeting type as the design does. */
export function buildHealthMetricsEngagementParticipationRowView(
  row: HealthMetricsEngagementParticipationRow,
  range: HealthMetricsRange
): HealthMetricsEngagementParticipationRowView {
  const period = selectPeriod(row.periods, range);
  const group = row.group ?? '';
  const pct = ratedAttendancePct(period?.attendancePct ?? null, period?.meetingsHeld ?? null);
  // Own keys only: a type named like an Object.prototype member must not pick up a non-icon.
  const icons = HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ICONS;
  const fills = HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_BAR_FILLS;

  return {
    key: group || row.label,
    name: group || row.label,
    icon: Object.hasOwn(icons, group) ? icons[group] : icons['Other'],
    description: row.governance ? HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_DESCRIPTION : '',
    governance: row.governance,
    meetings: formatHealthMetricsEngagementCount(period?.meetingsHeld ?? null),
    attendanceLabel: pct === null ? HEALTH_METRICS_TABLE_DASH : `${pct}%`,
    attendancePct: pct,
    fillRule: Object.hasOwn(fills, group) ? fills[group] : HEALTH_METRICS_VALUE_BAR_FILL,
    sortValues: { type: group || row.label, meetings: period?.meetingsHeld ?? null, attendance: pct },
  };
}

/** The Meeting participation metrics row: attendance with its change, meetings held, active groups and never attended. */
export function buildHealthMetricsEngagementParticipationMetrics(
  total: HealthMetricsEngagementParticipationRow | null,
  range: HealthMetricsRange
): HealthMetricsMetricItem[] {
  const period = total ? selectPeriod(total.periods, range) : null;
  const change = period?.attendanceChangePp ?? null;
  const direction = resolveHealthMetricsEngagementDeltaDirection(change);
  const attendance: HealthMetricsMetricItem = {
    key: 'attendance',
    label: 'All-meeting attendance',
    value: period ? formatHealthMetricsEngagementAttendance(period.attendancePct, period.meetingsHeld) : HEALTH_METRICS_TABLE_DASH,
  };
  // No prior period, no comparison: the line is left out rather than claiming a change of "—".
  if (change !== null) {
    attendance.descriptionLead = formatHealthMetricsEngagementPpDelta(change);
    attendance.description = 'vs previous period';
    attendance.descriptionLeadTone = direction === 'neutral' ? 'flat' : direction;
  }

  return [
    attendance,
    { key: 'meetings', label: 'Meetings held', value: formatHealthMetricsEngagementCount(period?.meetingsHeld ?? null) },
    { key: 'groups', label: 'Active groups', value: formatHealthMetricsEngagementRatio(period?.activeGroups ?? null, total?.totalGroups ?? null) },
    { key: 'never', label: 'Never attended', value: formatHealthMetricsEngagementCount(period?.neverAttended ?? null) },
  ];
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
 * The Attendance trend for one year: January to the current month in year to date, the month in progress plotted
 * dashed, else January to December. The metrics row describes full months only; a thin month plots no rate.
 */
export function buildHealthMetricsEngagementAttendanceTrendView(
  months: readonly HealthMetricsEngagementAttendanceMonth[],
  range: HealthMetricsRange,
  year: number,
  today: Date
): HealthMetricsEngagementAttendanceTrendView {
  const inProgress = range === 'YTD' && today.getUTCFullYear() === year;
  const count = inProgress ? today.getUTCMonth() + 1 : 12;
  const byMonth = new Map(months.map((month) => [month.monthStartDate.slice(0, 7), month]));
  const found = Array.from({ length: count }, (_, index) => byMonth.get(`${year}-${String(index + 1).padStart(2, '0')}`) ?? null);
  const window = found.map((month, index) => month ?? blankAttendanceMonth(year, index));
  const lastFull = inProgress ? count - 2 : count - 1;
  const fullRated = window.flatMap((month, index) => (index <= lastFull && isRatedAttendanceMonth(month) ? [index] : []));
  const ratedMonths = window.filter(isRatedAttendanceMonth).length;
  const points = window.map((month, index) => buildAttendanceTrendPoint(month, year, inProgress && index === count - 1));

  let state: HealthMetricsEngagementAttendanceTrendView['state'] = 'trend';
  // A foundation with no rated month anywhere reads as empty on every pill, never as a year still to arrive.
  if (!months.some(isRatedAttendanceMonth)) state = 'empty';
  else if (inProgress && count === 1) state = 'january';
  else if (range !== 'YTD' && found.includes(null)) state = 'unavailable';
  else if (ratedMonths === 0) state = 'empty';
  else if (fullRated.length < HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS) state = 'insufficient';

  const trend = state === 'trend';
  return {
    state,
    year,
    notice: attendanceTrendNotice(state, year, fullRated.length),
    metrics: trend ? buildAttendanceTrendMetrics(window, fullRated, lastFull, year, inProgress) : [],
    points,
    chart: trend ? buildAttendanceTrendChart(points, lastFull, year, inProgress) : null,
    isLowConfidence: trend && ratedMonths < HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_TREND_MIN_MONTHS,
    lowConfidenceNote: `Only ${ratedMonths} months in ${year} have attendance from ${HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE} or more meetings, so the trend is indicative, not reliable.`,
  };
}

/** Company participation's activity cut from the URL; anything unknown reads as every company. */
export function parseHealthMetricsEngagementOrgFilter(value: string | null): HealthMetricsEngagementOrgFilter {
  return HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS.find((filter) => filter.key === value)?.key ?? 'all';
}

/** Representatives' cut from the URL; anything unknown reads as every representative. */
export function parseHealthMetricsEngagementRepFilter(value: string | null): HealthMetricsEngagementRepFilter {
  return HEALTH_METRICS_ENGAGEMENT_REP_FILTERS.find((filter) => filter.key === value)?.key ?? 'all';
}

/**
 * One Company participation row for the selected period. Meetings attended reads against the meetings that concerned
 * the company, the same base as its rate, and a company no meeting concerned reads "—" with no bar.
 */
export function buildHealthMetricsEngagementOrgRowView(row: HealthMetricsEngagementOrgRow, range: HealthMetricsRange): HealthMetricsEngagementOrgRowView {
  const period = selectPeriod(row.periods, range);
  const attended = period?.attendedCount ?? null;
  const total = period?.meetingsTotal ?? null;
  const fraction = period?.attendancePct ?? null;
  const share = attended !== null && total !== null && total > 0 && fraction !== null ? Math.round(fraction * 100) : null;
  const tierName = row.membershipTier.trim();
  const tier = row.isMember ? (HEALTH_METRICS_MEMBERS_RESERVED_TIERS.find((key) => key === tierName.toLowerCase()) ?? null) : null;

  return {
    key: row.accountId,
    name: row.accountName,
    logoUrl: row.logoUrl,
    membership: orgMembershipLabel(row.isMember, tier, tierName),
    isMember: row.isMember,
    tier,
    attendedLabel:
      share === null
        ? HEALTH_METRICS_TABLE_DASH
        : `${formatHealthMetricsEngagementCount(attended)} of ${formatHealthMetricsEngagementCount(total)} (${share}%)`,
    attendedPct: share,
    attendedFillClass: share === null ? '' : healthMetricsBarFillClass(share),
    avgRepsLabel: formatHealthMetricsEngagementAvgReps(period?.avgReps ?? null),
    lastEngagedLabel: row.lastEngagedDate ? formatIsoDateLabel(row.lastEngagedDate) : HEALTH_METRICS_TABLE_DASH,
    sortValues: {
      company: row.accountName,
      // A non-member ranks lowest; a member whose tier is blank ranks as an unnamed tier.
      membership: row.isMember ? (healthMetricsTierSortRank(tierName) ?? 1) : 0,
      attended: share,
      reps: period?.avgReps ?? null,
      last: row.lastEngagedDate,
    },
  };
}

/** One Non-member participation row for the selected period. */
export function buildHealthMetricsEngagementNonMemberRowView(
  row: HealthMetricsEngagementNonMemberRow,
  range: HealthMetricsRange
): HealthMetricsEngagementNonMemberRowView {
  const period = selectPeriod(row.periods, range);
  return {
    key: row.accountId,
    name: row.accountName,
    logoUrl: row.logoUrl,
    meetings: formatHealthMetricsEngagementCount(period?.meetingsAttended ?? null),
    people: formatHealthMetricsEngagementCount(period?.distinctPeople ?? null),
    sortValues: { company: row.accountName, meetings: period?.meetingsAttended ?? null, people: period?.distinctPeople ?? null },
  };
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

/**
 * The organizations that attended a meeting in the selected period, best-first by the view's rank —
 * the population the period's scope count covers, so the table and the count cannot disagree.
 */
export function filterHealthMetricsEngagementNonMemberRows(
  rows: readonly HealthMetricsEngagementNonMemberRow[],
  range: HealthMetricsRange
): HealthMetricsEngagementNonMemberRow[] {
  // Null is unmeasured, like a real 0 attended — the population the scope count covers is missing either way.
  return rows.filter((row) => !!selectPeriod(row.periods, range)?.meetingsAttended).sort((a, b) => compareByPeriodRank(a, b, range, accountNameOf));
}

/** The selected period's scope counts. This view counts its scope per period, unlike the org view. */
export function selectHealthMetricsEngagementRepCounts(
  counts: readonly HealthMetricsEngagementRepPeriodCounts[] | null,
  range: HealthMetricsRange
): HealthMetricsEngagementRepPeriodCounts | null {
  return counts ? selectPeriod(counts, range) : null;
}

/**
 * The representatives table's client-side cut. Every cut starts from the people invited in the
 * selected period — the population the view's own scope count covers — so the table and the count
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
    // Null is unmeasured, like a real 0 invited — the population the scope count covers is missing either way.
    if (!period || !period.meetingsInvited) return false;
    if (filter === 'never' && !period.neverAttended) return false;
    if (filter === 'lapsed' && !period.lapsed) return false;

    // One term searches the displayed name and the organization, the two columns a reader scans.
    return term === '' || repDisplayName(row).toLowerCase().includes(term) || row.accountName.toLowerCase().includes(term);
  });

  // The key breaks name ties so one person on two groups keeps a stable order across pills.
  return matched.sort((a, b) => compareByPeriodRank(a, b, range, repDisplayName) || a.key.localeCompare(b.key, 'en-US'));
}

/** A rep's all-time last-attended date, built once per read: the period must not pay an `Intl` formatter per loaded row. */
export function formatHealthMetricsEngagementRepLastAttended(row: HealthMetricsEngagementRepRow): string {
  // Pre-rendered off a UTC-anchored parse: a `DatePipe` render reads a date-only value a day early west of UTC.
  return row.lastAttendedDate ? formatIsoDateLabel(row.lastAttendedDate) : HEALTH_METRICS_TABLE_DASH;
}

/**
 * One Representatives row for the selected period. The company and job title sit under the name, an unresolved
 * identity keeps the company alone, and a rep who never attended has no last-attended date to show.
 */
export function buildHealthMetricsEngagementRepRowView(
  row: HealthMetricsEngagementRepRow,
  range: HealthMetricsRange,
  lastAttendedLabel: string = formatHealthMetricsEngagementRepLastAttended(row)
): HealthMetricsEngagementRepRowView {
  const period = selectPeriod(row.periods, range);
  const unresolved = isUnresolvedRep(row);
  const neverAttended = period?.neverAttended ?? false;
  const invited = period?.meetingsInvited ?? 0;
  const title = unresolved ? '' : (row.jobTitle?.trim() ?? '');

  return {
    key: row.key,
    displayName: repDisplayName(row),
    unresolved,
    description: [row.accountName.trim(), title].filter(Boolean).join('・'),
    committeeName: row.committeeName,
    attendedLabel: formatHealthMetricsEngagementRatio(period?.meetingsAttended ?? null, period?.meetingsInvited ?? null),
    neverAttended,
    lastAttendedLabel: neverAttended ? HEALTH_METRICS_TABLE_DASH : lastAttendedLabel,
    sortValues: {
      representative: repDisplayName(row),
      group: row.committeeName,
      // The share of meetings attended, so a never-attended seat (0) is the lowest.
      attended: invited > 0 ? (period?.meetingsAttended ?? 0) / invited : null,
      last: neverAttended ? null : row.lastAttendedDate,
    },
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
  return isUnresolvedRep(row) ? HEALTH_METRICS_ENGAGEMENT_UNRESOLVED_IDENTITY_LABEL : row.personName;
}

function isUnresolvedRep(row: HealthMetricsEngagementRepRow): boolean {
  return row.identityUnresolved || !row.personName.trim();
}

/** The Membership cell: the tier, "Non-member", or "—" for a member whose tier the view left blank. */
function orgMembershipLabel(isMember: boolean, tier: HealthMetricsMembersReservedTier | null, tierName: string): string {
  if (!isMember) return HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_LABEL;
  if (tier) return HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS[tier];
  return tierName || HEALTH_METRICS_TABLE_DASH;
}

function accountNameOf(row: { accountName: string }): string {
  return row.accountName;
}

/**
 * Newsletter performance for the period: the summary's KPIs, and each newsletter sent in the period's year. The table
 * keeps the view's latest-first rank; the chart runs oldest first, plotting rates only for newsletters with engagement data.
 */
export function buildHealthMetricsEngagementNewsletterView(
  performance: HealthMetricsEngagementNewsletterPerformance,
  range: HealthMetricsRange
): HealthMetricsEngagementNewsletterView {
  const l2 = (HEALTH_METRICS_L2_RANGES as readonly HealthMetricsRange[]).includes(range) ? (range as HealthMetricsL2Range) : null;
  const period = l2 ? performance.periods[l2] : null;
  const year = getYearForRange(range);
  const newsletters = l2 ? performance.newsletters.filter((newsletter) => newsletter.sentDate?.startsWith(`${year}-`)) : [];
  const chronological = [...newsletters].sort((a, b) => (a.sentDate ?? '').localeCompare(b.sentDate ?? '') || a.key.localeCompare(b.key));
  const growth = period?.subscribersGrowth ?? null;
  const growthPct = growth === null ? 0 : Math.round(growth * 100);
  const subscribers: HealthMetricsMetricItem = {
    key: 'subscribers',
    label: 'Subscribers',
    value: formatHealthMetricsEngagementCount(period?.subscribers ?? null),
  };
  // No line when growth rounds to 0%; the baseline month names when the growth counts from.
  if (growthPct !== 0) {
    subscribers.descriptionLead = `${growthPct > 0 ? '+' : '−'}${Math.abs(growthPct)}%`;
    subscribers.descriptionLeadTone = growthPct > 0 ? 'up' : 'down';
    subscribers.description = formatHealthMetricsNewsletterGrowthSince(period?.growthBaselineDate ?? null, year).trim();
  }
  const delivered = formatNewsletterRate(period?.avgDeliveryRate ?? null);
  const clickToOpen = formatNewsletterRate(period?.avgClickToOpenRate ?? null);

  return {
    isEmpty: !performance.measured || !period?.newslettersSent,
    metrics: [
      subscribers,
      {
        key: 'sent',
        label: 'Newsletters sent',
        value: formatHealthMetricsEngagementCount(period?.newslettersSent ?? null),
        ...(delivered === HEALTH_METRICS_TABLE_DASH ? {} : { description: `${delivered} delivered` }),
      },
      { key: 'open', label: 'Avg. open rate', value: formatNewsletterRate(period?.avgOpenRate ?? null) },
      {
        key: 'click',
        label: 'Avg. click rate',
        value: formatNewsletterRate(period?.avgClickRate ?? null, 1),
        ...(clickToOpen === HEALTH_METRICS_TABLE_DASH ? {} : { description: `${clickToOpen} of opens` }),
      },
    ],
    rows: newsletters.map(buildNewsletterRow),
    audiencePoints: chronological.map(buildNewsletterPoint),
    ratePoints: chronological.filter((newsletter) => newsletter.hasEngagementData).map(buildNewsletterPoint),
  };
}

/**
 * The newsletter chart, one point per newsletter in send order. Rates run to the highest plotted rate rounded up to the
 * next 10%, between 10% and 100%, with click-to-open dashed; the audience runs to a round ceiling over its peak.
 */
export function buildHealthMetricsEngagementNewsletterChart(
  points: readonly HealthMetricsEngagementNewsletterPointView[],
  mode: HealthMetricsEngagementNewsletterMode
): HealthMetricsEngagementNewsletterChartView {
  const colors = HEALTH_METRICS_LINE_CHART_COLORS;
  const audience = mode === 'audience';
  const series: HealthMetricsLineChartSeries[] = audience
    ? [
        { key: 'recipients', label: 'Recipients', color: colors.accent, values: points.map((point) => point.recipients), fill: true },
        { key: 'opens', label: 'Unique opens', color: colors.feature, values: points.map((point) => point.uniqueOpens) },
      ]
    : [
        { key: 'open', label: 'Open rate', color: colors.accent, values: points.map((point) => point.openPct), fill: true },
        { key: 'click', label: 'Click rate', color: colors.feature, values: points.map((point) => point.clickPct) },
        { key: 'cto', label: 'Click-to-open rate', color: colors.success, values: points.map((point) => point.clickToOpenPct), dashed: true },
      ];
  const format = (value: number | null): string =>
    audience ? formatHealthMetricsEngagementCount(value === null ? null : Math.round(value)) : formatNewsletterPct(value);
  const max = audience
    ? healthMetricsLineChartCountCeiling(Math.max(0, ...points.flatMap((point) => [point.recipients ?? 0, point.uniqueOpens ?? 0])))
    : // Peak over every plotted rate, so no line sits above the axis; rounded first so float noise never adds a band.
      Math.min(
        100,
        Math.max(
          10,
          Math.ceil(
            Math.round(Math.max(0, ...points.flatMap((point) => [point.openPct ?? 0, point.clickPct ?? 0, point.clickToOpenPct ?? 0])) * 1000) / 10_000
          ) * 10
        )
      );

  return {
    chart: buildHealthMetricsLineChart({
      xLabels: points.map((point) => point.tick),
      series,
      max,
      formatTick: format,
      tips: points.map((point, index) => ({
        title: point.title,
        rows: series.map((line) => ({ label: line.label, value: format(line.values[index] ?? null), color: line.color, separated: false, inline: true })),
      })),
      ariaLabel: audience ? 'Recipients and unique opens by newsletter' : 'Open, click and click-to-open rate by newsletter',
    }),
    legend: series.map((line) => ({ key: line.key, label: line.label, color: line.color })),
  };
}

/** The recipients a cut keeps, narrowed by a name or organization search; the view's engagement order is kept. */
export function filterHealthMetricsEngagementRecipients(
  recipients: readonly HealthMetricsEngagementRecipient[],
  filter: HealthMetricsEngagementRecipientFilter,
  search: string
): HealthMetricsEngagementRecipient[] {
  const term = search.trim().toLowerCase();
  return recipients.filter(
    (recipient) =>
      matchesRecipientFilter(recipient, filter) && (!term || `${recipient.name ?? ''} ${recipient.organization ?? ''}`.toLowerCase().includes(term))
  );
}

/** How many recipients each cut holds, for the filter labels. */
export function countHealthMetricsEngagementRecipients(
  recipients: readonly HealthMetricsEngagementRecipient[]
): Record<HealthMetricsEngagementRecipientFilter, number> {
  const counts: Record<HealthMetricsEngagementRecipientFilter, number> = { all: 0, opened: 0, clicked: 0, 'not-opened': 0, failed: 0 };
  for (const recipient of recipients) {
    for (const filter of Object.keys(counts) as HealthMetricsEngagementRecipientFilter[]) {
      if (matchesRecipientFilter(recipient, filter)) counts[filter] += 1;
    }
  }
  return counts;
}

/** The recipient status counts as a metrics row: opened, clicked, not opened and failed, over the loaded recipients. */
export function buildHealthMetricsEngagementRecipientMetrics(recipients: readonly HealthMetricsEngagementRecipient[]): HealthMetricsMetricItem[] {
  const counts = countHealthMetricsEngagementRecipients(recipients);
  return HEALTH_METRICS_ENGAGEMENT_RECIPIENT_METRICS.map((metric) => ({
    key: metric.key,
    label: metric.label,
    value: formatHealthMetricsEngagementCount(counts[metric.key]),
    dotClass: metric.dotClass,
    tip: metric.tip,
  }));
}

/**
 * One recipient's cells. A failed delivery reads "—" for every engagement cell, even where the view still carries a
 * stray open time; a pending one is not yet delivered and has no open, so it reads as not opened.
 */
export function buildHealthMetricsEngagementRecipientRow(recipient: HealthMetricsEngagementRecipient, now: Date): HealthMetricsEngagementRecipientRowView {
  const failed = isFailedRecipient(recipient);
  const pending = isPendingRecipient(recipient);
  const opened = !pending && recipient.segment === 'opened';
  const age = (prefix: string, iso: string | null): string => {
    const short = failed || pending ? '' : formatHealthMetricsShortAge(iso, now);
    return short ? `${prefix} ${short}` : '';
  };

  return {
    rank: recipient.rank,
    nameLabel: recipient.name?.trim() || HEALTH_METRICS_TABLE_DASH,
    avatarName: recipient.name?.trim() ?? '',
    description: recipient.organization?.trim() ?? '',
    deliveryLabel: recipientDeliveryLabel(failed, pending),
    deliveryTone: recipientDeliveryTone(failed, pending),
    engagementLabel: recipientEngagementLabel(failed, opened),
    engagementTone: opened ? 'accent' : 'neutral',
    opensLabel: failed ? HEALTH_METRICS_TABLE_DASH : formatHealthMetricsEngagementCount(recipient.opens),
    opensDescription: age('Last opened', recipient.lastOpenedAt),
    clicksLabel: failed ? HEALTH_METRICS_TABLE_DASH : formatHealthMetricsEngagementCount(recipient.clicks),
    clicksDescription: age('Last clicked', recipient.lastClickedAt),
    // Each column sorts on what it shows; a failed delivery's "—" cells sort last.
    sortValues: {
      recipient: recipient.name?.trim() || null,
      delivery: recipientDeliveryLabel(failed, pending),
      engagement: recipientEngagementLabel(failed, opened),
      opens: failed ? null : recipient.opens,
      clicks: failed ? null : recipient.clicks,
    },
  };
}

/** How long ago an ISO time was, in the design's short units: "5m", "3h", "2d", "3w" or "4mo"; empty without a time. */
export function formatHealthMetricsShortAge(iso: string | null, now: Date): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return '';

  const minutes = Math.max(1, Math.floor((now.getTime() - time) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/** Both views carry the same four periods, so the same fallback serves either row shape. */
function selectPeriod<T extends { range: HealthMetricsRange }>(periods: readonly T[], range: HealthMetricsRange): T | null {
  return periods.find((period) => period.range === range) ?? periods[periods.length - 1] ?? null;
}

/** The whole percent a bar shows, or `null` with no invited population or too few meetings to rate. */
function ratedAttendancePct(fraction: number | null, meetingsHeld: number | null): number | null {
  if (fraction === null || meetingsHeld === null || meetingsHeld < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE) return null;
  return Math.round(fraction * 100);
}

/** The one decimal the delta label prints; the direction resolver reads the same value. */
function roundDeltaForDisplay(fractionChange: number): number {
  return Number((fractionChange * 100).toFixed(1));
}

/** A month the trend can report a rate for: an invited population and enough meetings to mean something. */
function isRatedAttendanceMonth(month: HealthMetricsEngagementAttendanceMonth): boolean {
  return month.attendancePct !== null && month.meetingsHeld !== null && month.meetingsHeld >= HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE;
}

/** A month the view has no row for, read as one without meetings. */
function blankAttendanceMonth(year: number, index: number): HealthMetricsEngagementAttendanceMonth {
  return {
    monthStartDate: `${year}-${String(index + 1).padStart(2, '0')}-01`,
    meetingsHeld: null,
    invited: null,
    attended: null,
    attendancePct: null,
    attendanceChangePp: null,
  };
}

function attendanceMonthName(month: HealthMetricsEngagementAttendanceMonth): string {
  return MONTH_NAMES[Number(month.monthStartDate.slice(5, 7)) - 1] ?? month.monthStartDate.slice(0, 7);
}

/** A rated month's rate as a whole percent, the number every label shows. */
function attendanceWholePct(month: HealthMetricsEngagementAttendanceMonth): number {
  return Math.round((month.attendancePct as number) * 100);
}

/** A change between two whole percents, as the design writes it: `+3pp`, `−12pp`, `0pp`. */
function formatAttendanceTrendPp(points: number): string {
  if (points > 0) return `+${points}pp`;
  return points < 0 ? `−${Math.abs(points)}pp` : '0pp';
}

function buildAttendanceTrendPoint(
  month: HealthMetricsEngagementAttendanceMonth,
  year: number,
  isInProgress: boolean
): HealthMetricsEngagementAttendanceTrendPointView {
  const name = attendanceMonthName(month);
  return {
    monthStartDate: month.monthStartDate,
    label: name.slice(0, 3),
    monthLabel: `${name} ${year}${isInProgress ? ' (to date)' : ''}`,
    rate: isRatedAttendanceMonth(month) ? (month.attendancePct as number) * 100 : null,
    rateLabel: formatHealthMetricsEngagementAttendance(month.attendancePct, month.meetingsHeld),
    meetingsLabel: formatAttendanceTrendMeetings(month.meetingsHeld),
    isInProgress,
  };
}

function formatAttendanceTrendMeetings(meetingsHeld: number | null): string {
  if (meetingsHeld === null) return '—';
  return `${formatHealthMetricsEngagementCount(meetingsHeld)} ${meetingsHeld === 1 ? 'meeting' : 'meetings'}`;
}

function attendanceTrendNotice(state: HealthMetricsEngagementAttendanceTrendView['state'], year: number, fullRated: number): string {
  const rule = `${HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE} or more meetings`;
  switch (state) {
    case 'january':
      return 'The trend starts once January closes.';
    case 'unavailable':
      return `Attendance history for ${year} is not available yet.`;
    case 'insufficient':
      return fullRated === 1 ? `Only one month in ${year} has attendance from ${rule}.` : `No full month in ${year} has attendance from ${rule} yet.`;
    default:
      return '';
  }
}

/**
 * Last full month (the previous month, or December), the change across the year's rated full months, and the highest
 * and lowest of them by exact rate; a tie goes to the earlier month.
 */
function buildAttendanceTrendMetrics(
  window: readonly HealthMetricsEngagementAttendanceMonth[],
  fullRated: readonly number[],
  lastFull: number,
  year: number,
  inProgress: boolean
): HealthMetricsMetricItem[] {
  const head = window[lastFull];
  const headName = attendanceMonthName(head);
  const headRated = isRatedAttendanceMonth(head);
  const latest: HealthMetricsMetricItem = {
    key: 'latest',
    label: inProgress ? `Previous month (${headName.slice(0, 3)} ${year})` : `${headName} ${year}`,
    value: headRated ? `${attendanceWholePct(head)}%` : 'No data',
  };
  const previous = window[lastFull - 1];
  if (headRated && previous && isRatedAttendanceMonth(previous)) {
    const change = attendanceWholePct(head) - attendanceWholePct(previous);
    latest.descriptionLead = formatAttendanceTrendPp(change);
    latest.description = `vs ${attendanceMonthName(previous)}`;
    if (change > 0) latest.descriptionLeadTone = 'up';
    else latest.descriptionLeadTone = change < 0 ? 'down' : 'flat';
  }

  const start = window[fullRated[0]];
  const end = window[fullRated[fullRated.length - 1]];
  const startName = attendanceMonthName(start);
  const endName = attendanceMonthName(end);
  const rated = fullRated.map((index) => window[index]);
  // Picked on the exact rate, so the plotted peak is named; strict comparisons give a true tie to the earlier month.
  const high = rated.reduce((best, month) => ((month.attendancePct as number) > (best.attendancePct as number) ? month : best));
  const low = rated.reduce((best, month) => ((month.attendancePct as number) < (best.attendancePct as number) ? month : best));

  return [
    latest,
    {
      key: 'change',
      label: `Change since ${startName}`,
      value: formatAttendanceTrendPp(attendanceWholePct(end) - attendanceWholePct(start)),
      description: `${attendanceWholePct(start)}% in ${startName.slice(0, 3)} → ${attendanceWholePct(end)}% in ${endName.slice(0, 3)}`,
      tip: `Difference in attendance rate between ${startName} and ${end === head ? 'the last full month' : endName} of the selected year, in percentage points.`,
    },
    { key: 'high', label: 'Highest rate', value: `${attendanceWholePct(high)}%`, description: `${attendanceMonthName(high)} ${year}` },
    { key: 'low', label: 'Lowest rate', value: `${attendanceWholePct(low)}%`, description: `${attendanceMonthName(low)} ${year}` },
  ];
}

/** One filled line over the full months; in year to date a dashed run into the month in progress ends on a hollow dot. */
function buildAttendanceTrendChart(
  points: readonly HealthMetricsEngagementAttendanceTrendPointView[],
  lastFull: number,
  year: number,
  inProgress: boolean
): HealthMetricsLineChartView {
  const color = HEALTH_METRICS_LINE_CHART_COLORS.accent;
  const rates = points.map((point) => point.rate);
  const series: HealthMetricsLineChartSeries[] = [
    { key: 'attendance', label: 'Attendance', color, values: rates.map((rate, index) => (index <= lastFull ? rate : null)), fill: true },
  ];
  // A month in progress below the rate rule has no point to dash into.
  if (inProgress && rates[rates.length - 1] !== null) {
    series.push({
      key: 'in-progress',
      label: 'Attendance (month in progress)',
      color,
      values: rates.map((rate, index) => (index >= lastFull ? rate : null)),
      dashed: true,
      dotLast: true,
    });
  }

  return buildHealthMetricsLineChart({
    xLabels: points.map((point) => point.label),
    series,
    max: 100,
    formatTick: (value) => `${Math.round(value)}%`,
    tips: points.map((point) => ({
      title: point.monthLabel,
      rows: [{ label: 'Attendance', value: `${point.rateLabel} · ${point.meetingsLabel}`, color, separated: false, inline: true }],
    })),
    ariaLabel: `All-meeting attendance by month, ${year}`,
  });
}

/** A 0–100 percentage, whole; "—" when there is none. */
function formatNewsletterPct(value: number | null): string {
  return value === null ? HEALTH_METRICS_TABLE_DASH : `${Math.round(value)}%`;
}

/** A 0–1 rate as a percentage, whole unless `digits` asks for more. */
function formatNewsletterRate(value: number | null, digits = 0): string {
  return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function buildNewsletterRow(newsletter: HealthMetricsEngagementNewsletter): HealthMetricsEngagementNewsletterRowView {
  // Without engagement data the view carries recipients only, so every other cell reads "—" with no sub-line.
  const engaged = newsletter.hasEngagementData;
  const total = (value: number | null): string => (engaged && value !== null ? `${formatHealthMetricsEngagementCount(value)} total` : '');

  return {
    key: newsletter.key,
    name: newsletter.name,
    sentLabel: newsletter.sentDate ? `Sent ${formatIsoDateLabel(newsletter.sentDate)}` : '',
    recipientsLabel: formatHealthMetricsEngagementCount(newsletter.recipients),
    failedLabel: engaged && newsletter.failed !== null ? `${formatHealthMetricsEngagementCount(newsletter.failed)} failed` : '',
    uniqueOpensLabel: formatHealthMetricsEngagementCount(engaged ? newsletter.uniqueOpens : null),
    totalOpensLabel: total(newsletter.totalOpens),
    openRateLabel: formatNewsletterRate(engaged ? newsletter.openRate : null),
    openRatePct: engaged && newsletter.openRate !== null ? Math.min(100, Math.max(0, newsletter.openRate * 100)) : null,
    uniqueClicksLabel: formatHealthMetricsEngagementCount(engaged ? newsletter.uniqueClicks : null),
    totalClicksLabel: total(newsletter.totalClicks),
    clickRateLabel: formatNewsletterRate(engaged ? newsletter.clickRate : null),
    clickToOpenLabel: formatNewsletterRate(engaged ? newsletter.clickToOpenRate : null),
    // Without engagement data every engagement column is empty, so those rows sort last.
    sortValues: {
      newsletter: newsletter.sentDate,
      recipients: newsletter.recipients,
      opens: engaged ? newsletter.uniqueOpens : null,
      openRate: engaged ? newsletter.openRate : null,
      clicks: engaged ? newsletter.uniqueClicks : null,
      clickRate: engaged ? newsletter.clickRate : null,
      clickToOpen: engaged ? newsletter.clickToOpenRate : null,
    },
  };
}

function buildNewsletterPoint(newsletter: HealthMetricsEngagementNewsletter): HealthMetricsEngagementNewsletterPointView {
  const month = Number(newsletter.sentDate?.slice(5, 7));
  const pct = (value: number | null): number | null => (newsletter.hasEngagementData && value !== null ? value * 100 : null);

  return {
    key: newsletter.key,
    tick: month >= 1 && month <= 12 ? MONTH_NAMES[month - 1].slice(0, 3) : '',
    title: [newsletter.name, newsletter.sentDate ? formatIsoDateLabel(newsletter.sentDate) : ''].filter(Boolean).join(' · '),
    openPct: pct(newsletter.openRate),
    clickPct: pct(newsletter.clickRate),
    clickToOpenPct: pct(newsletter.clickToOpenRate),
    recipients: newsletter.recipients,
    uniqueOpens: newsletter.hasEngagementData ? newsletter.uniqueOpens : null,
  };
}

function matchesRecipientFilter(recipient: HealthMetricsEngagementRecipient, filter: HealthMetricsEngagementRecipientFilter): boolean {
  if (filter === 'all') return true;
  // The row and the cuts share one failure rule, so a row reading "Failed" is never counted under an engagement cut.
  if (filter === 'failed') return isFailedRecipient(recipient);
  if (isFailedRecipient(recipient)) return false;
  // A pending delivery has not landed yet, so it counts as not opened whatever the view segments it as.
  if (isPendingRecipient(recipient)) return filter === 'not-opened';
  return filter === 'clicked' ? recipient.clicked : recipient.segment === filter;
}

/** Failed by either the view's segment or its delivery status. */
function isFailedRecipient(recipient: HealthMetricsEngagementRecipient): boolean {
  return recipient.segment === 'failed' || recipient.deliveryStatus === 'Failed';
}

/** Sent but not yet delivered; never also failed. */
function isPendingRecipient(recipient: HealthMetricsEngagementRecipient): boolean {
  return !isFailedRecipient(recipient) && recipient.deliveryStatus?.trim().toLowerCase() === 'pending';
}

/** No tag for a failed delivery, which the row shows as "—". */
function recipientEngagementLabel(failed: boolean, opened: boolean): string {
  if (failed) return '';
  return opened ? 'Opened' : 'Not opened';
}

function recipientDeliveryLabel(failed: boolean, pending: boolean): string {
  if (failed) return 'Failed';
  return pending ? 'Pending' : 'Delivered';
}

function recipientDeliveryTone(failed: boolean, pending: boolean): HealthMetricsEngagementRecipientTone {
  if (failed) return 'danger';
  return pending ? 'neutral' : 'success';
}
