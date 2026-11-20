// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MONTH_NAMES } from '../constants/calendar.constants';
import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_DOT_CLASSES,
  HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_TIPS,
  HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS,
  HEALTH_METRICS_MEMBERS_BOARD_BAR_COLORS,
  HEALTH_METRICS_MEMBERS_BOARD_CHART,
  HEALTH_METRICS_MEMBERS_BOARD_COHORT_PEOPLE,
  HEALTH_METRICS_MEMBERS_BOARD_COHORT_RULES,
  HEALTH_METRICS_MEMBERS_BOARD_COHORTS,
  HEALTH_METRICS_MEMBERS_BOARD_FILL_CLASSES,
  HEALTH_METRICS_MEMBERS_BOARD_MEETING_FALLBACKS,
  HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS,
  HEALTH_METRICS_MEMBERS_BOARD_OTHER_COHORT_LABELS,
  HEALTH_METRICS_MEMBERS_BREAKDOWN_FIRST_YEAR,
  HEALTH_METRICS_MEMBERS_CHURN_HIGH_RATE_PCT,
  HEALTH_METRICS_MEMBERS_CHURN_TREND_CHART,
  HEALTH_METRICS_MEMBERS_CHURN_TREND_COLORS,
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
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS,
  HEALTH_METRICS_MEMBERS_RESERVED_TIERS,
  HEALTH_METRICS_MEMBERS_RESERVED_TIER_LABELS,
  HEALTH_METRICS_MEMBERS_SECTIONS,
} from '../constants/health-metrics-members.constants';
import { formatIsoDateLabel, formatIsoDateShortLabel } from './date-time.utils';
import { buildHealthMetricsBarChart } from './health-metrics-bar-chart.utils';
import { healthMetricsColumnChartCeiling } from './health-metrics-column-chart.utils';
import {
  formatHealthMetricsPercent,
  formatHealthMetricsSmallPercent,
  healthMetricsShownPercent,
  healthMetricsTierSortRank,
  resolveHealthMetricsMembersTier,
} from './health-metrics-table.utils';
import { formatCurrency } from './number.utils';

import type { HealthMetricsBarChartLabelTone, HealthMetricsBarChartView } from '../interfaces/health-metrics-bar-chart.interface';
import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type { HealthMetricsChartTipRowView, HealthMetricsL2Section, HealthMetricsMetricItem } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsMembersAtRisk,
  HealthMetricsMembersAtRiskAging,
  HealthMetricsMembersAtRiskBucket,
  HealthMetricsMembersAtRiskFilter,
  HealthMetricsMembersAtRiskMember,
  HealthMetricsMembersAtRiskRowView,
  HealthMetricsMembersAtRiskSummary,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersBoardCohortSummary,
  HealthMetricsMembersBoardMeeting,
  HealthMetricsMembersBoardMeetingRowView,
  HealthMetricsMembersBreakdownColumnView,
  HealthMetricsMembersBreakdownRowView,
  HealthMetricsMembersBreakdownView,
  HealthMetricsMembersChurn,
  HealthMetricsMembersChurnDeparture,
  HealthMetricsMembersChurnDepartureRowView,
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
  HealthMetricsMembersRenewalsWindow,
  HealthMetricsMembersReservedTier,
  HealthMetricsMembersSectionKey,
  HealthMetricsMembersSubNavItem,
  HealthMetricsMembersTierYear,
  HealthMetricsMembersTiers,
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

/**
 * The at-risk metrics: the outstanding balance with its members, then High (90+ days) and Medium (60–89) risk. With
 * one bucket switched on, only the outstanding balance shows, for that bucket. An unset total is a dash.
 */
