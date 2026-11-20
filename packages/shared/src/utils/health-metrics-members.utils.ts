// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MONTH_NAMES } from '../constants/calendar.constants';
import { getYearForRange } from '../constants/dashboard-metrics.constants';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS } from '../constants/health-metrics-engagement.constants';
import {
  HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_LABELS,
  HEALTH_METRICS_MEMBERS_BOARD_BELOW_LEVEL_CAPTIONS,
  HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS,
  HEALTH_METRICS_MEMBERS_BOARD_COHORT_RULES,
  HEALTH_METRICS_MEMBERS_BOARD_LATEST_TEXT_CLASS,
  HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_FIRST_YEAR,
  HEALTH_METRICS_MEMBERS_CHURN_HIGH_RATE_PCT,
  HEALTH_METRICS_MEMBERS_CHURN_TREND_YEARS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_BADGE_CLASSES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NO_NPS_ICON_CLASS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_ICON_CLASSES,
  HEALTH_METRICS_MEMBERS_GROWTH_FIRST_YEAR,
  HEALTH_METRICS_MEMBERS_GROWTH_LINE_COLORS,
  HEALTH_METRICS_MEMBERS_GROWTH_PLOT,
  HEALTH_METRICS_MEMBERS_NPS_RATE_DROP_PP,
  HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT,
  HEALTH_METRICS_MEMBERS_NPS_SEGMENTS,
  HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS,
  HEALTH_METRICS_MEMBERS_RESERVED_TIERS,
  HEALTH_METRICS_MEMBERS_SECTIONS,
} from '../constants/health-metrics-members.constants';
import { formatIsoDateLabel, formatIsoDateShortLabel } from './date-time.utils';
import { resolveHealthMetricsEngagementAttendanceTone } from './health-metrics-engagement.utils';
import { formatHealthMetricsPercent, formatHealthMetricsSmallPercent, healthMetricsShownPercent } from './health-metrics-table.utils';
import { formatCurrency } from './number.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type { HealthMetricsChartTipRowView, HealthMetricsL2Section } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsMembersAtRiskAging,
  HealthMetricsMembersAtRiskAgingView,
  HealthMetricsMembersAtRiskMember,
  HealthMetricsMembersAtRiskRowView,
  HealthMetricsMembersAtRiskSummary,
  HealthMetricsMembersAtRiskSummaryView,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersBoardCohortSummary,
  HealthMetricsMembersBoardMeeting,
  HealthMetricsMembersBoardMeetingRowView,
  HealthMetricsMembersBoardSummaryView,
  HealthMetricsMembersBoardTrendBarView,
  HealthMetricsMembersBreakdownColumnView,
  HealthMetricsMembersBreakdownRowView,
  HealthMetricsMembersBreakdownView,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnDeparture,
  HealthMetricsMembersChurnDepartureRowView,
  HealthMetricsMembersChurnInversionView,
  HealthMetricsMembersChurnMode,
  HealthMetricsMembersChurnSideView,
  HealthMetricsMembersChurnTier,
  HealthMetricsMembersChurnTierRowView,
  HealthMetricsMembersChurnTrendPointView,
  HealthMetricsMembersChurnView,
  HealthMetricsMembersChurnYear,
  HealthMetricsMembersDirectoryEngagementView,
  HealthMetricsMembersDirectoryMember,
  HealthMetricsMembersDirectoryRowView,
  HealthMetricsMembersGrowth,
  HealthMetricsMembersGrowthColumnView,
  HealthMetricsMembersGrowthLineView,
  HealthMetricsMembersGrowthView,
  HealthMetricsMembersSectionKey,
  HealthMetricsMembersNpsAudience,
  HealthMetricsMembersNpsAudienceOption,
  HealthMetricsMembersNpsQuarter,
  HealthMetricsMembersNpsSegmentView,
  HealthMetricsMembersNpsSummaryView,
  HealthMetricsMembersNpsTrendNote,
  HealthMetricsMembersNpsTrendPointView,
  HealthMetricsMembersRenewal,
  HealthMetricsMembersRenewalRowView,
  HealthMetricsMembersRenewalsSummary,
  HealthMetricsMembersRenewalsSummaryView,
  HealthMetricsMembersReservedTier,
  HealthMetricsMembersSubNavItem,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTierYear,
} from '../interfaces/health-metrics-members.interface';

/** Sub-nav items for the Members tab; a section notes only once it reports a note. */
export function buildHealthMetricsMembersSubNavItems(notes: Partial<Record<HealthMetricsMembersSectionKey, string>> = {}): HealthMetricsMembersSubNavItem[] {
  return HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => ({ key: section.key, label: section.label, note: notes[section.key] ?? '' }));
}

/** The Members sections, with the running year in any copy that names it. */
export function buildHealthMetricsMembersSections(year: number): HealthMetricsL2Section[] {
  return HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => ({ ...section, description: section.description.replace('{year}', String(year)) }));
}

/**
 * `#breakdown` — members per tier at each year's end, from the first year shown to the running one, as PCC tables it:
 * every tier with a member in a year shown, in rank order, then the totals. Nothing here follows the period.
 */
