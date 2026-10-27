// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_OVERVIEW_BOARD_GOOD_ATTENDANCE,
  HEALTH_METRICS_OVERVIEW_EVENT_GOAL_SHARES,
  HEALTH_METRICS_OVERVIEW_EVENT_PACE,
  HEALTH_METRICS_OVERVIEW_EVENT_STATUS,
  HEALTH_METRICS_OVERVIEW_EVENTS_INFO,
  HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS,
  HEALTH_METRICS_OVERVIEW_FILL_CLASSES,
  HEALTH_METRICS_OVERVIEW_STROKES,
  HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS,
} from '../constants/health-metrics-overview.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { getHealthMetricsTrainingDeliveryTypeLabel } from './health-metrics-training.utils';
import { formatCurrency, formatNumber } from './number.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsSponsorship,
} from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsOverviewBalanceView,
  HealthMetricsOverviewBoard,
  HealthMetricsOverviewBoardRowView,
  HealthMetricsOverviewBoardSort,
  HealthMetricsOverviewBoardView,
  HealthMetricsOverviewChurn,
  HealthMetricsOverviewChurnView,
  HealthMetricsOverviewCode,
  HealthMetricsOverviewCodeView,
  HealthMetricsOverviewDelta,
  HealthMetricsOverviewDonutSegmentView,
  HealthMetricsOverviewEngagementSplit,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewEventRegistrationsView,
  HealthMetricsOverviewEventRowView,
  HealthMetricsOverviewEvents,
  HealthMetricsOverviewEventsView,
  HealthMetricsOverviewGaugeSegmentView,
  HealthMetricsOverviewKpiView,
  HealthMetricsOverviewNps,
  HealthMetricsOverviewNpsView,
  HealthMetricsOverviewOrgsHalfView,
  HealthMetricsOverviewOutstandingBalance,
  HealthMetricsOverviewParticipatingOrgs,
  HealthMetricsOverviewParticipatingOrgsView,
  HealthMetricsOverviewTrainingMetric,
  HealthMetricsOverviewTrainingView,
  HealthMetricsOverviewTrendView,
} from '../interfaces/health-metrics-overview.interface';
import type { HealthMetricsTrainingEnrollment } from '../interfaces/health-metrics-training.interface';

const NOT_AVAILABLE = '—';