export function buildHealthMetricsMembersAtRiskMetrics(
  response: HealthMetricsMembersAtRisk,
  bucket: HealthMetricsMembersAtRiskFilter
): HealthMetricsMetricItem[] {
  const totals = (key: HealthMetricsMembersAtRiskBucket): HealthMetricsMembersAtRiskAging | null =>
    response.aging.find((entry) => entry.bucket === key) ?? null;
  const picked = bucket === 'all' ? null : totals(bucket);
  const outstanding = bucket === 'all' ? response.summary.outstandingBalanceUsd : (picked?.balanceUsd ?? null);
  const members = bucket === 'all' ? response.summary.memberCount : (picked?.memberCount ?? null);
  const items: HealthMetricsMetricItem[] = [
    { key: 'outstanding', label: 'Outstanding balance', value: formatUsd(outstanding), description: `${formatMemberCount(members)} at risk` },
  ];
  if (bucket !== 'all') return items;

  const risk = (key: HealthMetricsMembersAtRiskBucket, label: string): HealthMetricsMetricItem => ({
    key,
    label,
    value: formatUsd(totals(key)?.balanceUsd ?? null),
    description: formatMemberCount(totals(key)?.memberCount ?? null),
    dotClass: HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_DOT_CLASSES[key],
    tip: HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_TIPS[key],
  });
  return [...items, risk('90_plus_days', 'High risk'), risk('60_89_days', 'Medium risk')];
}

/** At-risk rows: the company with its last engaged date, the tier, the balance and its age; a missing value is a dash. */
export function buildHealthMetricsMembersAtRiskRows(rows: HealthMetricsMembersAtRiskMember[]): HealthMetricsMembersAtRiskRowView[] {
  return rows.map((row) => {
    const tier = row.membershipTier?.trim() ? resolveHealthMetricsMembersTier(row.membershipTier) : null;
    return {
      accountId: row.accountId,
      name: row.accountName,
      logoUrl: row.logoUrl,
      lastEngagedLabel: row.lastEngagedDate ? `Last engaged ${formatIsoDateLabel(row.lastEngagedDate)}` : '',
      membershipLabel: tier?.label ?? '—',
      tier: tier?.reserved ?? null,
      overdueLabel: formatUsd(row.outstandingBalanceUsd),
      ageLabel: row.daysOverdue === null ? '—' : pluralize(Math.round(row.daysOverdue), 'day'),
      ageDotClass: row.agingBucket ? HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_DOT_CLASSES[row.agingBucket] : '',
    };
  });
}

/** The sub-nav note, "12 overdue · $480K"; empty while no member is at risk or either total is unset. */
export function buildHealthMetricsMembersAtRiskNote(summary: HealthMetricsMembersAtRiskSummary): string {
  if (summary.memberCount === null || summary.memberCount <= 0 || summary.outstandingBalanceUsd === null) return '';
  return `${summary.memberCount.toLocaleString('en-US')} overdue · ${formatCurrency(summary.outstandingBalanceUsd)}`;
}

/** The renewals metrics: the known dues up for renewal, and how many renew in the window. */
export function buildHealthMetricsMembersRenewalsMetrics(summary: HealthMetricsMembersRenewalsSummary): HealthMetricsMetricItem[] {
  return [
    { key: 'value', label: 'Value up for renewal', value: formatUsd(summary.valueUsd) },
    { key: 'due', label: 'Renewals due', value: formatCount(summary.renewalCount) },
  ];
}

/** Renewal rows; a missing tier, date or dues renders as a dash, never $0. */
export function buildHealthMetricsMembersRenewalRows(rows: HealthMetricsMembersRenewal[]): HealthMetricsMembersRenewalRowView[] {
  return rows.map((row) => {
    const tier = row.membershipTier?.trim() ? resolveHealthMetricsMembersTier(row.membershipTier) : null;
    return {
      accountId: row.accountId,
      name: row.accountName,
      logoUrl: row.logoUrl,
      membershipLabel: tier?.label ?? '—',
      tier: tier?.reserved ?? null,
      renewalDateLabel: formatIsoDate(row.renewalDate),
      duesLabel: formatUsd(row.duesUsd),
    };
  });
}

/** The at-risk bucket a URL value names; anything else is "All at risk". */
export function parseHealthMetricsMembersAtRiskFilter(value: string | null): HealthMetricsMembersAtRiskFilter {
  return HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS.find((option) => option.id === value)?.id ?? 'all';
}