export function buildHealthMetricsMembersBreakdownView(tiers: HealthMetricsMembersTiers): HealthMetricsMembersBreakdownView {
  const currentYear = getYearForRange('YTD');
  const rows = tiers.rows.filter((row) => row.year >= HEALTH_METRICS_MEMBERS_BREAKDOWN_FIRST_YEAR && row.year <= currentYear);
  if (rows.length === 0) return { measured: false, columns: [], rows: [] };

  const firstYear = Math.min(...rows.map((row) => row.year));
  const years = Array.from({ length: currentYear - firstYear + 1 }, (_, index) => firstYear + index);
  // Totals count every row, so a measured zero stays zero after the empty tiers drop out of the table.
  const totals = years.map((year) => sumNullable(rows.filter((row) => row.year === year).map((row) => row.memberCount)));
  const revenue = years.map((year) => sumNullable(rows.filter((row) => row.year === year).map((row) => row.revenueUsd)));

  const tierRows = collectBreakdownTiers(rows).map(
    (tier, index): HealthMetricsMembersBreakdownRowView => ({
      key: `tier-${tier.label}`,
      label: tier.label,
      kind: 'tier',
      icon: tier.reserved,
      striped: index % 2 === 1,
      cells: years.map((year) => formatCount(tier.members.get(year) ?? null)),
    })
  );

  return {
    measured: true,
    columns: years.map((year): HealthMetricsMembersBreakdownColumnView => ({ year, label: year === currentYear ? `${year} YTD` : String(year) })),
    rows: [
      ...tierRows,
      { key: 'members', label: 'Total members', kind: 'total', icon: null, striped: false, cells: totals.map((total) => formatCount(total)) },
      { key: 'revenue', label: 'Total revenue', kind: 'total', icon: null, striped: false, cells: revenue.map((value) => formatUsd(value)) },
    ],
  };
}

/**
 * `#growth` — cumulative new members by month, one line per year as PCC draws it: the period's year solid, every
 * other year dashed, newest in accent. This year stops at `today`'s month, which may still be in progress.
 */
export function buildHealthMetricsMembersGrowthView(
  growth: HealthMetricsMembersGrowth,
  range: HealthMetricsRange,
  today: Date = new Date()
): HealthMetricsMembersGrowthView {
  const currentYear = today.getFullYear();
  const now = today.getMonth();
  const selectedYear = currentYear - (getYearForRange('YTD') - getYearForRange(range));
  const colors = HEALTH_METRICS_MEMBERS_GROWTH_LINE_COLORS;
  const firstYear = Math.max(HEALTH_METRICS_MEMBERS_GROWTH_FIRST_YEAR, currentYear - colors.length + 1);

  const raw = new Map<number, (number | null)[]>();
  for (const row of growth.months) {
    if (row.year < firstYear || row.year > currentYear || row.month < 1 || row.month > 12) continue;
    const months = raw.get(row.year) ?? Array<number | null>(12).fill(null);
    months[row.month - 1] = row.cumulative;
    raw.set(row.year, months);
  }
  // A year with no measured total is missing, never a year of zeros.
  const years = [...raw.keys()]
    .sort((a, b) => a - b)
    .flatMap((year): [number, number[]][] => {
      const months = raw.get(year)?.slice(0, year === currentYear ? now + 1 : 12) ?? [];
      return months.some((value) => value !== null) ? [[year, fillCumulative(months)]] : [];
    });
  if (years.length === 0) return emptyGrowthView();

  const top = chartScaleStep(Math.max(1, ...years.flatMap(([, values]) => values))) * 4;
  const plot = HEALTH_METRICS_MEMBERS_GROWTH_PLOT;
  const spacing = (plot.width - 2 * plot.insetX) / 11;
  const x = (month: number): number => plot.insetX + month * spacing;
  const y = (value: number): number => plot.height - (Math.min(value, top) / top) * plot.height;

  const lines = years.map(
    ([year, values]): HealthMetricsMembersGrowthLineView => ({
      year,
      color: colors[currentYear - year],
      dashed: year !== selectedYear,
      d: growthCurve(values.map((value, month): [number, number] => [x(month), y(value)])),
      points: values.map((value, month) => ({
        month: month + 1,
        leftPct: (x(month) / plot.width) * 100,
        topPct: (y(value) / plot.height) * 100,
        label: formatCount(value),
      })),
    })
  );

  const columns = MONTH_NAMES.map((label, month): HealthMetricsMembersGrowthColumnView => {
    const rows: HealthMetricsChartTipRowView[] = [...lines]
      .reverse()
      .filter((line) => month < line.points.length)
      .map((line) => ({ label: String(line.year), value: line.points[month].label, color: line.color, separated: false }));
    return {
      month: month + 1,
      label,
      leftPct: (x(month) / plot.width) * 100,
      widthPct: (spacing / plot.width) * 100,
      tip: { title: label, rows },
      ariaLabel: `${label}. ${rows.map((row) => `${row.label}: ${row.value}`).join(', ')}`,
    };
  });

  const first = lines[0].year;
  const last = lines[lines.length - 1].year;
  return {
    measured: true,
    yMax: formatCount(top),
    lines,
    columns,
    ariaLabel: `Cumulative new members by month, one line per year, ${first === last ? first : `${first} to ${last}`}`,
  };
}

function emptyGrowthView(): HealthMetricsMembersGrowthView {
  return { measured: false, yMax: '', lines: [], columns: [], ariaLabel: '' };
}

/**
 * A smooth path through the points, as the design curves it, with monotone (Fritsch–Carlson) handles: each segment
 * stays between its two totals, so a flat month before a jump never dips or overshoots.
 */