/** The page header's year-to-date span, e.g. "Jan 1 – Oct 22, 2026", shown beside the YTD period. */
export function buildHealthMetricsYtdRangeLabel(today: Date): string {
  const end = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Jan 1 – ${end}, ${today.getFullYear()}`;
}

/** The selected period as one the Overview views carry columns for; `null` for any other. */
export function toHealthMetricsOverviewRange(range: HealthMetricsRange): HealthMetricsL2Range | null {
  return (HEALTH_METRICS_L2_RANGES as readonly HealthMetricsRange[]).includes(range) ? (range as HealthMetricsL2Range) : null;
}

/** Members and non-members, each with its two KPIs and engagement split. */
export function buildHealthMetricsOverviewOrgsView(
  orgs: HealthMetricsOverviewParticipatingOrgs,
  range: HealthMetricsRange
): HealthMetricsOverviewParticipatingOrgsView {
  const l2 = toHealthMetricsOverviewRange(range);
  const period = l2 ? orgs.periods[l2] : null;
  const counts = [period?.activeMembers, period?.newMembers, period?.nonRenewals, period?.nonMembers];

  return {
    isEmpty: !orgs.measured || !period || counts.every((count) => !count),
    halves: [
      buildOrgsHalf(
        'members',
        [kpi('active', 'Active members', formatCount(period?.activeMembers)), kpi('new', 'New members', formatCount(period?.newMembers))],
        'Member engagement',
        period?.memberEngagement ?? null
      ),
      buildOrgsHalf(
        'non-members',
        [kpi('non-members', 'Non-members', formatCount(period?.nonMembers)), kpi('non-renewals', 'Non-renewals', formatCount(period?.nonRenewals))],
        'Non-member engagement',
        period?.nonMemberEngagement ?? null
      ),
    ],
  };
}

/** The Board audience's latest survey: the score on its gauge, the change, and the response split. */
export function buildHealthMetricsOverviewNpsView(nps: HealthMetricsOverviewNps, range: HealthMetricsRange): HealthMetricsOverviewNpsView {
  const l2 = toHealthMetricsOverviewRange(range);
  const period = l2 ? nps.periods[l2] : null;
  const score = period?.npsScore ?? null;
  const responses = period?.responsesCount ?? null;
  const rows = [
    { key: 'promoters', label: 'Promoters', range: '9–10', dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high, count: period?.promotersCount ?? null },
    { key: 'passives', label: 'Passives', range: '7–8', dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium, count: period?.passivesCount ?? null },
    { key: 'detractors', label: 'Detractors', range: '0–6', dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low, count: period?.detractorsCount ?? null },
  ];

  return {
    isEmpty: !period || (score === null && !responses),
    subtitle: `Last survey: ${period?.lastUpdatedQuarter ?? NOT_AVAILABLE} · ${formatCount(responses)} of ${formatCount(period?.recipientsCount)} responded (${formatShare(period?.responseRatePct ?? null)})`,
    scoreLabel: score === null ? NOT_AVAILABLE : String(Math.round(score)),
    delta: buildNpsDelta(period?.scoreChangePp ?? null, period?.previousSurveyQuarter ?? null),
    segments: buildGaugeSegments(score),
    needle: score === null ? null : gaugeNeedle(score),
    ariaLabel: score === null ? 'Net Promoter Score not available' : `Net Promoter Score ${Math.round(score)} on a scale from -100 to 100`,
    rows: rows.map((row) => ({
      key: row.key,
      label: row.label,
      range: row.range,
      dotClass: row.dotClass,
      countLabel: formatCount(row.count),
      pctLabel: responses && row.count !== null ? formatShare(row.count / responses, false) : NOT_AVAILABLE,
    })),
    noResponseLabel: formatCount(period?.noResponseCount),
  };
}

/** The foundation's churn against last year, then every tier against the overall rate. */
export function buildHealthMetricsOverviewChurnView(churn: HealthMetricsOverviewChurn, range: HealthMetricsRange): HealthMetricsOverviewChurnView {
  const l2 = toHealthMetricsOverviewRange(range);
  const period = l2 ? churn.periods[l2] : null;
  const totals = period?.totals ?? null;
  const rate = totals?.churnRatePct ?? null;

  return {
    isEmpty: !totals || (!totals.membershipsLost && !rate),
    kpis: [
      {
        key: 'rate',
        label: 'Churn rate',
        value: formatRatePct(rate),
        delta: buildPointsDelta(totals?.churnRateChangePp ?? null, false),
        note:
          totals?.churnRatePctPriorYear === null || totals?.churnRatePctPriorYear === undefined
            ? ''
            : `${formatRatePct(totals.churnRatePctPriorYear)} last year`,
      },
      {
        key: 'value',
        label: 'Value lost',
        value: formatMoneyCompact(totals?.valueLostUsd),
        delta: buildPctDelta(totals?.valueLostChangePct ?? null, false),
        note:
          totals?.valueLostUsdPriorYear === null || totals?.valueLostUsdPriorYear === undefined
            ? ''
            : `${formatMoneyCompact(totals.valueLostUsdPriorYear)} last year`,
      },
      {
        key: 'lost',
        label: 'Memberships lost',
        value: formatCount(totals?.membershipsLost),
        delta: buildPctDelta(totals?.membershipsLostChangePct ?? null, false),
        note:
          totals?.membershipsLostPriorYear === null || totals?.membershipsLostPriorYear === undefined
            ? ''
            : `${formatCount(totals.membershipsLostPriorYear)} last year`,
      },
    ],
    tiers: (period?.tiers ?? []).map((tier) => ({
      key: tier.tier,
      label: tier.label,
      rateLabel: formatRatePct(tier.churnRatePct),
      rateWidthPct: clampPct(tier.churnRatePct ?? 0),
      lostLabel: formatCount(tier.membershipsLost),
      valueLabel: formatMoneyCompact(tier.valueLostUsd),
    })),
    overallPct: clampPct(rate ?? 0),
    overallLabel: `Overall churn ${formatRatePct(rate)}`,
  };
}

/** Overdue invoices today, split into the high and medium risk bands. */
export function buildHealthMetricsOverviewBalanceView(balance: HealthMetricsOverviewOutstandingBalance): HealthMetricsOverviewBalanceView {
  const high = balance.highRiskUsd ?? 0;
  const medium = balance.mediumRiskUsd ?? 0;
  // The view's share when it has one, otherwise the band's part of the two amounts.
  const share = (pct: number | null, amount: number): number => {
    if (pct !== null) return clampPct(pct * 100);
    return high + medium > 0 ? clampPct((amount / (high + medium)) * 100) : 0;
  };
  const highMembers = balance.highRiskMembers;

  return {
    isEmpty: !balance.measured || !balance.outstandingUsd,
    isPaidInFull: balance.measured && balance.outstandingUsd === 0,
    totalLabel: formatMoney(balance.outstandingUsd),
    overdueMembersLabel: formatCount(balance.overdueMembers),
    atRiskLabel: formatMembers(highMembers),
    rows: [
      {
        key: 'high',
        label: 'High risk',
        daysLabel: '90+ days',
        dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low,
        widthPct: share(balance.highRiskSharePct, high),
        membersLabel: formatCount(balance.highRiskMembers),
        amountLabel: formatMoney(balance.highRiskUsd),
      },
      {
        key: 'medium',
        label: 'Medium risk',
        daysLabel: '60–89 days',
        dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium,
        widthPct: share(balance.mediumRiskSharePct, medium),
        membersLabel: formatCount(balance.mediumRiskMembers),
        amountLabel: formatMoney(balance.mediumRiskUsd),
      },
    ],
  };
}

/**
 * The period's events split into held and upcoming, sponsorship against its goal, and the event list: upcoming
 * events for YTD, otherwise the year's past events.
 */
export function buildHealthMetricsOverviewEventsView(
  glance: HealthMetricsEventsAtAGlance,
  sponsorship: HealthMetricsEventsSponsorship,
  events: HealthMetricsOverviewEvents,
  range: HealthMetricsRange
): HealthMetricsOverviewEventsView {
  const l2 = toHealthMetricsOverviewRange(range);
  const isYtd = range === 'YTD';
  const period = glance.periods.find((candidate) => candidate.range === range) ?? null;
  const held = period?.pastEvents ?? null;
  const upcoming = isYtd ? glance.upcomingEvents : 0;
  const total = held === null || upcoming === null ? null : held + upcoming;
  const listed = isYtd ? events.upcoming : events.past.filter((event) => l2 !== null && event.ranges.includes(l2));
  const sponsorshipPeriod = sponsorship.periods.find((candidate) => candidate.range === range) ?? null;
  const revenue = sponsorshipPeriod?.revenueUsd ?? null;

  return {
    isEmpty: !total && listed.length === 0 && !revenue,
    total: {
      value: formatCount(total),
      // The view's change compares every event in the period, held and upcoming, with last year.
      delta: buildPctDelta(period?.changes?.events ?? null, true, ' vs last year'),
      pastLabel: formatCount(held),
      upcomingLabel: formatCount(upcoming),
      pastPct: total ? clampPct(((held ?? 0) / total) * 100) : 0,
      upcomingPct: total ? clampPct(((upcoming ?? 0) / total) * 100) : 0,
    },
    sponsorship: buildSponsorshipView(revenue, sponsorshipPeriod?.goalUsd ?? null, sponsorshipPeriod?.progressToGoal ?? null),
    listTitle: isYtd ? 'Upcoming events' : 'Past events',
    listInfo: isYtd ? HEALTH_METRICS_OVERVIEW_EVENTS_INFO.upcoming : HEALTH_METRICS_OVERVIEW_EVENTS_INFO.past,
    rows: listed.map((event) => buildEventRow(event, !isYtd)),
  };
}

/** The training total against its goal, and each program's share; the goal is modelled for YTD only. */
export function buildHealthMetricsOverviewTrainingView(
  enrollment: HealthMetricsTrainingEnrollment,
  range: HealthMetricsRange,
  metric: HealthMetricsOverviewTrainingMetric
): HealthMetricsOverviewTrainingView {
  const l2 = toHealthMetricsOverviewRange(range);
  const period = l2 ? enrollment.periods[l2] : null;
  const isRevenue = metric === 'revenue';
  const total = (isRevenue ? period?.totals.revenueUsd : period?.totals.enrollments) ?? null;
  const goals = trainingGoal(enrollment, range, isRevenue);
  const goal = goals.goal;
  const format = (value: number | null): string => formatTrainingValue(value, isRevenue);
  const fraction = goals.progress ?? (goal && total !== null ? total / goal : 0);
  const metricLabel = isRevenue ? 'Revenue' : 'Enrollments';
  const programs = (period?.byType ?? [])
    .filter((type) => (isRevenue ? type.isListedRevenue : type.isListed))
    .map((type) => ({
      key: type.deliveryType,
      label: getHealthMetricsTrainingDeliveryTypeLabel(type.deliveryType),
      value: (isRevenue ? type.revenueUsd : type.enrollments) ?? null,
    }))
    // A program with no figure is unmeasured, not zero, so it sorts last with no bar or share.
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.label.localeCompare(b.label));
  const largest = programs[0]?.value ?? 0;

  return {
    isEmpty: !enrollment.measured || !period || (!period.totals.enrollments && !period.totals.revenueUsd),
    totalLabel: format(total),
    metricLabel,
    goalLabel: goal ? `${formatShare(fraction)} of ${format(goal)} goal` : null,
    trackPath: trainingArcPath(1),
    progressPath: fraction > 0 ? trainingArcPath(Math.min(fraction, 1)) : '',
    ariaLabel: goal ? `${metricLabel} ${format(total)} of ${format(goal)} goal` : `${metricLabel} ${format(total)}`,
    items: programs.map((program) => ({
      key: program.key,
      label: program.label,
      valueLabel: format(program.value),
      widthPct: largest > 0 && program.value !== null ? Math.max((program.value / largest) * 100, 1) : 0,
      shareLabel: total && program.value !== null ? formatShare(program.value / total) : NOT_AVAILABLE,
    })),
  };
}

/** Contributors in the period, then the all-time roles as one segmented bar. */
export function buildHealthMetricsOverviewCodeView(code: HealthMetricsOverviewCode, range: HealthMetricsRange): HealthMetricsOverviewCodeView {
  const l2 = toHealthMetricsOverviewRange(range);
  const period = l2 ? code.periods[l2] : null;
  const roles = [
    { key: 'committers', label: 'Committers', value: code.committers, colorClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.blue },
    { key: 'maintainers', label: 'Maintainers', value: code.maintainers, colorClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.purple },
    { key: 'reviewers', label: 'Reviewers', value: code.reviewers, colorClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high },
  ];
  const roleTotal = roles.reduce((sum, role) => sum + (role.value ?? 0), 0);

  return {
    isEmpty: !code.measured || (!period?.contributors && roleTotal === 0),
    kpis: [kpi('total', 'Total contributors', formatCompact(period?.contributors)), kpi('new', 'New contributors', formatCompact(period?.newContributors))],
    roles: roles.map((role) => ({
      key: role.key,
      label: role.label,
      valueLabel: formatCount(role.value),
      widthPct: roleTotal > 0 && role.value ? Math.max((role.value / roleTotal) * 100, 1.5) : 0,
      colorClass: role.colorClass,
    })),
  };
}

/** The board's meetings and average attendance, and every member invited in the period. */
export function buildHealthMetricsOverviewBoardView(board: HealthMetricsOverviewBoard, range: HealthMetricsRange): HealthMetricsOverviewBoardView {
  const l2 = toHealthMetricsOverviewRange(range);
  const period = l2 ? board.periods[l2] : null;
  const rows: HealthMetricsOverviewBoardRowView[] = [];

  for (const member of board.members) {
    const attendance = l2 ? member.attendance[l2] : undefined;
    if (!attendance) continue;

    const share = attendance.attendancePct ?? (attendance.attended ?? 0) / attendance.invited;
    rows.push({
      key: member.key,
      name: member.name,
      initials: buildInitials(member.name),
      title: member.jobTitle ?? '',
      organization: member.organization ?? NOT_AVAILABLE,
      organizationInitial: member.organization?.charAt(0).toUpperCase() ?? '',
      logoUrl: member.logoUrl,
      attendedLabel: `${formatCount(attendance.attended ?? 0)} of ${formatCount(attendance.invited)}`,
      pctLabel: formatShare(share, false),
      attendance: share,
      widthPct: clampPct(share * 100),
      barClass: attendanceFill(share),
      lastAttendedLabel: member.lastAttendedDate ? formatIsoDateLabel(member.lastAttendedDate) : NOT_AVAILABLE,
    });
  }

  return {
    isEmpty: !period || !period.meetings,
    kpis: [
      {
        key: 'meetings',
        label: 'Total meetings',
        value: formatCount(period?.meetings),
        delta: buildPctDelta(period?.meetingsChangePct ?? null, true),
        note: '',
      },
      {
        key: 'attendance',
        label: 'Average attendance',
        value: formatShare(period?.avgAttendancePct ?? null, false),
        delta: buildPctDelta(period?.avgAttendanceChangePct ?? null, true),
        note: '',
      },
    ],
    rows: sortHealthMetricsOverviewBoardRows(rows, 'att-asc'),
  };
}

/** The board table in the picked order; ties fall back to the name, then the row key. */
export function sortHealthMetricsOverviewBoardRows(
  rows: readonly HealthMetricsOverviewBoardRowView[],
  sort: HealthMetricsOverviewBoardSort
): HealthMetricsOverviewBoardRowView[] {
  const byName = (a: HealthMetricsOverviewBoardRowView, b: HealthMetricsOverviewBoardRowView): number =>
    a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  const sign = sort.endsWith('asc') ? 1 : -1;

  return [...rows].sort((a, b) => (sort.startsWith('name') ? sign * byName(a, b) : sign * (a.attendance - b.attendance) || byName(a, b)));
}

/** "Missing a meeting?" goes to PCC's add-past-meeting page for the foundation, by its Salesforce id. */
export function buildHealthMetricsOverviewAddPastMeetingUrl(pccUrl: string, foundationSfid: string | null): string | null {
  return foundationSfid ? `${pccUrl}/project/${encodeURIComponent(foundationSfid)}/collaboration/meetings/manage-meeting?isPast=true` : null;
}

/**
 * One upcoming event's registration trend: its headline figures and the chart's lines on a 600×220 canvas
 * spanning the last 180 days before the event. Either input may be missing, which leaves its parts out.
 */
export function buildHealthMetricsOverviewTrendView(
  row: HealthMetricsOverviewEvent,
  headline: HealthMetricsEventsForecastEvent | null,
  series: HealthMetricsEventsForecastCurveSeries | null
): HealthMetricsOverviewTrendView {
  const goal = headline?.goal ?? row.registrationsGoal;

  return {
    kpis: [
      kpi('current', 'Current', formatCount(headline?.registrationsNow ?? row.registrations)),
      kpi('last-year', 'Same point last year', formatCount(headline?.priorYearSamePoint)),
      kpi('predicted', 'Predicted', formatCount(headline?.forecastAvg ?? null)),
      kpi('goal', 'Registration goal', formatCount(goal)),
      kpi('days-left', 'Days left', formatCount(headline?.daysLeft)),
    ],
    ...buildTrendChart(series, goal),
  };
}

/**
 * One past event's registration history: what it drew against last year's event, with no forecast. Last year's
 * final count adds each format's last day, which the formats share once registration closes.
 */
export function buildHealthMetricsOverviewPastTrendView(
  row: HealthMetricsOverviewEvent,
  curve: HealthMetricsEventsForecastCurve | null,
  series: HealthMetricsEventsForecastCurveSeries | null
): HealthMetricsOverviewTrendView {
  const lastYearFinals = (curve?.formats ?? [])
    .map((format) => [...format.points].reverse().find((point) => point.priorYear !== null)?.priorYear ?? null)
    .filter((value): value is number => value !== null);
  const lastYear = lastYearFinals.length ? lastYearFinals.reduce((sum, value) => sum + value, 0) : null;
  const chart = buildTrendChart(series, row.registrationsGoal);

  return {
    kpis: [
      kpi('current', 'Current', formatCount(row.registrations)),
      kpi('last-year', 'Same point last year', formatCount(lastYear)),
      kpi('final', 'Final', formatCount(row.registrations)),
      kpi('goal', 'Registration goal', formatCount(row.registrationsGoal)),
      kpi('days-left', 'Event held', '0'),
    ],
    ...chart,
    // The event is over, so nothing marks today.
    todayX: null,
  };
}

/** The trend chart's lines and goal; the forecast and its band start at the last measured day, so the lines meet. */
function buildTrendChart(series: HealthMetricsEventsForecastCurveSeries | null, goal: number | null): Omit<HealthMetricsOverviewTrendView, 'kpis'> {
  const window = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
  const points = (series?.points ?? []).filter((point) => point.daysToEvent >= -window && point.daysToEvent <= 0);
  const peak = Math.max(goal ?? 0, ...points.flatMap((point) => [point.actual ?? 0, point.forecastHigh ?? 0, point.forecastAvg ?? 0, point.priorYear ?? 0]));
  const max = peak > 0 ? peak * 1.08 : 1;
  const x = (daysToEvent: number): number => ((window + daysToEvent) / window) * 600;
  const y = (value: number): number => 220 - (value / max) * 220;
  const actual = points.filter((point) => point.actual !== null);
  const lastActual = actual[actual.length - 1] ?? null;
  const forecast = points.filter((point) => point.forecastAvg !== null && (lastActual === null || point.daysToEvent >= lastActual.daysToEvent));
  const band = points.filter(
    (point) => point.forecastLow !== null && point.forecastHigh !== null && (lastActual === null || point.daysToEvent >= lastActual.daysToEvent)
  );
  const path = (coords: [number, number][]): string => coords.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');

  return {
    currentPath: path(actual.map((point) => [x(point.daysToEvent), y(point.actual as number)])),
    lastYearPath: path(points.filter((point) => point.priorYear !== null).map((point) => [x(point.daysToEvent), y(point.priorYear as number)])),
    predictedPath: forecast.length
      ? path([
          ...(lastActual ? ([[x(lastActual.daysToEvent), y(lastActual.actual as number)]] as [number, number][]) : []),
          ...forecast.map((point): [number, number] => [x(point.daysToEvent), y(point.forecastAvg as number)]),
        ])
      : '',
    bandPath: band.length
      ? `${path([
          ...band.map((point): [number, number] => [x(point.daysToEvent), y(point.forecastHigh as number)]),
          ...[...band].reverse().map((point): [number, number] => [x(point.daysToEvent), y(point.forecastLow as number)]),
        ])} Z`
      : '',
    todayX: lastActual ? x(lastActual.daysToEvent).toFixed(1) : null,
    goalY: goal !== null && goal > 0 ? y(goal).toFixed(1) : null,
  };
}

/** "Springfield · Dec 8–10, 2026"; either half drops out when missing. */
export function buildHealthMetricsOverviewEventMeta(event: Pick<HealthMetricsOverviewEvent, 'city' | 'startDate' | 'endDate'>): string {
  return [event.city, formatEventDates(event.startDate, event.endDate)].filter(Boolean).join(' · ');
}

function buildOrgsHalf(
  key: HealthMetricsOverviewOrgsHalfView['key'],
  kpis: HealthMetricsOverviewKpiView[],
  engagementLabel: string,
  split: HealthMetricsOverviewEngagementSplit | null
): HealthMetricsOverviewOrgsHalfView {
  const levels = [
    {
      key: 'high',
      label: 'High',
      count: split?.highCount ?? null,
      stroke: HEALTH_METRICS_OVERVIEW_STROKES.high,
      dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high,
    },
    {
      key: 'medium',
      label: 'Medium',
      count: split?.mediumCount ?? null,
      stroke: HEALTH_METRICS_OVERVIEW_STROKES.medium,
      dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium,
    },
    {
      key: 'low',
      label: 'Low',
      count: split?.lowCount ?? null,
      stroke: HEALTH_METRICS_OVERVIEW_STROKES.low,
      dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low,
    },
  ];
  const total = levels.reduce((sum, level) => sum + (level.count ?? 0), 0);
  const circumference = 2 * Math.PI * 46;
  const donut: HealthMetricsOverviewDonutSegmentView[] = [];
  let offset = 0;

  // Each ring starts a cap's width after the last one ends, so the round caps never touch.
  for (const level of levels) {
    const length = total > 0 ? ((level.count ?? 0) / total) * circumference : 0;
    if (length > 0) {
      donut.push({
        key: level.key,
        stroke: level.stroke,
        dashArray: `${Math.max(length - 10, 0.1).toFixed(2)} ${circumference.toFixed(2)}`,
        dashOffset: (-(offset + 4)).toFixed(2),
      });
    }
    offset += length;
  }

  const link = key === 'members' ? HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.members : HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.nonMembers;
  return {
    key,
    kpis,
    engagementLabel,
    donut,
    lowPctLabel: total > 0 ? formatShare((levels[2].count ?? 0) / total, false) : NOT_AVAILABLE,
    rows: levels.map((level) => ({
      key: level.key,
      label: level.label,
      dotClass: level.dotClass,
      countLabel: formatCount(level.count),
      pctLabel: total > 0 && level.count !== null ? formatShare(level.count / total) : NOT_AVAILABLE,
    })),
    link,
  };
}

/** The design's 240° gauge, split at -50, 0 and 30; each band is trimmed so the round caps leave a gap. */
function buildGaugeSegments(score: number | null): HealthMetricsOverviewGaugeSegmentView[] {
  const bands: [string, number, number, string][] = [
    ['very-low', -100, -50, HEALTH_METRICS_OVERVIEW_STROKES.low],
    ['low', -50, 0, HEALTH_METRICS_OVERVIEW_STROKES.low],
    ['medium', 0, 30, HEALTH_METRICS_OVERVIEW_STROKES.medium],
    ['high', 30, 100, HEALTH_METRICS_OVERVIEW_STROKES.high],
  ];
  const gap = (6.5 * Math.PI) / 180;

  return bands.map(([key, from, to, stroke]) => {
    const start = gaugeAngle(from) - gap;
    const end = gaugeAngle(to) + gap;
    const active = score !== null && score >= from && (score < to || (to === 100 && score <= 100));
    return {
      key,
      stroke,
      opacity: active ? 1 : 0.22,
      path: `M${gaugePoint(start, 52)} A52 52 0 ${start - end > Math.PI ? 1 : 0} 1 ${gaugePoint(end, 52)}`,
    };
  });
}

function gaugeNeedle(score: number): { x: string; y: string } {
  const angle = gaugeAngle(Math.max(-100, Math.min(100, score)));
  return { x: (66 + 38 * Math.cos(angle)).toFixed(1), y: (66 - 38 * Math.sin(angle)).toFixed(1) };
}

/** -100 sits at 210° and 100 at -30°, so the gauge opens downward across 240°. */
function gaugeAngle(value: number): number {
  return ((210 - ((value + 100) / 200) * 240) * Math.PI) / 180;
}

function gaugePoint(angle: number, radius: number): string {
  return `${(66 + radius * Math.cos(angle)).toFixed(1)} ${(66 - radius * Math.sin(angle)).toFixed(1)}`;
}

/** The training arc: 270° clockwise from the lower left, `fraction` of the way round. */
function trainingArcPath(fraction: number): string {
  const start = (225 * Math.PI) / 180;
  const span = (270 * Math.PI) / 180;
  const end = start - span * fraction;
  const point = (angle: number): string => `${(106 + 88 * Math.cos(angle)).toFixed(1)} ${(104 - 88 * Math.sin(angle)).toFixed(1)}`;
  return `M${point(start)} A88 88 0 ${span * fraction > Math.PI ? 1 : 0} 1 ${point(end)}`;
}

/** The bar is blue until the goal is reached, then green. */
function buildSponsorshipView(revenue: number | null, goal: number | null, modelledProgress: number | null): HealthMetricsOverviewEventsView['sponsorship'] {
  const hasGoal = goal !== null && goal > 0;
  const progress = hasGoal ? (modelledProgress ?? (revenue ?? 0) / goal) : 0;
  const remaining = hasGoal ? goal - (revenue ?? 0) : 0;

  return {
    valueLabel: formatMoneyCompact(revenue),
    hasGoal,
    goalLabel: hasGoal ? formatCurrency(goal) : '',
    widthPct: clampPct(progress * 100),
    barClass: progress >= 1 ? HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high : HEALTH_METRICS_OVERVIEW_FILL_CLASSES.blue,
    progressLabel: hasGoal ? `${formatShare(progress, false)} reached · ${remainingLabel(remaining)}` : 'No goal set',
  };
}

function buildEventRow(event: HealthMetricsOverviewEvent, isPast: boolean): HealthMetricsOverviewEventRowView {
  const accepted = event.acceptedTalks ?? 0;
  const proposals = event.totalProposals ?? 0;

  return {
    eventId: event.eventId,
    name: event.eventName,
    meta: buildHealthMetricsOverviewEventMeta(event),
    isPast,
    registrations: buildRegistrationsBar(event, isPast),
    talks: {
      hasProposals: proposals > 0,
      countLabel: formatCount(accepted),
      sideLabel: `of ${formatCount(proposals)}${isPast ? ' submitted' : ''}`,
      widthPct: proposals > 0 ? clampPct((accepted / proposals) * 100) : 0,
      // No rule colors upcoming proposals yet, so they stay blue; past ones are green, as the design draws them.
      barClass: isPast ? HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high : HEALTH_METRICS_OVERVIEW_FILL_CLASSES.blue,
      note: event.cfpStatus?.toLowerCase() === 'in review' ? 'CFP in review' : 'No call for proposals',
    },
  };
}

/**
 * Without a goal the bar is full and green; otherwise upcoming events take their pace and past ones their share of
 * the goal. An unmeasured count draws a grey bar with no status, so it never reads as missed.
 */
function buildRegistrationsBar(event: HealthMetricsOverviewEvent, isPast: boolean): HealthMetricsOverviewEventRegistrationsView {
  const goal = event.registrationsGoal;
  const countLabel = formatCount(event.registrations);
  if (goal === null || goal <= 0) return { countLabel, sideLabel: 'No goal set', widthPct: 100, ...statusFields(HEALTH_METRICS_OVERVIEW_EVENT_STATUS.onTrack) };
  if (event.registrations === null) {
    return { countLabel, sideLabel: `of ${formatCount(goal)}`, widthPct: 0, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.muted, statusLabel: null };
  }

  const share = event.registrations / goal;
  return {
    countLabel,
    sideLabel: `of ${formatCount(goal)}`,
    widthPct: clampPct(share * 100),
    ...statusFields(isPast ? goalShareStatus(share) : paceStatus(event.compScore)),
  };
}

function statusFields(status: { label: string; fillClass: string } | null): Pick<HealthMetricsOverviewEventRegistrationsView, 'barClass' | 'statusLabel'> {
  return status ? { barClass: status.fillClass, statusLabel: status.label } : { barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.blue, statusLabel: null };
}

function paceStatus(compScore: string | null): { label: string; fillClass: string } | null {
  return compScore && compScore in HEALTH_METRICS_OVERVIEW_EVENT_PACE
    ? HEALTH_METRICS_OVERVIEW_EVENT_PACE[compScore as keyof typeof HEALTH_METRICS_OVERVIEW_EVENT_PACE]
    : null;
}

function goalShareStatus(share: number): { label: string; fillClass: string } {
  if (share >= HEALTH_METRICS_OVERVIEW_EVENT_GOAL_SHARES.onTrack) return HEALTH_METRICS_OVERVIEW_EVENT_STATUS.onTrack;
  if (share >= HEALTH_METRICS_OVERVIEW_EVENT_GOAL_SHARES.atRisk) return HEALTH_METRICS_OVERVIEW_EVENT_STATUS.atRisk;
  return HEALTH_METRICS_OVERVIEW_EVENT_STATUS.action;
}

/** "Dec 15, 2026", "Dec 8–10, 2026", "Nov 30 – Dec 2, 2026" or "Dec 30, 2026 – Jan 2, 2027". */
function formatEventDates(start: string | null, end: string | null): string {
  if (!start) return '';
  if (!end || end <= start) return formatIsoDateLabel(start);

  const [startYear, startMonth] = start.split('-');
  const [endYear, endMonth] = end.split('-');
  const monthDay = (iso: string): string => formatIsoDateLabel(iso).replace(/, \d{4}$/, '');
  if (startYear !== endYear) return `${formatIsoDateLabel(start)} – ${formatIsoDateLabel(end)}`;
  if (startMonth !== endMonth) return `${monthDay(start)} – ${monthDay(end)}, ${endYear}`;
  return `${monthDay(start)}–${Number(end.slice(8, 10))}, ${endYear}`;
}

/** The year's goal and its modelled progress, which the view carries for YTD only. */
function trainingGoal(
  enrollment: HealthMetricsTrainingEnrollment,
  range: HealthMetricsRange,
  isRevenue: boolean
): { goal: number | null; progress: number | null } {
  if (range !== 'YTD') return { goal: null, progress: null };
  if (isRevenue) return { goal: enrollment.goals.revenueUsd, progress: enrollment.goals.revenueUsd ? enrollment.goals.revenueProgressYtd : null };
  return { goal: enrollment.goals.enrollments, progress: enrollment.goals.enrollments ? enrollment.goals.enrollmentsProgressYtd : null };
}

function formatTrainingValue(value: number | null, isRevenue: boolean): string {
  if (value === null) return NOT_AVAILABLE;
  return isRevenue ? formatCurrency(value) : formatNumber(value);
}

/** Green at the design's good line, amber above none, red at none. */
function attendanceFill(share: number): string {
  if (share >= HEALTH_METRICS_OVERVIEW_BOARD_GOOD_ATTENDANCE) return HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high;
  if (share > 0) return HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium;
  return HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low;
}

function remainingLabel(remaining: number): string {
  return remaining > 0 ? `${formatCurrency(remaining)} to goal` : 'goal met';
}

function kpi(key: string, label: string, value: string): HealthMetricsOverviewKpiView {
  return { key, label, value, delta: null, note: '' };
}

/** A relative change (a fraction) as a whole percentage; `null` and a change that rounds to zero draw none. */
function buildPctDelta(change: number | null, higherIsGood: boolean, suffix = ''): HealthMetricsOverviewDelta | null {
  const rounded = change === null ? 0 : Math.round(Math.abs(change) * 100);
  if (change === null || rounded === 0) return null;
  return { label: `${rounded}%${suffix}`, direction: change > 0 ? 'up' : 'down', good: change > 0 === higherIsGood };
}

/** The score's change since the previous survey wave, named when the view has it. */
function buildNpsDelta(change: number | null, previousQuarter: string | null): HealthMetricsOverviewDelta | null {
  const points = buildPointsDelta(change, true);
  if (!points) return null;
  return previousQuarter ? { ...points, label: `${points.label} vs ${previousQuarter}` } : points;
}

function formatMembers(count: number | null): string {
  if (count === null) return NOT_AVAILABLE;
  return `${formatCount(count)} ${count === 1 ? 'member' : 'members'}`;
}

/** A change in percentage points, e.g. "1 pt". */
function buildPointsDelta(change: number | null, higherIsGood: boolean): HealthMetricsOverviewDelta | null {
  const rounded = change === null ? 0 : Math.round(Math.abs(change));
  if (change === null || rounded === 0) return null;
  return { label: `${rounded} ${rounded === 1 ? 'pt' : 'pts'}`, direction: change > 0 ? 'up' : 'down', good: change > 0 === higherIsGood };
}

function buildInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_AVAILABLE : Math.round(value).toLocaleString('en-US');
}

function formatCompact(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_AVAILABLE : formatNumber(value);
}

function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_AVAILABLE : `$${Math.round(value).toLocaleString('en-US')}`;
}

function formatMoneyCompact(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_AVAILABLE : formatCurrency(value);
}

/** A rate the view already carries as a percentage (0–100). */
function formatRatePct(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_AVAILABLE : `${Math.round(value)}%`;
}

/** A 0–1 share as a whole percentage; a share under half a percent reads "<1%" unless `allowLessThanOne` is off. */
function formatShare(value: number | null, allowLessThanOne = true): string {
  if (value === null || !Number.isFinite(value)) return NOT_AVAILABLE;
  const pct = value * 100;
  return allowLessThanOne && pct > 0 && pct < 0.5 ? '<1%' : `${Math.round(pct)}%`;
}

function clampPct(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}