/** The renewals window a URL value names; anything else is the first, the next 90 days. */
export function parseHealthMetricsMembersRenewalsWindow(value: string | null): HealthMetricsMembersRenewalsWindow {
  return HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS.find((window) => window === value) ?? HEALTH_METRICS_MEMBERS_RENEWALS_WINDOWS[0];
}

/** The cohort switch's value from the URL or the switch; anything else is the board. */
export function parseHealthMetricsMembersBoardCohort(value: string | null): HealthMetricsMembersBoardCohort {
  return HEALTH_METRICS_MEMBERS_BOARD_COHORTS.find((cohort) => cohort === value) ?? HEALTH_METRICS_MEMBERS_BOARD_COHORTS[0];
}

/**
 * The selected cohort's last meeting, the other cohort's beside it, and who never attended. Values stay ink; only the
 * chart and table mark a meeting below its level.
 */
export function buildHealthMetricsMembersBoardMetrics(
  cohort: HealthMetricsMembersBoardCohort,
  cohorts: Record<HealthMetricsMembersBoardCohort, HealthMetricsMembersBoardCohortSummary | null>
): HealthMetricsMetricItem[] {
  const other = HEALTH_METRICS_MEMBERS_BOARD_COHORTS.find((candidate) => candidate !== cohort) ?? cohort;
  const selected = cohorts[cohort];
  const people = HEALTH_METRICS_MEMBERS_BOARD_COHORT_PEOPLE[cohort];
  const peopleLabel = people.charAt(0).toUpperCase() + people.slice(1);
  const ofCount = (summary: HealthMetricsMembersBoardCohortSummary | null, suffix: string): string => {
    const attended = summary?.latestAttendedCount ?? null;
    const invited = summary?.latestInvitedCount ?? null;
    return attended === null || invited === null ? '' : `${formatCount(attended)} of ${formatCount(invited)} ${suffix}`;
  };

  return [
    {
      key: 'latest',
      label: 'Last meeting attendance',
      value: formatPct(selected?.latestAttendancePct ?? null),
      description: ofCount(selected, `${people} attended`),
    },
    {
      key: 'other',
      label: HEALTH_METRICS_MEMBERS_BOARD_OTHER_COHORT_LABELS[other],
      value: formatPct(cohorts[other]?.latestAttendancePct ?? null),
      description: ofCount(cohorts[other], 'at last meeting'),
    },
    {
      key: 'never',
      label: 'Never attended',
      value: formatCount(selected?.neverAttendedCount ?? null),
      description: `${peopleLabel} with no meeting this year`,
    },
  ];
}

/** Meeting rows: the name, the date, and "5/7・71%" over a bar that turns red below the cohort's level. */
export function buildHealthMetricsMembersBoardMeetingRows(
  rows: HealthMetricsMembersBoardMeeting[],
  cohort: HealthMetricsMembersBoardCohort
): HealthMetricsMembersBoardMeetingRowView[] {
  return rows.map((row) => {
    const pct = toShownPct(row.attendancePct);
    const counts = row.attendedCount === null || row.invitedCount === null ? null : `${formatCount(row.attendedCount)}/${formatCount(row.invitedCount)}`;
    const shown = formatPct(row.attendancePct);
    return {
      meetingId: row.meetingId,
      meetingName: boardMeetingName(row, cohort),
      dateLabel: formatIsoDate(row.meetingDate),
      attendanceLabel: counts === null ? shown : `${counts}・${shown}`,
      attendancePct: pct,
      fillClass: HEALTH_METRICS_MEMBERS_BOARD_FILL_CLASSES[isBoardBelowLevel(cohort, pct) ? 'low' : 'ok'],
    };
  });
}

/**
 * The design's chart: one bar per meeting, oldest first, red below the cohort's level and blue otherwise, the latest
 * solid and the rest at 20%. Its popup names the meeting, then its date and attendance.
 */