function growthCurve(points: [number, number][]): string {
  if (points.length === 0) return '';
  const slopes = points.slice(1).map(([x, y], index) => (y - points[index][1]) / (x - points[index][0]));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === points.length - 1) return slopes[index - 1];
    return slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
  });
  slopes.forEach((slope, index) => {
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      return;
    }
    const a = tangents[index] / slope;
    const b = tangents[index + 1] / slope;
    const length = a * a + b * b;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  });

  let d = `M${round1(points[0][0])} ${round1(points[0][1])}`;
  for (let index = 0; index < points.length - 1; index++) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const third = (x2 - x1) / 3;
    d += ` C${round1(x1 + third)} ${round1(y1 + tangents[index] * third)} ${round1(x2 - third)} ${round1(y2 - tangents[index + 1] * third)} ${round1(x2)} ${round1(y2)}`;
  }
  return d;
}

/** All members rows: the company with its NPS line, the tier, the renewal, the period's sponsorship and the engagement badge. */
export function buildHealthMetricsMembersDirectoryRows(rows: HealthMetricsMembersDirectoryMember[]): HealthMetricsMembersDirectoryRowView[] {
  return rows.map((row) => {
    const tier = row.membershipTier?.trim() ? resolveHealthMetricsMembersTier(row.membershipTier) : null;
    // Renewal dues show only when they differ from the annual dues.
    const renewalDiffers = row.renewalDuesUsd !== null && row.renewalDuesUsd !== row.annualDuesUsd;
    return {
      accountId: row.accountId,
      name: row.accountName,
      logoUrl: row.logoUrl,
      isAtRisk: row.isAtRisk,
      npsLabel: directoryNpsLabel(row),
      npsIconClass: row.npsCategory ? HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_ICON_CLASSES[row.npsCategory] : HEALTH_METRICS_MEMBERS_DIRECTORY_NO_NPS_ICON_CLASS,
      membershipLabel: tier?.label ?? '—',
      tier: tier?.reserved ?? null,
      renewalLabel: formatIsoDate(row.renewalDate),
      renewalDuesLabel: renewalDiffers ? `${formatUsd(row.renewalDuesUsd)} dues` : '',
      // $0 and not tracked both read "—".
      sponsorshipLabel: row.sponsorshipUsd ? formatUsd(Math.round(row.sponsorshipUsd)) : '—',
      engagement: directoryEngagement(row),
    };
  });
}

/** A tier as Members shows it: without a trailing "Membership" or "Member", with Diamond, Platinum, Gold and Silver marked for their icon. */
export function resolveHealthMetricsMembersTier(raw: string): { label: string; reserved: HealthMetricsMembersReservedTier | null } {
  const trimmed = raw.trim();
  const suffix = [' membership', ' member'].find((candidate) => trimmed.toLowerCase().endsWith(candidate));
  const label = (suffix ? trimmed.slice(0, -suffix.length).trim() : trimmed) || trimmed;
  const reserved = HEALTH_METRICS_MEMBERS_RESERVED_TIERS.find((key) => key === label.toLowerCase()) ?? null;
  return { label: reserved ? HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS[reserved] : label, reserved };
}

/** The at-risk hero: the outstanding balance, its High / Medium split, and the member count; an unset total is a dash. */
export function buildHealthMetricsMembersAtRiskSummary(summary: HealthMetricsMembersAtRiskSummary): HealthMetricsMembersAtRiskSummaryView {
  return {
    outstandingLabel: formatUsd(summary.outstandingBalanceUsd),
    highRiskLabel: formatUsd(summary.highRiskBalanceUsd),
    mediumRiskLabel: formatUsd(summary.mediumRiskBalanceUsd),
    memberCountLabel: formatCount(summary.memberCount),
  };
}

/** Aging bars, each sized against the largest bucket balance; a bucket with no members is left out, an unset one kept. */
export function buildHealthMetricsMembersAtRiskAging(aging: HealthMetricsMembersAtRiskAging[]): HealthMetricsMembersAtRiskAgingView[] {
  const shown = aging.filter((bucket) => bucket.memberCount === null || bucket.memberCount > 0);
  const max = Math.max(0, ...shown.map((bucket) => bucket.balanceUsd ?? 0));
  return shown.map((bucket) => ({
    bucket: bucket.bucket,
    label: `${HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_LABELS[bucket.bucket]} · ${bucket.memberCount === null ? '—' : pluralize(bucket.memberCount, 'member')}`,
    balanceLabel: formatUsd(bucket.balanceUsd),
    widthPct: max > 0 && bucket.balanceUsd !== null ? Math.min(100, Math.max(0, (bucket.balanceUsd / max) * 100)) : 0,
  }));
}

/** At-risk rows; a missing tier, balance, age or engagement date renders as a dash. */
export function buildHealthMetricsMembersAtRiskRows(rows: HealthMetricsMembersAtRiskMember[]): HealthMetricsMembersAtRiskRowView[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    tierLabel: row.membershipTier ?? '—',
    overdueLabel: formatUsd(row.outstandingBalanceUsd),
    ageLabel: row.daysOverdue === null ? '—' : pluralize(Math.round(row.daysOverdue), 'day'),
    lastEngagedLabel: formatIsoDate(row.lastEngagedDate),
  }));
}

/** The sub-nav note, "12 overdue · $480K"; empty while no member is at risk or either total is unset. */
export function buildHealthMetricsMembersAtRiskNote(summary: HealthMetricsMembersAtRiskSummary): string {
  if (summary.memberCount === null || summary.memberCount <= 0 || summary.outstandingBalanceUsd === null) return '';
  return `${summary.memberCount.toLocaleString('en-US')} overdue · ${formatCurrency(summary.outstandingBalanceUsd)}`;
}

/** The "N members" line beside the bucket pills. */
export function buildHealthMetricsMembersAtRiskCountLabel(totalRecords: number): string {
  return pluralize(totalRecords, 'member');
}

/** The renewals hero: the known dues up for renewal, the count, and how many renewals have no dues on record. */
export function buildHealthMetricsMembersRenewalsSummary(summary: HealthMetricsMembersRenewalsSummary): HealthMetricsMembersRenewalsSummaryView {
  const withoutDues = summary.withoutDuesCount ?? 0;
  return {
    valueLabel: formatUsd(summary.valueUsd),
    renewalCountLabel: formatCount(summary.renewalCount),
    coverageNote: withoutDues > 0 ? `${pluralize(withoutDues, 'renewal')} without dues on record, so the value counts only the known dues.` : '',
  };
}

/** Renewal rows; a missing tier, date or dues renders as a dash, never $0. */
export function buildHealthMetricsMembersRenewalRows(rows: HealthMetricsMembersRenewal[]): HealthMetricsMembersRenewalRowView[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    tierLabel: row.membershipTier ?? '—',
    renewalDateLabel: formatIsoDate(row.renewalDate),
    duesLabel: formatUsd(row.duesUsd),
    hasOutstandingBalance: row.hasOutstandingBalance,
    hasRenewed: row.hasRenewed,
  }));
}

/** The "N renewals" line over the table. */
export function buildHealthMetricsMembersRenewalsCountLabel(totalRecords: number): string {
  return pluralize(totalRecords, 'renewal');
}

/** The board hero for the selected cohort, with the other cohort's latest share beside it. */
export function buildHealthMetricsMembersBoardSummary(
  cohort: HealthMetricsMembersBoardCohort,
  selected: HealthMetricsMembersBoardCohortSummary | null,
  other: HealthMetricsMembersBoardCohortSummary | null
): HealthMetricsMembersBoardSummaryView {
  const isBelowExpectedLevel = isHealthMetricsMembersBoardBelowLevel(cohort, selected);
  const latestTone = isBelowExpectedLevel ? HEALTH_METRICS_MEMBERS_BOARD_COHORT_RULES[cohort].tone : 'ok';
  const neverAttendedCount = Math.max(0, selected?.neverAttendedCount ?? 0);
  const noun = HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS[cohort];
  const attended = selected?.latestAttendedCount ?? null;
  const invited = selected?.latestInvitedCount ?? null;
  const meetings = selected?.meetingsInRangeCount ?? null;
  return {
    meetingsLabel: meetings === null ? '—' : `${pluralize(meetings, 'meeting')} in range`,
    latestPctLabel: formatPct(selected?.latestAttendancePct ?? null),
    latestCaption: `Last ${noun}${isBelowExpectedLevel ? ` · ${HEALTH_METRICS_MEMBERS_BOARD_BELOW_LEVEL_CAPTIONS[cohort]}` : ''}`,
    isBelowExpectedLevel,
    latestTone,
    latestTextClass: HEALTH_METRICS_MEMBERS_BOARD_LATEST_TEXT_CLASS[latestTone],
    otherCohortLabel: HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS.find((option) => option.id !== cohort)?.label ?? '',
    otherCohortPctLabel: formatPct(other?.latestAttendancePct ?? null),
    attendedInvitedLabel: attended === null || invited === null ? '—' : `${formatCount(attended)} / ${formatCount(invited)}`,
    neverAttendedLabel: formatCount(selected?.neverAttendedCount ?? null),
    neverAttendedCount,
  };
}

/**
 * Whether the latest meeting is below the cohort's rule, on the whole percent shown. The view's flag
 * draws the board's 90% line for both cohorts, so it stands in only for a board share that is missing.
 */
export function isHealthMetricsMembersBoardBelowLevel(
  cohort: HealthMetricsMembersBoardCohort,
  summary: HealthMetricsMembersBoardCohortSummary | null
): boolean {
  const pct = toWholePct(summary?.latestAttendancePct ?? null);
  if (pct === null) return cohort === 'board' && summary?.isBelowExpectedLevel === true;
  return pct < Math.round(HEALTH_METRICS_MEMBERS_BOARD_COHORT_RULES[cohort].threshold * 100);
}

/** Meeting rows; the rate bar takes the Engagement attendance tones under the cohort's rule. */
export function buildHealthMetricsMembersBoardMeetingRows(
  rows: HealthMetricsMembersBoardMeeting[],
  cohort: HealthMetricsMembersBoardCohort
): HealthMetricsMembersBoardMeetingRowView[] {
  const rule = HEALTH_METRICS_MEMBERS_BOARD_COHORT_RULES[cohort];
  return rows.map((row) => {
    const ratePct = toWholePct(row.attendancePct);
    return {
      meetingId: row.meetingId,
      committeeName: row.committeeName ?? '—',
      dateLabel: formatIsoDate(row.meetingDate),
      attendedLabel: row.attendedCount === null || row.invitedCount === null ? '—' : `${formatCount(row.attendedCount)} / ${formatCount(row.invitedCount)}`,
      ratePct,
      rateLabel: formatPct(row.attendancePct),
      rateFillClass: HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS[resolveHealthMetricsEngagementAttendanceTone(row.attendancePct, rule)],
    };
  });
}