export function buildHealthMetricsMembersBoardChart(
  trend: HealthMetricsMembersBoardMeeting[],
  cohort: HealthMetricsMembersBoardCohort
): HealthMetricsBarChartView {
  const last = trend.length - 1;

  return buildHealthMetricsBarChart({
    heightPx: HEALTH_METRICS_MEMBERS_BOARD_CHART.heightPx,
    barWidthPx: HEALTH_METRICS_MEMBERS_BOARD_CHART.barWidthPx,
    max: 100,
    ticks: ['100%', '75%', '50%', '25%', '0%'],
    bars: trend.map((meeting, index) => {
      const pct = toShownPct(meeting.attendancePct);
      const low = isBoardBelowLevel(cohort, pct);
      const latest = index === last;
      const color = HEALTH_METRICS_MEMBERS_BOARD_BAR_COLORS[low ? 'low' : 'ok'];
      const valueLabel = formatPct(meeting.attendancePct);
      const counts =
        meeting.attendedCount === null || meeting.invitedCount === null
          ? ''
          : ` · ${formatCount(meeting.attendedCount)} / ${formatCount(meeting.invitedCount)}`;
      return {
        key: meeting.meetingId,
        label: formatIsoDateShortLabel(meeting.meetingDate) ?? '—',
        value: pct,
        valueLabel,
        labelTone: boardLabelTone(latest, low),
        color,
        opacity: latest ? 1 : HEALTH_METRICS_MEMBERS_BOARD_CHART.earlierOpacity,
        lineValue: null,
        tip: {
          title: boardMeetingName(meeting, cohort),
          rows: [
            { label: 'Date', value: formatIsoDate(meeting.meetingDate), color: null, separated: false },
            { label: 'Attendance', value: `${valueLabel}${counts}`, color, separated: false },
          ],
        },
      };
    }),
    line: null,
    legend: [],
    ariaLabel: `Attendance at the latest ${pluralize(trend.length, HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS[cohort])}, oldest first`,
  });
}