/** Trend bars, labelled by short date; the rate is clamped like the table's. */
export function buildHealthMetricsMembersBoardTrend(trend: HealthMetricsMembersBoardMeeting[]): HealthMetricsMembersBoardTrendBarView[] {
  return trend.map((meeting) => {
    const pct = toShownPct(meeting.attendancePct);
    return {
      meetingId: meeting.meetingId,
      label: formatIsoDateShortLabel(meeting.meetingDate) ?? '—',
      dateLabel: formatIsoDate(meeting.meetingDate),
      committeeName: meeting.committeeName ?? '—',
      pct,
      pctLabel: formatPct(meeting.attendancePct),
      isLatest: meeting.isLatestMeeting,
    };
  });
}

/** The sub-nav note, from the board cohort: unused seats first, else the latest share when below its level. */
export function buildHealthMetricsMembersBoardNote(board: HealthMetricsMembersBoardCohortSummary | null): string {
  if (!board) return '';
  const never = board.neverAttendedCount ?? 0;
  if (never > 0) return `${pluralize(never, 'seat')} unused`;
  if (isHealthMetricsMembersBoardBelowLevel('board', board) && board.latestAttendancePct !== null) return `${formatPct(board.latestAttendancePct)} attended`;
  return '';
}

/** The audience toggle, in the read's order. */
export function buildHealthMetricsMembersNpsAudienceOptions(audiences: HealthMetricsMembersNpsAudience[]): HealthMetricsMembersNpsAudienceOption[] {
  return audiences.map((audience) => ({ id: audience.audience, label: audience.audience }));
}

/** The NPS hero, banner and footer for one audience; a sample below the rate floor keeps its score, marked as low confidence. */
export function buildHealthMetricsMembersNpsSummary(audience: HealthMetricsMembersNpsAudience | null): HealthMetricsMembersNpsSummaryView {
  const isUnscored = !audience || audience.npsScore === null;
  const recipients = audience?.recipientsCount ?? null;
  const responses = audience?.responsesCount ?? null;
  const ratePct = toWholePct(audience?.responseRatePct ?? null);
  const isRateBelowFloor = ratePct !== null && ratePct < HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT;
  // The view's flag sits at 40%, so it stands in only when the rate itself is missing.
  const isSampleTooSmall = ratePct === null ? audience?.isSampleTooSmall === true : isRateBelowFloor;
  const change = isUnscored ? null : (audience?.scoreChangePp ?? null);
  const respondedLabel = responses === null || recipients === null ? '—' : `${formatCount(responses)} of ${formatCount(recipients)}`;
  const rateLabel = formatPct(audience?.responseRatePct ?? null);

  return {
    isUnscored,
    isLowConfidence: !isUnscored && isSampleTooSmall,
    scoreLabel: isUnscored ? '—' : formatSignedScore(audience?.npsScore ?? null),
    changeLabel: change === null ? null : `${formatSignedScore(change)}pp`,
    changeDirection: directionOf(change),
    caption: isUnscored ? 'Not enough responses to report a score' : `Net Promoter Score · ${audience?.audience.toLowerCase()} audience`,
    respondedLabel,
    rateLabel,
    isRateBelowFloor,
    lowSampleNote:
      isSampleTooSmall && !isUnscored
        ? `Only ${respondedLabel} responded (${rateLabel}). Below the confidence threshold, so read this score with caution.`
        : null,
    lastUpdatedLabel: audience?.lastUpdatedQuarter ? `Last updated ${audience.lastUpdatedQuarter}` : '',
    surveyedLabel: `out of ${formatCount(recipients)} surveyed`,
    footer: isRateBelowFloor
      ? {
          isBelowFloor: true,
          lead: `${formatCount(audience?.noResponseCount ?? null)} of ${formatCount(recipients)} did not respond.`,
          text: `A score computed on ${pluralize(Math.max(0, responses ?? 0), 'reply', 'replies')} is not a foundation-wide signal.`,
        }
      : {
          isBelowFloor: false,
          lead: null,
          text: 'Non-responses are rendered as the grey segment so the sample size is visible without reading a caption.',
        },
  };
}

/** Promoters, passives, detractors and non-responses as shares of everyone surveyed. */
export function buildHealthMetricsMembersNpsSegments(audience: HealthMetricsMembersNpsAudience | null): HealthMetricsMembersNpsSegmentView[] {
  const counts: Record<(typeof HEALTH_METRICS_MEMBERS_NPS_SEGMENTS)[number]['key'], number | null> = {
    promoters: audience?.promotersCount ?? null,
    passives: audience?.passivesCount ?? null,
    detractors: audience?.detractorsCount ?? null,
    noResponse: audience?.noResponseCount ?? null,
  };
  const recipients = audience?.recipientsCount ?? 0;
  return HEALTH_METRICS_MEMBERS_NPS_SEGMENTS.map((segment) => {
    const count = counts[segment.key];
    return {
      key: segment.key,
      label: segment.label,
      countLabel: formatCount(count),
      widthPct: recipients > 0 && count !== null ? Math.min(100, Math.max(0, (count / recipients) * 100)) : 0,
      colorClass: segment.colorClass,
    };
  });
}

/** Trend points, oldest first; a below-floor wave, or a flagged one with no rate, keeps its score as low confidence. */
export function buildHealthMetricsMembersNpsTrend(trend: HealthMetricsMembersNpsQuarter[]): HealthMetricsMembersNpsTrendPointView[] {
  return trend.map((quarter) => {
    const score = quarter.npsScore;
    const ratePct = toShownPct(quarter.responseRatePct);
    const isRateBelowFloor = ratePct !== null && ratePct < HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT;
    const isLowConfidence = score !== null && (ratePct === null ? quarter.isSampleTooSmall === true : isRateBelowFloor);
    const scoreLabel = score === null ? '—' : formatSignedScore(score);
    return {
      quarterStartDate: quarter.quarterStartDate,
      label: quarter.quarterLabel ?? '—',
      score,
      scoreLabel,
      scoreDescription: isLowConfidence ? `${scoreLabel} (low response)` : scoreLabel,
      ratePct,
      rateLabel: formatPct(quarter.responseRatePct),
      isRateBelowFloor,
      isLowConfidence,
    };
  });
}

/**
 * The sentence under the trend: a rising score on a falling rate that fell materially or ended below the floor
 * is flagged; else a below-floor rate, or a rate that moved under the drop threshold. `null` when neither applies.
 */
export function buildHealthMetricsMembersNpsTrendNote(points: HealthMetricsMembersNpsTrendPointView[]): HealthMetricsMembersNpsTrendNote | null {
  const rated = points.filter((point) => point.ratePct !== null);
  const latest = rated.at(-1);
  if (points.length < 2 || !latest) return null;

  const scored = rated.filter((point) => point.score !== null);
  const first = scored[0];
  const last = scored.at(-1);
  if (first && last && first !== last) {
    const scoreUp = (last.score ?? 0) - (first.score ?? 0);
    const rateDrop = (first.ratePct ?? 0) - (last.ratePct ?? 0);
    if (scoreUp > 0 && rateDrop > 0 && (rateDrop >= HEALTH_METRICS_MEMBERS_NPS_RATE_DROP_PP || last.isRateBelowFloor)) {
      return { kind: 'diverging', scoreChangeLabel: pluralize(scoreUp, 'point'), fromRateLabel: first.rateLabel, toRateLabel: last.rateLabel };
    }
  }

  if (latest.isRateBelowFloor) return { kind: 'below-floor', scoreChangeLabel: '', fromRateLabel: '', toRateLabel: latest.rateLabel };
  const rateMove = Math.abs((rated[0].ratePct ?? 0) - (latest.ratePct ?? 0));
  if (rated.length < 2 || rateMove >= HEALTH_METRICS_MEMBERS_NPS_RATE_DROP_PP) return null;
  return { kind: 'holding', scoreChangeLabel: '', fromRateLabel: '', toRateLabel: latest.rateLabel };
}

/**
 * The selected period's churn in one mode. A change against the year before needs that year in the read;
 * without it the hero shows no change rather than one the data cannot back.
 */
export function buildHealthMetricsMembersChurnView(
  churn: HealthMetricsMembersChurn,
  range: HealthMetricsRange,
  mode: HealthMetricsMembersChurnMode
): HealthMetricsMembersChurnView {
  const year = getYearForRange(range);
  const current = churn.years.find((row) => row.year === year) ?? null;
  const prior = churn.years.find((row) => row.year === year - 1) ?? null;
  const lostCount = Math.max(0, Math.round(current?.lostCount ?? 0));
  const rateOf = (row: HealthMetricsMembersChurnYear | null): number | null => (mode === 'revenue' ? row?.revenueNotRenewedRate : row?.logoChurnRate) ?? null;
  const rate = rateOf(current);
  const priorRate = rateOf(prior);
  const change = churnDifference(rate, priorRate);
  const isCurrentYear = year === getYearForRange('YTD');
  const changeTone = churnChangeTone(change);

  return {
    measured: churn.years.length > 0,
    // A null count is unmeasured, so it must not read as "no churn".
    yearMeasured: current !== null && current.lostCount !== null,
    year,
    hasChurn: lostCount > 0,
    lostCount,
    metaLabel:
      current?.openingCount === null || current?.openingCount === undefined
        ? `${pluralize(lostCount, 'membership')} lost`
        : `${formatCount(lostCount)} of ${pluralize(Math.round(current.openingCount), 'membership')} lost`,
    heroLabel: formatChurnRate(rate),
    changeLabel: change === null ? null : `${formatChurnChange(change)} vs ${year - 1}`,
    changeTone,
    caption: buildChurnCaption(mode, year, isCurrentYear),
    sides: buildChurnSides(current, mode, year, isCurrentYear),
    tiers: buildChurnTierRows(churn.tiers.filter((row) => row.year === year)),
    inversion: buildChurnInversion(churn.tiers.filter((row) => row.year === year)),
    trendTitle: mode === 'revenue' ? 'Revenue churn trend' : 'Logo churn trend',
    trendSubtitle: mode === 'revenue' ? 'share of dues not renewed, by year' : 'share of memberships lost, by year',
    trend: buildChurnTrend(churn.years, year, rateOf),
    // Follows the hero's change, so the bar and the hero never disagree on direction.
    trendRose: changeTone === 'bad',
  };
}

/** "Who left" rows: dues lost, the lapse and the last engagement, a dash where the model has none. */
export function buildHealthMetricsMembersChurnDepartureRows(rows: HealthMetricsMembersChurnDeparture[]): HealthMetricsMembersChurnDepartureRowView[] {
  return rows.map((row) => ({
    key: row.key,
    accountId: row.accountId,
    accountName: row.accountName,
    tierLabel: row.membershipTier ?? '—',
    duesLabel: formatUsd(row.duesLostUsd),
    lapsedLabel: formatIsoDate(row.lapsedDate),
    lastEngagedLabel: formatIsoDate(row.lastEngagedDate),
  }));
}

/** "Who left"'s subtitle; it claims the churn count only when the list carries exactly that many. */
export function buildHealthMetricsMembersChurnDeparturesSubtitle(totalRecords: number, lostCount: number): string {
  return totalRecords === lostCount ? `largest dues lost first · the same ${formatCount(lostCount)} as lost above` : 'largest dues lost first';
}