/** The sub-nav note: the board's latest meeting, "{pct}% attended"; empty when it has none. */
export function buildHealthMetricsMembersBoardNote(board: HealthMetricsMembersBoardCohortSummary | null): string {
  const pct = board?.latestAttendancePct ?? null;
  return pct === null ? '' : `${formatPct(pct)} attended`;
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

/** `#churn` for the selected year: its metrics, the loss by tier and the trend of revenue churn. */
export function buildHealthMetricsMembersChurnView(churn: HealthMetricsMembersChurn, range: HealthMetricsRange): HealthMetricsMembersChurnView {
  const year = getYearForRange(range);
  const current = churn.years.find((row) => row.year === year) ?? null;
  const prior = churn.years.find((row) => row.year === year - 1) ?? null;
  const revenue = revenueChurnRate(current);
  const change = churnDifference(revenue, revenueChurnRate(prior));
  const trend = buildChurnTrend(churn.years, year, revenueChurnRate);

  return {
    measured: churn.years.length > 0,
    // A null count is unmeasured, so it must not read as "no churn".
    yearMeasured: current !== null && current.lostCount !== null,
    year,
    metrics: buildChurnMetrics(current, revenue, year, change),
    // A year that lost no membership has no loss to split, so By tier reads as empty rather than rows of zeroes.
    tiers: Math.round(current?.lostCount ?? 0) > 0 ? buildChurnTierRows(churn.tiers.filter((row) => row.year === year)) : [],
    trend,
    trendChart: buildChurnTrendChart(trend),
  };
}

/** Members lost rows: the company, its tier, the dues lost, the lapse and the last engagement, a dash where the model has none. */
export function buildHealthMetricsMembersChurnDepartureRows(rows: HealthMetricsMembersChurnDeparture[]): HealthMetricsMembersChurnDepartureRowView[] {
  return rows.map((row) => {
    const tier = row.membershipTier?.trim() ? resolveHealthMetricsMembersTier(row.membershipTier) : null;
    return {
      key: row.key,
      accountId: row.accountId,
      name: row.accountName,
      logoUrl: row.logoUrl,
      membershipLabel: tier?.label ?? '—',
      tier: tier?.reserved ?? null,
      duesLabel: formatUsd(row.duesLostUsd),
      lapsedLabel: formatIsoDate(row.lapsedDate),
      lastEngagedLabel: formatIsoDate(row.lastEngagedDate),
    };
  });
}

/**
 * A year's revenue churn. The view has no rate without opening dues, but a year that lost no membership and no dues
 * lost nothing, so it reads 0 rather than unmeasured; any other missing rate stays `null`.
 */
function revenueChurnRate(row: HealthMetricsMembersChurnYear | null): number | null {
  if (!row) return null;
  if (row.revenueNotRenewedRate !== null) return row.revenueNotRenewedRate;
  // Both must be recorded zeros; unmeasured dues keep the rate unmeasured.
  return row.lostCount === 0 && row.duesLostUsd === 0 ? 0 : null;
}

function churnDifference(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

/**
 * Revenue churn with its change on the year before (a fall is good news), logo churn with the memberships it counts,
 * and the dues lost against the year before. "This year" and "last year" name the running year only.
 */
function buildChurnMetrics(
  current: HealthMetricsMembersChurnYear | null,
  revenueRate: number | null,
  year: number,
  change: number | null
): HealthMetricsMetricItem[] {
  const isCurrentYear = year === getYearForRange('YTD');
  const lost = current?.lostCount ?? null;
  const opening = current?.openingCount ?? null;
  const priorDues = current?.duesLostPriorUsd ?? null;
  const revenue: HealthMetricsMetricItem = { key: 'revenue', label: 'Revenue churn', value: formatRevenueChurn(revenueRate) };
  if (change !== null) {
    revenue.descriptionLead = formatChurnChange(change);
    revenue.descriptionLeadTone = churnChangeTone(change);
    revenue.description = ` vs ${year - 1}`;
  }

  return [
    revenue,
    {
      key: 'logo',
      label: 'Logo churn',
      value: formatChurnRate(current?.logoChurnRate ?? null),
      description: lost === null || opening === null ? '' : `${formatCount(lost)} of ${pluralize(Math.round(opening), 'membership')}`,
    },
    {
      key: 'dues',
      label: isCurrentYear ? 'Dues lost this year' : `Dues lost in ${year}`,
      value: formatUsd(current?.duesLostUsd ?? null),
      description: priorDues === null ? '' : `${formatUsd(priorDues)} ${isCurrentYear ? 'last year' : `in ${year - 1}`}`,
    },
  ];
}

/** Most dues lost first, then the model's tier order. */
function buildChurnTierRows(tiers: HealthMetricsMembersChurnTier[]): HealthMetricsMembersChurnTierRowView[] {
  return [...tiers]
    .sort((a, b) => (b.duesLostUsd ?? -1) - (a.duesLostUsd ?? -1) || a.tierSortRank - b.tierSortRank || a.tier.localeCompare(b.tier, 'en-US'))
    .map((row) => {
      const { label, reserved } = resolveHealthMetricsMembersTier(row.tier);
      const share = row.shareOfLossPct === null ? null : Math.min(100, Math.max(0, row.shareOfLossPct));
      return {
        key: row.tier,
        membershipLabel: label,
        tier: reserved,
        lostLabel: formatCount(row.lostCount),
        rateLabel: formatChurnRate(row.churnRate),
        isHighRate: row.churnRate !== null && row.churnRate >= HEALTH_METRICS_MEMBERS_CHURN_HIGH_RATE_PCT,
        duesLabel: formatUsd(row.duesLostUsd),
        shareLabel: formatChurnShare(share),
        // Rates and shares sort on the value their cells show.
        sortValues: {
          membership: healthMetricsTierSortRank(row.tier),
          lost: row.lostCount,
          rate: row.churnRate === null ? null : shownChurnRate(row.churnRate),
          dues: row.duesLostUsd,
          share: share === null ? null : healthMetricsShownPercent(share),
        },
      };
    });
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
        logoValue: row.logoChurnRate,
        logoValueLabel: row.logoChurnRate === null ? '—' : formatHealthMetricsPercent(row.logoChurnRate),
        isSelected: row.year === year,
      };
    });
}

/**
 * The design's trend: revenue churn bars, the selected year solid and the years before it pale, with logo churn as a
 * dashed line on the same axis, which runs from 0% to the higher of the two rounded up to whole quarters.
 */