/** Shown when "Who left" and the churn count disagree, so the gap reads as a counting difference. */
export function buildHealthMetricsMembersChurnCountNote(totalRecords: number, lostCount: number): string | null {
  if (totalRecords === lostCount) return null;

  return `${pluralize(totalRecords, 'membership')} listed, while churn counts ${formatCount(lostCount)} lost. The list and the churn count are counted separately, so they can differ slightly.`;
}

function churnDifference(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

function buildChurnCaption(mode: HealthMetricsMembersChurnMode, year: number, isCurrentYear: boolean): string {
  if (mode === 'logo')
    return isCurrentYear ? 'of the memberships held at the start of the year lapsed' : `of the memberships held at the start of ${year} lapsed`;
  return isCurrentYear ? "of last year's dues did not renew" : `of ${year - 1}'s dues did not renew`;
}

/** Dues lost this year and last, then the other mode's rate, so the toggle never hides a figure. */
function buildChurnSides(
  current: HealthMetricsMembersChurnYear | null,
  mode: HealthMetricsMembersChurnMode,
  year: number,
  isCurrentYear: boolean
): HealthMetricsMembersChurnSideView[] {
  const lost = current?.lostCount ?? null;
  const opening = current?.openingCount ?? null;
  const other: HealthMetricsMembersChurnSideView =
    mode === 'revenue'
      ? {
          key: 'logo',
          label: 'Logo churn',
          value: formatChurnRate(current?.logoChurnRate ?? null),
          note: lost === null || opening === null ? null : `(${formatCount(lost)} of ${formatCount(opening)})`,
          isLoss: false,
        }
      : { key: 'revenue', label: 'Revenue churn', value: formatChurnRate(current?.revenueNotRenewedRate ?? null), note: null, isLoss: false };

  return [
    {
      key: 'dues-lost',
      label: isCurrentYear ? 'Dues lost this year' : `Dues lost in ${year}`,
      value: formatUsd(current?.duesLostUsd ?? null),
      note: null,
      isLoss: true,
    },
    {
      key: 'dues-lost-prior',
      label: isCurrentYear ? 'Dues lost last year' : `Dues lost in ${year - 1}`,
      value: formatUsd(current?.duesLostPriorUsd ?? null),
      note: null,
      isLoss: false,
    },
    other,
  ];
}

/** Most dues lost first, then the model's tier order; a tiny share keeps a visible stub, a zero share none. */
function buildChurnTierRows(tiers: HealthMetricsMembersChurnTier[]): HealthMetricsMembersChurnTierRowView[] {
  return [...tiers]
    .sort((a, b) => (b.duesLostUsd ?? -1) - (a.duesLostUsd ?? -1) || a.tierSortRank - b.tierSortRank || a.tier.localeCompare(b.tier, 'en-US'))
    .map((row) => {
      const raw = row.shareOfLossPct === null ? null : Math.min(100, Math.max(0, row.shareOfLossPct));
      return {
        tier: row.tier,
        lostLabel: formatCount(row.lostCount),
        rateLabel: formatChurnRate(row.churnRate),
        isHighRate: row.churnRate !== null && row.churnRate >= HEALTH_METRICS_MEMBERS_CHURN_HIGH_RATE_PCT,
        duesLabel: formatUsd(row.duesLostUsd),
        shareLabel: formatChurnShare(raw),
        shareWidthPct: raw === null || raw === 0 ? 0 : Math.max(raw, 1),
      };
    });
}

/** Set only when one tier clearly lost the most memberships and another clearly lost the most dues. */
function buildChurnInversion(tiers: HealthMetricsMembersChurnTier[]): HealthMetricsMembersChurnInversionView | null {
  const lost = tiers.filter((row) => (row.lostCount ?? 0) > 0);
  const byCount = soleTop(lost, (row) => row.lostCount ?? 0);
  const byDues = soleTop(lost, (row) => row.duesLostUsd ?? 0);
  if (!byCount || !byDues || byCount === byDues) return null;

  const duesTierLost = Math.round(byDues.lostCount ?? 0);
  return {
    countLead: `${byCount.tier} lost ${pluralize(Math.round(byCount.lostCount ?? 0), 'membership')}`,
    duesLead: `${byDues.tier} lost the money`,
    text: `${formatCount(duesTierLost)} ${byDues.tier} ${duesTierLost === 1 ? 'departure' : 'departures'} cost ${formatUsd(byDues.duesLostUsd)} against ${byCount.tier}'s ${formatUsd(byCount.duesLostUsd)}. That inversion is the whole argument for leading on revenue churn rather than logo churn.`,
  };
}

/** The row with the highest value, or `null` when none is positive or the top is tied. */
function soleTop<T>(rows: T[], value: (row: T) => number): T | null {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  const [first, second] = sorted;
  if (!first || value(first) <= 0 || (second && value(second) === value(first))) return null;
  return first;
}

/** The years up to the selected one, oldest first, capped to the trend's window. */
function buildChurnTrend(
  years: HealthMetricsMembersChurnYear[],
  year: number,
  rateOf: (row: HealthMetricsMembersChurnYear | null) => number | null
): HealthMetricsMembersChurnTrendPointView[] {
  return years
    .filter((row) => row.year <= year && row.year > year - HEALTH_METRICS_MEMBERS_CHURN_TREND_YEARS)
    .sort((a, b) => a.year - b.year)
    .map((row) => {
      const value = rateOf(row);
      return {
        year: row.year,
        label: String(row.year),
        value,
        valueLabel: value === null ? '—' : formatHealthMetricsPercent(value),
        isSelected: row.year === year,
      };
    });
}

/** A percentage to one decimal, dropping a trailing `.0`; under 1% never reads "0%" above zero. */
function formatChurnRate(pct: number | null): string {
  if (pct === null) return '—';
  return formatHealthMetricsSmallPercent(pct) ?? `${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

/** A share of the loss: whole from 1%, one decimal under it, so a small loss never reads "0%". */
function formatChurnShare(raw: number | null): string {
  return raw === null ? '—' : formatHealthMetricsPercent(raw);
}

/** A point change to one decimal with its sign, e.g. `+1.4pp`. */
function formatChurnChange(pp: number): string {
  const rounded = Math.round(pp * 10) / 10;
  if (rounded === 0) return '0.0pp';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}pp`;
}

/** A rise in churn is bad; a change that rounds to zero is neither. */
function churnChangeTone(pp: number | null): HealthMetricsMembersChurnView['changeTone'] {
  if (pp === null || Math.round(pp * 10) === 0) return 'neutral';
  return pp > 0 ? 'bad' : 'good';
}

function toWholePct(share: number | null): number | null {
  return share === null ? null : Math.min(100, Math.max(0, Math.round(share * 100)));
}

/** The percent a label shows (one decimal under 1%), so a plotted point or trend note matches its label. */
function toShownPct(share: number | null): number | null {
  return share === null ? null : Math.min(100, Math.max(0, healthMetricsShownPercent(share * 100)));
}

function formatIsoDate(value: string | null): string {
  return value ? formatIsoDateLabel(value) : '—';
}

/** "Promoter · NPS 9", the category alone without a score, or "No NPS response". */
function directoryNpsLabel(row: HealthMetricsMembersDirectoryMember): string {
  if (!row.npsCategory) return 'No NPS response';
  return row.npsScore === null ? row.npsCategory : `${row.npsCategory} · NPS ${Math.round(row.npsScore)}`;
}

/** The badge and its popup; with no level the cell reads "—" and has none. A zero or untracked count reads "—". */
function directoryEngagement(row: HealthMetricsMembersDirectoryMember): HealthMetricsMembersDirectoryEngagementView | null {
  const level = row.engagementLevel;
  if (!level) return null;
  const score = row.engagementScore === null ? null : row.engagementScore.toFixed(1);
  const count = (value: number | null): string => formatCount(value || null);
  return {
    label: score === null ? level : `${level} ${score}`,
    badgeClass: HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_BADGE_CLASSES[level],
    tip: {
      title: score === null ? `${level} engagement` : `${level} engagement · ${score}`,
      rows: [
        { label: 'Contribution', value: count(row.contributionCount), color: null, separated: false },
        { label: 'Training', value: count(row.trainingEnrollmentCount), color: null, separated: false },
        { label: 'Events', value: count(row.eventRegistrationCount), color: null, separated: false },
        { label: 'Last engaged', value: formatIsoDate(row.lastEngagedDate), color: null, separated: false },
      ],
    },
  };
}

function formatCount(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('en-US');
}

function formatUsd(value: number | null): string {
  return value === null ? '—' : formatCurrency(value);
}

/** A 0–1 share as Health Metrics shows a percentage: whole from 1%, one decimal under it, held to 0–100%. */
function formatPct(fraction: number | null): string {
  return fraction === null ? '—' : formatHealthMetricsPercent(Math.min(100, Math.max(0, fraction * 100)));
}

function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? noun : plural}`;
}

/** A score or change with its sign; zero carries none. */
function formatSignedScore(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}`;
}

function directionOf(value: number | null): 'up' | 'down' | 'neutral' {
  if (value === null || Math.round(value) === 0) return 'neutral';
  return value > 0 ? 'up' : 'down';
}

/** A tier as the breakdown shows it: its rows merged under one label, with its members per year. */
interface BreakdownTier {
  label: string;
  reserved: HealthMetricsMembersReservedTier | null;
  rank: number;
  members: Map<number, number | null>;
}

/** Tiers with a member in any year shown, highest-paying first; rows with the same label merge. */
function collectBreakdownTiers(rows: HealthMetricsMembersTierYear[]): BreakdownTier[] {
  const byLabel = new Map<string, BreakdownTier>();
  for (const row of rows) {
    const { label, reserved } = resolveHealthMetricsMembersTier(row.tier);
    const tier = byLabel.get(label) ?? { label, reserved, rank: row.sortRank, members: new Map<number, number | null>() };
    tier.rank = Math.min(tier.rank, row.sortRank);
    tier.members.set(row.year, sumNullable([tier.members.get(row.year) ?? null, row.memberCount]));
    byLabel.set(label, tier);
  }

  return [...byLabel.values()]
    .filter((tier) => [...tier.members.values()].some((count) => (count ?? 0) > 0))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

/** The smallest whole, evenly readable step (e.g. 750 for a 3,000 top) whose four steps reach the top. */
function chartScaleStep(top: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(top, 4) / 4));
  return (
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10].map((factor) => factor * magnitude).find((step) => Number.isInteger(step) && step * 4 >= top) ?? magnitude * 10
  );
}

function sumNullable(values: (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0 ? null : measured.reduce((sum, value) => sum + value, 0);
}

/** A year's running totals with gaps carried forward from the month before, starting from none. */
function fillCumulative(months: (number | null)[]): number[] {
  let last = 0;
  return months.map((value) => (last = value ?? last));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