function buildChurnTrendChart(points: HealthMetricsMembersChurnTrendPointView[]): HealthMetricsBarChartView {
  const peak = Math.max(0, ...points.flatMap((point) => [point.value ?? 0, point.logoValue ?? 0]));
  const top = healthMetricsColumnChartCeiling(peak);
  const colors = HEALTH_METRICS_MEMBERS_CHURN_TREND_COLORS;

  return buildHealthMetricsBarChart({
    heightPx: HEALTH_METRICS_MEMBERS_CHURN_TREND_CHART.heightPx,
    barWidthPx: HEALTH_METRICS_MEMBERS_CHURN_TREND_CHART.barWidthPx,
    max: top,
    ticks: [1, 0.75, 0.5, 0.25, 0].map((share) => `${top * share}%`),
    bars: points.map((point) => ({
      key: String(point.year),
      label: point.label,
      value: point.value,
      valueLabel: point.valueLabel,
      labelTone: point.isSelected ? 'strong' : 'muted',
      color: colors.revenue,
      opacity: point.isSelected ? 1 : HEALTH_METRICS_MEMBERS_CHURN_TREND_CHART.earlierOpacity,
      lineValue: point.logoValue,
      tip: {
        title: point.label,
        rows: [
          { label: 'Revenue churn', value: point.valueLabel, color: colors.revenue, separated: false },
          { label: 'Logo churn', value: point.logoValueLabel, color: colors.logo, separated: false },
        ],
      },
    })),
    line: { color: colors.logo, max: top, ticks: [] },
    legend: [
      { key: 'revenue', label: 'Revenue churn', color: colors.revenue, kind: 'bar' },
      { key: 'logo', label: 'Logo churn', color: colors.logo, kind: 'line' },
    ],
    ariaLabel: `Revenue and logo churn over ${points.length} years, oldest first`,
  });
}

/** A percentage to one decimal, dropping a trailing `.0`; under 1% never reads "0%" above zero. */
function formatChurnRate(pct: number | null): string {
  if (pct === null) return '—';
  return formatHealthMetricsSmallPercent(pct) ?? `${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

/** A churn rate as its cell shows it: one decimal, with the small-percent rule under 1%, so the sort matches the label. */
function shownChurnRate(pct: number): number {
  if (pct > 0 && pct < 1) return healthMetricsShownPercent(pct);
  return Math.round(pct * 10) / 10;
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

/** A fall in churn is good news, so it reads green; a change that rounds to zero is flat. */
function churnChangeTone(pp: number): 'up' | 'down' | 'flat' {
  if (Math.round(pp * 10) === 0) return 'flat';
  return pp < 0 ? 'up' : 'down';
}

/** Revenue churn to one decimal, "0%" for a year that lost nothing; under 1% follows the small-percent rule. */
function formatRevenueChurn(pct: number | null): string {
  if (pct === null) return '—';
  if (pct === 0) return '0%';
  return formatHealthMetricsSmallPercent(pct) ?? `${pct.toFixed(1)}%`;
}

/** Below the cohort's level on the percent the cell shows, so a bar reading "90%" is never red under the board's 90%. */
function isBoardBelowLevel(cohort: HealthMetricsMembersBoardCohort, shownPct: number | null): boolean {
  return shownPct !== null && shownPct < Math.round(HEALTH_METRICS_MEMBERS_BOARD_COHORT_RULES[cohort].threshold * 100);
}

/** The latest bar's label is ink, or red below the level; earlier bars are muted. */
function boardLabelTone(latest: boolean, low: boolean): HealthMetricsBarChartLabelTone {
  if (!latest) return 'muted';
  return low ? 'alert' : 'strong';
}

/** The meeting name the view carries today: its committee, then the cohort's own fallback, then "—". */
function boardMeetingName(meeting: HealthMetricsMembersBoardMeeting, cohort: HealthMetricsMembersBoardCohort): string {
  return meeting.committeeName ?? HEALTH_METRICS_MEMBERS_BOARD_MEETING_FALLBACKS[cohort] ?? '—';
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

/** "{N} members", or a dash for an unset count. */
function formatMemberCount(count: number | null): string {
  return count === null ? '—' : pluralize(count, 'member');
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
