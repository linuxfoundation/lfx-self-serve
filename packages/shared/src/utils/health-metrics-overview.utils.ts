// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_OVERVIEW_BLANK_COPY,
  HEALTH_METRICS_OVERVIEW_BOARD_GOOD_ATTENDANCE,
  HEALTH_METRICS_OVERVIEW_EVENT_DIALOG_FADE_PX,
  HEALTH_METRICS_OVERVIEW_EVENT_GOAL_SHARES,
  HEALTH_METRICS_OVERVIEW_EVENT_PACE,
  HEALTH_METRICS_OVERVIEW_EVENT_STATUS,
  HEALTH_METRICS_OVERVIEW_EVENTS_INFO,
  HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS,
  HEALTH_METRICS_OVERVIEW_FILL_CLASSES,
  HEALTH_METRICS_OVERVIEW_GAUGE_TINT,
  HEALTH_METRICS_OVERVIEW_KPI_MIN_HALF_WIDTH_PX,
  HEALTH_METRICS_OVERVIEW_KPI_MIN_ITEM_WIDTH_PX,
  HEALTH_METRICS_OVERVIEW_NEWSLETTER_ENGAGEMENT,
  HEALTH_METRICS_OVERVIEW_NPS_AUDIENCE,
  HEALTH_METRICS_OVERVIEW_ORGS_KPI_TIPS,
  HEALTH_METRICS_OVERVIEW_SNAPSHOT_COPY,
  HEALTH_METRICS_OVERVIEW_STROKES,
  HEALTH_METRICS_OVERVIEW_TREND_MIN_SPAN_DAYS,
  HEALTH_METRICS_OVERVIEW_TREND_PREDICTED_TIP,
  HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS,
} from '../constants/health-metrics-overview.constants';
import { HEALTH_METRICS_EVENTS_SNAPSHOT_PERIODS } from '../constants/health-metrics-events.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
import { formatIsoDateLabel, parseIsoDateAsUtcMidnight } from './date-time.utils';
import { getHealthMetricsTrainingDeliveryTypeLabel } from './health-metrics-training.utils';
import { formatCurrency, formatNumber } from './number.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type {
  HealthMetricsEventsAtAGlance,
  HealthMetricsEventsForecastCurve,
  HealthMetricsEventsForecastCurvePoint,
  HealthMetricsEventsForecastCurveSeries,
  HealthMetricsEventsForecastEvent,
  HealthMetricsEventsSnapshot,
  HealthMetricsEventsSnapshotPeriod,
  HealthMetricsEventsSnapshotWeek,
  HealthMetricsEventsSponsorship,
} from '../interfaces/health-metrics-events.interface';
import type { HealthMetricsBlankCopy, HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';
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
  HealthMetricsOverviewEmptyCopy,
  HealthMetricsOverviewEmptyStateCopy,
  HealthMetricsOverviewEngagementSplit,
  HealthMetricsOverviewEvent,
  HealthMetricsOverviewEventDialogBadgeView,
  HealthMetricsOverviewEventDialogBadgesView,
  HealthMetricsOverviewEventGaugeView,
  HealthMetricsOverviewEventStatus,
  HealthMetricsOverviewEventRegistrationsView,
  HealthMetricsOverviewEventRowView,
  HealthMetricsOverviewEvents,
  HealthMetricsOverviewEventsView,
  HealthMetricsOverviewGaugeCapView,
  HealthMetricsOverviewKpiStripLayout,
  HealthMetricsOverviewKpiView,
  HealthMetricsOverviewNewsletterChartView,
  HealthMetricsOverviewNewsletterEngagementRowView,
  HealthMetricsOverviewNewsletterPeriod,
  HealthMetricsOverviewNewsletterPointView,
  HealthMetricsOverviewNewsletters,
  HealthMetricsOverviewNewsletterView,
  HealthMetricsOverviewNps,
  HealthMetricsOverviewNpsView,
  HealthMetricsOverviewOrgsHalfView,
  HealthMetricsOverviewOutstandingBalance,
  HealthMetricsOverviewParticipatingOrgs,
  HealthMetricsOverviewParticipatingOrgsView,
  HealthMetricsOverviewSnapshotChangeView,
  HealthMetricsOverviewSnapshotRowView,
  HealthMetricsOverviewSnapshotSectionView,
  HealthMetricsOverviewTrainingMetric,
  HealthMetricsOverviewTrainingView,
  HealthMetricsOverviewTrendKpiView,
  HealthMetricsOverviewTrendNavigatorView,
  HealthMetricsOverviewTrendView,
  HealthMetricsOverviewTrendWindow,
} from '../interfaces/health-metrics-overview.interface';
import type { HealthMetricsTrainingEnrollment } from '../interfaces/health-metrics-training.interface';

const NOT_AVAILABLE = '—';

/** A ring with no status draws blue, as the bar does. */
const ACCENT_GAUGE: HealthMetricsOverviewEventGaugeView = { tone: 'accent', level: null, empty: false, unmeasured: false };

/** The page header's year-to-date span, e.g. "Jan 1 – Oct 22, 2026", shown beside the YTD period. */
export function buildHealthMetricsYtdRangeLabel(today: Date): string {
  const end = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Jan 1 – ${end}, ${today.getFullYear()}`;
}

/** The selected period as one the Overview views carry columns for; `null` for any other. */
export function toHealthMetricsOverviewRange(range: HealthMetricsRange): HealthMetricsL2Range | null {
  return (HEALTH_METRICS_L2_RANGES as readonly HealthMetricsRange[]).includes(range) ? (range as HealthMetricsL2Range) : null;
}

/** The past year a period stands for, or `null` for YTD, whose empty states speak of "so far". */
export function toHealthMetricsOverviewPastYear(range: HealthMetricsRange): number | null {
  return range === 'YTD' ? null : getYearForRange(range);
}

/** A card's empty state for the period: the YTD words, or a past year's with `{Y}` filled in when the card has them. */
export function buildHealthMetricsOverviewEmptyCopy(copy: HealthMetricsOverviewEmptyStateCopy, pastYear: number | null): HealthMetricsOverviewEmptyCopy {
  const period = pastYear === null || !copy.past ? copy.ytd : copy.past;
  const fill = withYear(pastYear);
  return { icon: copy.icon, title: fill(period.title), text: fill(period.text), reasons: period.reasons.map(fill) };
}

/** The whole-foundation empty state for the period. */
export function buildHealthMetricsOverviewBlankCopy(pastYear: number | null): HealthMetricsBlankCopy {
  const copy = pastYear === null ? HEALTH_METRICS_OVERVIEW_BLANK_COPY.ytd : HEALTH_METRICS_OVERVIEW_BLANK_COPY.past;
  const fill = withYear(pastYear);
  return { title: fill(copy.title), lead: fill(copy.lead), reasons: copy.reasons.map(fill) };
}

function withYear(pastYear: number | null): (text: string) => string {
  return (text) => text.replace(/\{Y\}/g, String(pastYear ?? ''));
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
        [
          { ...kpi('active', 'Active members', formatCount(period?.activeMembers)), tip: HEALTH_METRICS_OVERVIEW_ORGS_KPI_TIPS.active },
          { ...kpi('new', 'New members', formatCount(period?.newMembers)), tip: HEALTH_METRICS_OVERVIEW_ORGS_KPI_TIPS.new },
        ],
        'Member engagement',
        period?.memberEngagement ?? null
      ),
      buildOrgsHalf(
        'non-members',
        [
          { ...kpi('non-members', 'Non-members', formatCount(period?.nonMembers)), tip: HEALTH_METRICS_OVERVIEW_ORGS_KPI_TIPS.nonMembers },
          { ...kpi('non-renewals', 'Non-renewals', formatCount(period?.nonRenewals)), tip: HEALTH_METRICS_OVERVIEW_ORGS_KPI_TIPS.nonRenewals },
        ],
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
    meta: [
      { label: 'Latest NPS:', value: period?.lastUpdatedQuarter ?? NOT_AVAILABLE },
      { label: 'Audience:', value: HEALTH_METRICS_OVERVIEW_NPS_AUDIENCE },
      { label: 'Responses:', value: `${formatCount(responses)} of ${formatCount(period?.recipientsCount)} (${formatShare(period?.responseRatePct ?? null)})` },
    ],
    scoreLabel: score === null ? NOT_AVAILABLE : String(Math.round(score)),
    delta: buildNpsDelta(period?.scoreChangePp ?? null, period?.previousSurveyQuarter ?? null),
    ...buildGauge(score),
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

/** The newsletter card: the period's summary, the open and click rate of each newsletter sent in it, and the subscriber engagement split. */
export function buildHealthMetricsOverviewNewsletterView(
  newsletters: HealthMetricsOverviewNewsletters,
  range: HealthMetricsRange
): HealthMetricsOverviewNewsletterView {
  const l2 = toHealthMetricsOverviewRange(range);
  const period = l2 ? newsletters.periods[l2] : null;
  const considered = period?.newslettersConsidered ?? null;

  return {
    isEmpty: !newsletters.measured || !period?.newslettersSent,
    kpis: [
      {
        ...kpi('subscribers', 'Subscribers', formatCount(period?.subscribers)),
        delta: buildPctDelta(
          period?.subscribersGrowth ?? null,
          true,
          formatHealthMetricsNewsletterGrowthSince(period?.growthBaselineDate ?? null, getYearForRange(range))
        ),
      },
      kpi('sent', 'Newsletters sent', formatCount(period?.newslettersSent)),
      kpi('open', 'Avg. open rate', formatShare(period?.avgOpenRate ?? null, false)),
      kpi('cto', 'Avg. click-to-open rate', formatShare(period?.avgClickToOpenRate ?? null, false)),
    ],
    chart: buildNewsletterChart(newsletters, getYearForRange(range)),
    engagementBasis:
      considered && considered > 0
        ? `Based on opens and clicks across the last ${considered === 1 ? 'newsletter' : `${formatCount(considered)} newsletters`}`
        : '',
    engagement: buildNewsletterEngagement(period),
    mostEngaging: period?.mostEngagingName
      ? { name: period.mostEngagingName, rateLabel: `${formatShare(period.mostEngagingClickToOpenRate, false)} click-to-open` }
      : null,
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

/** The event dialog body's mask: it fades out over 32px at each edge with more to scroll, and not at all otherwise. */
export function buildHealthMetricsOverviewScrollFadeMask(fadeTop: boolean, fadeBottom: boolean): string {
  const top = fadeTop ? HEALTH_METRICS_OVERVIEW_EVENT_DIALOG_FADE_PX : 0;
  const bottom = fadeBottom ? HEALTH_METRICS_OVERVIEW_EVENT_DIALOG_FADE_PX : 0;
  return `linear-gradient(to bottom, transparent 0, black ${top}px, black calc(100% - ${bottom}px), transparent 100%)`;
}

/**
 * One upcoming event's registration trend: its headline figures and the chart on a 600×220 canvas spanning the last
 * 180 days before the event. Either input may be missing, which leaves its parts out.
 */
export function buildHealthMetricsOverviewTrendView(
  row: HealthMetricsOverviewEvent,
  headline: HealthMetricsEventsForecastEvent | null,
  series: HealthMetricsEventsForecastCurveSeries | null,
  window: HealthMetricsOverviewTrendWindow | null = null
): HealthMetricsOverviewTrendView {
  const goal = headline?.goal ?? row.registrationsGoal;
  const high = headline?.forecastHigh ?? null;
  const low = headline?.forecastLow ?? null;

  return {
    kpis: [
      trendKpi('current', 'Current', formatCount(headline?.registrationsNow ?? row.registrations)),
      trendKpi('last-year', 'Same point last year', formatCount(headline?.priorYearSamePoint)),
      {
        ...trendKpi('predicted', 'Predicted', formatCount(headline?.forecastAvg ?? null)),
        range: high !== null && low !== null ? { high: formatCount(high), low: formatCount(low) } : null,
        tip: HEALTH_METRICS_OVERVIEW_TREND_PREDICTED_TIP,
      },
    ],
    ...buildTrendChart(series, goal, window, false),
  };
}

/**
 * One past event's registration history: what it drew against last year's event, with no forecast. Last year's
 * final count adds each format's last day, which the formats share once registration closes.
 */
export function buildHealthMetricsOverviewPastTrendView(
  row: HealthMetricsOverviewEvent,
  curve: HealthMetricsEventsForecastCurve | null,
  series: HealthMetricsEventsForecastCurveSeries | null,
  window: HealthMetricsOverviewTrendWindow | null = null
): HealthMetricsOverviewTrendView {
  const lastYearFinals = (curve?.formats ?? [])
    .map((format) => [...format.points].reverse().find((point) => point.priorYear !== null)?.priorYear ?? null)
    .filter((value): value is number => value !== null);
  const lastYear = lastYearFinals.length ? lastYearFinals.reduce((sum, value) => sum + value, 0) : null;

  return {
    kpis: [
      trendKpi('current', 'Current', formatCount(row.registrations)),
      trendKpi('last-year', 'Same point last year', formatCount(lastYear)),
      trendKpi('final', 'Final', formatCount(row.registrations)),
    ],
    // The event is over, so nothing is predicted and nothing marks today.
    ...buildTrendChart(series, row.registrationsGoal, window, true),
  };
}

/**
 * The event dialog's header badges: the goal as an outlined success badge, or a quiet one when no goal is set, and the
 * days left, or "Event held". An upcoming event's days left wait for its forecast read.
 */
export function buildHealthMetricsOverviewEventDialogBadges(
  row: HealthMetricsOverviewEvent,
  isPast: boolean,
  headline: HealthMetricsEventsForecastEvent | null
): HealthMetricsOverviewEventDialogBadgesView {
  const goal = headline?.goal ?? row.registrationsGoal;
  const daysLeft = headline?.daysLeft ?? null;
  const goalIcon = 'fa-light fa-bullseye-arrow';
  const daysIcon = 'fa-light fa-calendar';

  return {
    goal: goal
      ? { label: `Registration goal: ${formatCount(goal)}`, icon: goalIcon, variant: 'line', tone: 'success' }
      : { label: 'No registration goal', icon: goalIcon, variant: 'subtle', tone: 'neutral' },
    days: daysBadge(isPast, daysLeft, daysIcon),
  };
}

/**
 * The Snapshot tab's two tables for one period. Every figure runs through yesterday, which the end column dates and
 * the design calls "today". Registrations come in ISO weeks, so their window starts on the Sunday before the first
 * week the period touches; packages and sponsorship revenue are rolling, so theirs starts the period's days back.
 */
export function buildHealthMetricsOverviewSnapshotView(
  snapshot: HealthMetricsEventsSnapshot,
  period: HealthMetricsEventsSnapshotPeriod
): HealthMetricsOverviewSnapshotSectionView[] {
  const days = HEALTH_METRICS_EVENTS_SNAPSHOT_PERIODS.find((option) => option.value === period)?.days ?? 7;
  const today = snapshot.today;
  const endHeader = today ? `${formatIsoDateLabel(shiftIsoDate(today, -1))} (today)` : '';
  const endHeaderShort = today ? `${formatIsoShortYearDate(shiftIsoDate(today, -1))} (today)` : '';
  const rollingStart = today ? shiftIsoDate(today, -days) : '';
  const rollingStartHeader = rollingStart ? formatIsoDateLabel(rollingStart) : '';

  const { weeks } = snapshot;
  const firstIndex = weeks.findIndex((week) => week.inPeriod[period]);
  const first = firstIndex >= 0 ? weeks[firstIndex] : null;
  const before = firstIndex > 0 ? weeks[firstIndex - 1] : null;
  const registrationStart = first ? shiftIsoDate(first.weekStartDate, -1) : rollingStart;
  const latest = weeks.at(-1) ?? null;
  const weekly = (level: (week: HealthMetricsEventsSnapshotWeek) => number, delta: (week: HealthMetricsEventsSnapshotWeek) => number) => {
    const end = latest ? level(latest) : 0;
    return { start: weeklyStart(first, before, latest, level, delta, end), end };
  };
  const registrations = weekly(
    (week) => week.registrations,
    (week) => week.registrationsDelta
  );
  const registrationRevenue = weekly(
    (week) => week.registrationRevenueUsd,
    (week) => week.registrationRevenueDeltaUsd
  );

  const packages = snapshot.packages.map((item) => ({ key: item.tier, start: item.sold - item.soldInPeriod[period], end: item.sold }));
  const totals = packages.reduce((sum, item) => ({ start: sum.start + item.start, end: sum.end + item.end }), { start: 0, end: 0 });
  const sponsorshipRevenue = { start: snapshot.sponsorshipRevenueUsd - snapshot.sponsorshipRevenueInPeriodUsd[period], end: snapshot.sponsorshipRevenueUsd };

  return [
    {
      key: 'registration',
      title: 'Registration',
      startHeader: registrationStart ? formatIsoDateLabel(registrationStart) : '',
      startHeaderShort: registrationStart ? formatIsoShortYearDate(registrationStart) : '',
      endHeader,
      endHeaderShort,
      rows: [
        snapshotRow('registrations', 'Registrations', registrations, formatCount),
        snapshotRow(
          'registration-revenue',
          'Registration revenue',
          registrationRevenue,
          formatDollars,
          HEALTH_METRICS_OVERVIEW_SNAPSHOT_COPY.registrationRevenueTip
        ),
      ],
      emptyCopy: null,
    },
    {
      key: 'sponsorship',
      title: 'Sponsorship',
      startHeader: rollingStartHeader,
      startHeaderShort: rollingStart ? formatIsoShortYearDate(rollingStart) : '',
      endHeader,
      endHeaderShort,
      rows: [
        ...packages.map((item) => snapshotRow(`package-${item.key}`, item.key, item, formatCount)),
        ...(packages.length ? [{ ...snapshotRow('totals', 'Totals', totals, formatCount), totals: true }] : []),
        snapshotRow(
          'sponsorship-revenue',
          'Sponsorship revenue',
          sponsorshipRevenue,
          formatDollars,
          HEALTH_METRICS_OVERVIEW_SNAPSHOT_COPY.sponsorshipRevenueTip
        ),
      ],
      emptyCopy: packages.length ? null : HEALTH_METRICS_OVERVIEW_SNAPSHOT_COPY.noPackages,
    },
  ];
}

/** "Springfield · Starts Dec 8, 2026", the dialog's line under the event name; either half drops out when missing. */
export function buildHealthMetricsOverviewTrendMeta(event: Pick<HealthMetricsOverviewEvent, 'city' | 'startDate'>): string {
  return [event.city, event.startDate ? `Starts ${formatIsoDateLabel(event.startDate)}` : ''].filter(Boolean).join(' · ');
}

function trendKpi(key: string, label: string, value: string): HealthMetricsOverviewTrendKpiView {
  return { key, label, value, range: null, tip: null };
}

/**
 * The trend chart over the visible span of the last 180 days, as the design draws it. It opens on a best fit (see
 * `fitTrendWindow`) and the reader can move it. The y scale fits the visible lines in at most 5 even steps (1, 2,
 * 2.5 or 5 times a power of ten), with the goal on it only when it sits near them. The prediction, its band and the
 * Today marker start at the last measured day; a past event has none of them.
 */
function buildTrendChart(
  series: HealthMetricsEventsForecastCurveSeries | null,
  goal: number | null,
  requested: HealthMetricsOverviewTrendWindow | null,
  isPast: boolean
): Omit<HealthMetricsOverviewTrendView, 'kpis'> {
  const days = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
  const line = trendLines(series, isPast);
  const fitWindow = fitTrendWindow(line);
  const visible = clampTrendWindow(requested ?? fitWindow);
  const { start, end } = visible;
  const span = end - start;

  const visiblePeak = Math.max(1, ...range(start, end).map((index) => line.peak(index)));
  const goalShown = goal !== null && goal > 0 && goal <= visiblePeak * 1.35;
  const { step, steps } = trendScale(Math.max(visiblePeak * 1.06, goalShown ? (goal as number) * 1.05 : 0));
  const max = step * steps;
  const x = (index: number): number => ((index - start) / span) * 600;
  const y = (value: number): number => 220 - (value / max) * 220;
  const plot = (values: (number | null)[], from: number, to: number): [number, number][] =>
    range(Math.max(from, start), Math.min(to, end))
      .filter((index) => values[index] !== null)
      .map((index): [number, number] => [x(index), y(values[index] as number)]);

  // With no measured day in the window the forecast still draws, from wherever it starts.
  const forecastFrom = line.now ?? 0;
  const showForecast = !isPast && forecastFrom <= end;
  const highs = showForecast ? plot(line.high, forecastFrom, days) : [];
  const lows = showForecast ? plot(line.low, forecastFrom, days) : [];
  const gapEnd = line.now === null ? -1 : Math.min(line.now, end);
  // Each fill keeps to its side by adding the point where the lines cross between two days.
  const gap = (top: (current: number, prior: number) => number, bottom: (current: number, prior: number) => number): string => {
    const indexes = range(start, gapEnd).filter((index) => line.actual[index] !== null && line.prior[index] !== null);
    if (indexes.length < 2) return '';
    const samples = indexes.flatMap((index, at): [number, number, number][] => {
      const current = line.actual[index] as number;
      const prior = line.prior[index] as number;
      const next = indexes[at + 1];
      if (next === undefined) return [[index, current, prior]];
      const ahead = current - prior;
      const nextAhead = (line.actual[next] as number) - (line.prior[next] as number);
      if (ahead * nextAhead >= 0) return [[index, current, prior]];
      const share = ahead / (ahead - nextAhead);
      const crossing = current + share * ((line.actual[next] as number) - current);
      return [
        [index, current, prior],
        [index + share * (next - index), crossing, crossing],
      ];
    });
    const upper = samples.map(([day, current, prior]): [number, number] => [x(day), y(top(current, prior))]);
    const lower = [...samples].reverse().map(([day, current, prior]): [number, number] => [x(day), y(bottom(current, prior))]);
    return `${svgPath([...upper, ...lower])} Z`;
  };
  const todayShown = !isPast && line.now !== null && line.now >= start && line.now <= end;
  const tickStep = trendTickStep(span);
  // Ticks count days to the event, on multiples of the step, from the nearest one inside the span's right edge.
  const firstTick = Math.ceil((days - end) / tickStep) * tickStep;
  const goalY = goalShown ? y(goal as number) : null;

  return {
    currentPath: svgPath(plot(line.actual, 0, line.now ?? -1)),
    lastYearPath: svgPath(plot(line.prior, 0, days)),
    predictedPath: showForecast ? svgPath(plot(line.predicted, forecastFrom, days)) : '',
    bandPath: highs.length > 1 ? `${svgPath([...highs, ...[...lows].reverse()])} Z` : '',
    bandHighPath: highs.length > 1 ? svgPath(highs) : '',
    bandLowPath: lows.length > 1 ? svgPath(lows) : '',
    aheadPath: gap(Math.max, (_current, prior) => prior),
    behindPath: gap((_current, prior) => prior, Math.min),
    todayX: todayShown ? x(line.now as number).toFixed(1) : null,
    todayPct: todayShown ? ((x(line.now as number) / 600) * 100).toFixed(2) : null,
    goalY: goalY === null ? null : goalY.toFixed(1),
    goalPct: goalY === null ? null : ((goalY / 220) * 100).toFixed(2),
    goalLabel: goalShown ? `Registration goal: ${formatCount(goal)}` : null,
    yTicks: Array.from({ length: steps + 1 }, (_, index) => steps - index).map((tick) => ({
      label: formatCount(step * tick),
      pct: (100 - (tick / steps) * 100).toFixed(2),
      y: (220 - (tick / steps) * 220).toFixed(1),
    })),
    xTicks: range(0, Math.floor((days - start - firstTick) / tickStep))
      .map((index) => firstTick + index * tickStep)
      .map((daysOut) => ({ label: String(daysOut), pct: ((x(days - daysOut) / 600) * 100).toFixed(2) })),
    window: visible,
    fitWindow,
    navigator: buildTrendNavigator(line, visible, isPast),
  };
}

/** One series' days as arrays indexed 0 (180 days out) to 180 (the event day), joined across the days between reads, with the last measured day as `now`. */
interface TrendLines {
  actual: (number | null)[];
  prior: (number | null)[];
  /** The prediction, the band's highs and its lows, each starting at the last measured day's count, or as read with none. */
  predicted: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  now: number | null;
  /** The highest value any line reaches on a day. */
  peak: (index: number) => number;
}

function trendLines(series: HealthMetricsEventsForecastCurveSeries | null, isPast: boolean): TrendLines {
  const days = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
  const points = (series?.points ?? []).filter((point) => point.daysToEvent >= -days && point.daysToEvent <= 0);
  const byDay = (pick: (point: HealthMetricsEventsForecastCurvePoint) => number | null): (number | null)[] => {
    const values: (number | null)[] = Array.from({ length: days + 1 }, () => null);
    for (const point of points) values[days + point.daysToEvent] = pick(point);
    return values;
  };
  const measuredDays = byDay((point) => point.actual);
  const actual = fillTrendGaps(measuredDays);
  const measured = measuredDays.map((value, index) => (value === null ? -1 : index)).filter((index) => index >= 0);
  const now = measured.length ? measured[measured.length - 1] : null;
  const fromNow = (pick: (point: HealthMetricsEventsForecastCurvePoint) => number | null): (number | null)[] =>
    byDay(pick).map((value, index) => {
      if (isPast) return null;
      if (now === null) return value;
      if (index < now) return null;
      return index === now ? actual[now] : value;
    });
  const prior = fillTrendGaps(byDay((point) => point.priorYear));
  const predicted = fillTrendGaps(fromNow((point) => point.forecastAvg));
  const high = fillTrendGaps(fromNow((point) => point.forecastHigh));
  const low = fillTrendGaps(fromNow((point) => point.forecastLow));

  return {
    actual,
    prior,
    predicted,
    high,
    low,
    now,
    peak: (index) => Math.max(actual[index] ?? 0, prior[index] ?? 0, predicted[index] ?? 0, high[index] ?? 0),
  };
}

/**
 * A line's read days joined by straight segments, so every day between two of them has its value: a span that falls
 * between read days still draws the line to its edges and scales to it. Nothing is added before the first or after the last.
 */
function fillTrendGaps(values: (number | null)[]): (number | null)[] {
  const read = values.map((value, index) => (value === null ? -1 : index)).filter((index) => index >= 0);
  const filled = [...values];
  read.slice(1).forEach((to, at) => {
    const from = read[at];
    const first = values[from] as number;
    const last = values[to] as number;
    for (let index = from + 1; index < to; index++) filled[index] = first + ((last - first) * (index - from)) / (to - from);
  });
  return filled;
}

/**
 * The design's best fit: from where registrations become meaningful (2% of the larger final, this year's or last
 * year's), padded by 12% of the remaining span and snapped to a tick, to the event day; never so late that fewer than
 * 14 days before today, or 21 days in all, show.
 */
function fitTrendWindow(line: TrendLines): HealthMetricsOverviewTrendWindow {
  const days = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
  const lastValue = (values: (number | null)[]): number => [...values].reverse().find((value) => value !== null) ?? 0;
  const final = Math.max(lastValue(line.predicted), lastValue(line.actual), lastValue(line.prior));
  const meaningful = range(0, days).find((index) => line.peak(index) >= final * 0.02) ?? 0;
  const span = days - meaningful;
  const pad = Math.max(5, Math.round(span * 0.12));
  const snap = trendSnapStep(span);
  const start = Math.max(0, Math.floor((meaningful - pad) / snap) * snap);
  return { start: Math.min(start, Math.max(0, (line.now ?? days) - 14), days - 21), end: days };
}

function trendSnapStep(span: number): number {
  if (span > 120) return 30;
  if (span > 60) return 10;
  return 5;
}

function trendTickStep(span: number): number {
  if (span <= 40) return 5;
  if (span <= 80) return 10;
  if (span <= 150) return 20;
  return 30;
}

/** A window kept on the chart and at least the minimum span wide. */
function clampTrendWindow(requested: HealthMetricsOverviewTrendWindow): HealthMetricsOverviewTrendWindow {
  const days = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
  const minSpan = HEALTH_METRICS_OVERVIEW_TREND_MIN_SPAN_DAYS;
  const start = Math.max(0, Math.min(Math.round(requested.start), days - minSpan));
  return { start, end: Math.min(days, Math.max(Math.round(requested.end), start + minSpan)) };
}

/** The whole window's lines on their own 600×44 scale, and the visible span picked out over them. */
function buildTrendNavigator(line: TrendLines, visible: HealthMetricsOverviewTrendWindow, isPast: boolean): HealthMetricsOverviewTrendNavigatorView {
  const days = HEALTH_METRICS_OVERVIEW_TREND_WINDOW_DAYS;
  const top = Math.max(1, ...range(0, days).map((index) => line.peak(index))) * 1.05;
  const plot = (values: (number | null)[]): [number, number][] =>
    range(0, days)
      .filter((index) => values[index] !== null)
      .map((index): [number, number] => [(index / days) * 600, 40 - ((values[index] as number) / top) * 36]);
  const current = plot(line.actual);
  const first = current[0];
  const last = current[current.length - 1];

  return {
    currentPath: svgPath(current),
    currentAreaPath: first && last ? `${svgPath(current)} L${last[0].toFixed(1)} 40 L${first[0].toFixed(1)} 40 Z` : '',
    lastYearPath: svgPath(plot(line.prior)),
    predictedPath: isPast ? '' : svgPath(plot(line.predicted)),
    selectionLeftPct: ((visible.start / days) * 100).toFixed(2),
    selectionWidthPct: (((visible.end - visible.start) / days) * 100).toFixed(2),
    dimRightPct: (((days - visible.end) / days) * 100).toFixed(2),
    ticks: range(0, Math.floor(days / 30))
      .map((index) => days - index * 30)
      .map((daysOut) => ({ label: String(daysOut), pct: (((days - daysOut) / days) * 100).toFixed(2) })),
  };
}

/** At most 5 even, whole-number steps of 1, 2, 2.5 or 5 times a power of ten: the design's y scale for the trend. */
function trendScale(top: number): { step: number; steps: number } {
  const magnitude = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(top, 1) / 5)));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => Number.isInteger(candidate) && Math.ceil(top / candidate) <= 5) ??
    magnitude * 10;
  return { step, steps: Math.max(1, Math.ceil(top / step)) };
}

/** Whole numbers from `from` to `to`, both included; empty when `to` is below `from`. */
function range(from: number, to: number): number[] {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function svgPath(coords: [number, number][]): string {
  return coords.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
}

/** " since Jun" from the growth baseline, with its year when that is not the period's; none without a baseline. */
export function formatHealthMetricsNewsletterGrowthSince(baselineDate: string | null, periodYear: number): string {
  const month = baselineDate ? formatIsoMonth(baselineDate) : '';
  if (!baselineDate || !month) return '';
  const baselineYear = baselineDate.slice(0, 4);
  return ` since ${month}${baselineYear === String(periodYear) ? '' : ` ${baselineYear}`}`;
}

/** "Jun" from an ISO date; empty for one that is not a date. */
function formatIsoMonth(iso: string): string {
  const parsed = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

/**
 * One point per newsletter sent in the period's year, oldest first and evenly spaced, as the design spaces them. The
 * read only carries newsletters with engagement data. The scale tops out at the highest rate of either line, rounded up to the next 10%.
 */
function buildNewsletterChart(newsletters: HealthMetricsOverviewNewsletters, year: number): HealthMetricsOverviewNewsletterChartView | null {
  const sends = newsletters.newsletters
    .filter((send) => send.openRate !== null && send.sentDate?.startsWith(`${year}-`))
    .sort((a, b) => (a.sentDate ?? '').localeCompare(b.sentDate ?? '') || a.key.localeCompare(b.key));
  if (!sends.length) return null;

  // Rounded to a tenth of a point first, so a peak of exactly 70% tops out at 70% rather than 80%.
  const peak = Math.round(Math.max(...sends.flatMap((send) => [send.openRate as number, send.clickRate ?? 0])) * 1000) / 1000;
  const top = Math.min(1, Math.max(0.1, Math.ceil(peak * 10) / 10));
  const x = (index: number): number => (sends.length === 1 ? 300 : (index / (sends.length - 1)) * 600);
  const y = (rate: number): number => 200 - (Math.min(rate, top) / top) * 200;
  const points = sends.map((send, index) => {
    const open = send.openRate as number;
    const click = send.clickRate;
    return { send, x: x(index), openY: y(open), clickY: click === null ? null : y(click), open, click };
  });
  const path = (coords: [number, number][]): string => coords.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const openCoords = points.map((point): [number, number] => [point.x, point.openY]);
  const first = points[0];
  const last = points[points.length - 1];
  const seenMonths = new Set<string>();

  return {
    openPath: path(openCoords),
    openAreaPath: first && last ? `${path(openCoords)} L${last.x.toFixed(1)} 200 L${first.x.toFixed(1)} 200 Z` : '',
    clickPath: path(points.filter((point) => point.clickY !== null).map((point): [number, number] => [point.x, point.clickY as number])),
    points: points.map((point) => ({
      key: point.send.key,
      xPct: ((point.x / 600) * 100).toFixed(2),
      openYPct: ((point.openY / 200) * 100).toFixed(2),
      clickYPct: point.clickY === null ? '' : ((point.clickY / 200) * 100).toFixed(2),
      tipAlign: tipAlign(point.x / 600),
      label: [
        point.send.name,
        point.send.sentDate ? formatIsoDateLabel(point.send.sentDate) : '',
        `open ${formatShare(point.open, false)}, click ${formatShare(point.click)}`,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    ticks: points.flatMap((point) => {
      const month = point.send.sentDate?.slice(0, 7) ?? '';
      if (!month || seenMonths.has(month)) return [];
      seenMonths.add(month);
      return [{ label: formatIsoMonth(`${month}-01`), xPct: ((point.x / 600) * 100).toFixed(2) }];
    }),
  };
}

/** A point near either edge opens its tooltip inward. */
function tipAlign(fraction: number): HealthMetricsOverviewNewsletterPointView['tipAlign'] {
  if (fraction < 0.2) return 'start';
  return fraction > 0.8 ? 'end' : 'center';
}

/** High / Medium / Low with the view's share of each; a level too small to see keeps a sliver of the bar. */
function buildNewsletterEngagement(period: HealthMetricsOverviewNewsletterPeriod | null): HealthMetricsOverviewNewsletterEngagementRowView[] {
  const levels = [
    { key: 'high', count: period?.highEngagement ?? null, share: period?.highEngagementShare ?? null, dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high },
    {
      key: 'medium',
      count: period?.mediumEngagement ?? null,
      share: period?.mediumEngagementShare ?? null,
      dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium,
    },
    { key: 'low', count: period?.lowEngagement ?? null, share: period?.lowEngagementShare ?? null, dotClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low },
  ] as const;

  return levels.map((level) => ({
    key: level.key,
    label: HEALTH_METRICS_OVERVIEW_NEWSLETTER_ENGAGEMENT[level.key].label,
    description: HEALTH_METRICS_OVERVIEW_NEWSLETTER_ENGAGEMENT[level.key].description,
    dotClass: level.dotClass,
    countLabel: formatCount(level.count),
    pctLabel: formatShare(level.share),
    widthPct: level.share !== null && level.share > 0 && level.count ? Math.max(level.share * 100, 1.5) : 0,
  }));
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
  const circumference = 2 * Math.PI * 36;
  const donut: HealthMetricsOverviewDonutSegmentView[] = [];
  // A measured level too small for a 1.5px sliver plus its 2px gap gets exactly that slot, so nothing paints over it;
  // the larger levels split the rest of the ring by share. An unmeasured level is not drawn.
  const minSlot = 1.5 + 2;
  const measured = total > 0 ? levels.filter((level) => level.count !== null) : [];
  const isSmall = (count: number): boolean => (count / total) * circumference < minSlot;
  const small = measured.filter((level) => isSmall(level.count ?? 0)).length;
  const largeTotal = measured.reduce((sum, level) => sum + (isSmall(level.count ?? 0) ? 0 : (level.count ?? 0)), 0);
  const shared = circumference - minSlot * small;
  let offset = 0;

  for (const level of measured) {
    const count = level.count ?? 0;
    const slot = isSmall(count) ? minSlot : (count / largeTotal) * shared;
    donut.push({
      key: level.key,
      stroke: level.stroke,
      dashArray: `${Math.max(slot - 2, 1.5).toFixed(2)} ${circumference.toFixed(2)}`,
      dashOffset: (-offset).toFixed(2),
    });
    offset += slot;
  }

  const link = key === 'members' ? HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.members : HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.nonMembers;
  return {
    key,
    kpis,
    engagementLabel,
    donut,
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

/**
 * The design's 240° gauge, split at -50, 0 and 30 with a small gap between segments and round caps at both ends.
 * Only the segment holding the score is at full color; the rest are mixed toward white.
 */
function buildGauge(score: number | null): Pick<HealthMetricsOverviewNpsView, 'segments' | 'caps'> {
  const bands: [string, number, number, string][] = [
    ['very-low', -100, -50, HEALTH_METRICS_OVERVIEW_STROKES.low],
    ['low', -50, 0, HEALTH_METRICS_OVERVIEW_STROKES.low],
    ['medium', 0, 30, HEALTH_METRICS_OVERVIEW_STROKES.medium],
    ['high', 30, 100, HEALTH_METRICS_OVERVIEW_STROKES.high],
  ];
  const gap = (1.6 * Math.PI) / 180;
  const segments = bands.map(([key, from, to, color]) => {
    const start = gaugeAngle(from) - (from === -100 ? 0 : gap);
    const end = gaugeAngle(to) + (to === 100 ? 0 : gap);
    const active = score !== null && score >= from && (score < to || (to === 100 && score <= 100));
    return {
      key,
      stroke: active ? color : mixWithWhite(color, HEALTH_METRICS_OVERVIEW_GAUGE_TINT),
      path: `M${gaugePoint(start, 52)} A52 52 0 ${start - end > Math.PI ? 1 : 0} 1 ${gaugePoint(end, 52)}`,
    };
  });
  const cap = (key: string, value: number, stroke: string): HealthMetricsOverviewGaugeCapView => {
    const angle = gaugeAngle(value);
    return { key, x: (66 + 52 * Math.cos(angle)).toFixed(1), y: (66 - 52 * Math.sin(angle)).toFixed(1), fill: stroke };
  };

  return { segments, caps: [cap('start', -100, segments[0].stroke), cap('end', 100, segments[segments.length - 1].stroke)] };
}

/** `#RRGGBB` at `share` strength over white, e.g. 0.22 for the gauge's inactive segments. */
function mixWithWhite(hex: string, share: number): string {
  const channel = (offset: number): string =>
    Math.round(parseInt(hex.slice(offset, offset + 2), 16) * share + 255 * (1 - share))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`.toUpperCase();
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
      sideLabel: 'Received:',
      sideValue: formatCount(proposals),
      widthPct: proposals > 0 ? clampPct((accepted / proposals) * 100) : 0,
      // No rule colors upcoming proposals yet, so they stay blue; past ones are green, as the design draws them.
      barClass: isPast ? HEALTH_METRICS_OVERVIEW_FILL_CLASSES.high : HEALTH_METRICS_OVERVIEW_FILL_CLASSES.blue,
      neutral: false,
      gauge: isPast ? { ...ACCENT_GAUGE, tone: 'level', level: 'high' } : ACCENT_GAUGE,
      note: event.cfpStatus?.toLowerCase() === 'in review' ? 'CFP In Review' : 'N/A',
    },
  };
}

/**
 * Without a goal the bar is the design's neutral outline with no status; otherwise upcoming events take their pace and
 * past ones their share of the goal. An unmeasured count draws a grey bar with no status, so it never reads as missed.
 */
function buildRegistrationsBar(event: HealthMetricsOverviewEvent, isPast: boolean): HealthMetricsOverviewEventRegistrationsView {
  const goal = event.registrationsGoal;
  const countLabel = formatCount(event.registrations);
  if (goal === null || goal <= 0) {
    return {
      countLabel,
      sideLabel: 'No goal set',
      sideValue: '',
      widthPct: 0,
      barClass: '',
      neutral: true,
      statusLabel: null,
      gauge: { ...ACCENT_GAUGE, empty: true },
    };
  }
  const side = { countLabel, sideLabel: 'Goal:', sideValue: formatCount(goal), neutral: false };
  if (event.registrations === null) {
    return { ...side, widthPct: 0, barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.muted, statusLabel: null, gauge: { ...ACCENT_GAUGE, unmeasured: true } };
  }

  const share = event.registrations / goal;
  return { ...side, widthPct: clampPct(share * 100), ...statusFields(isPast ? goalShareStatus(share) : paceStatus(event.compScore)) };
}

function statusFields(
  status: HealthMetricsOverviewEventStatus | null
): Pick<HealthMetricsOverviewEventRegistrationsView, 'barClass' | 'statusLabel' | 'gauge'> {
  if (!status) return { barClass: HEALTH_METRICS_OVERVIEW_FILL_CLASSES.blue, statusLabel: null, gauge: ACCENT_GAUGE };
  return { barClass: status.fillClass, statusLabel: status.label, gauge: { ...ACCENT_GAUGE, tone: 'level', level: status.level } };
}

function paceStatus(compScore: string | null): HealthMetricsOverviewEventStatus | null {
  return compScore && compScore in HEALTH_METRICS_OVERVIEW_EVENT_PACE
    ? HEALTH_METRICS_OVERVIEW_EVENT_PACE[compScore as keyof typeof HEALTH_METRICS_OVERVIEW_EVENT_PACE]
    : null;
}

function goalShareStatus(share: number): HealthMetricsOverviewEventStatus {
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

function daysBadge(isPast: boolean, daysLeft: number | null, icon: string): HealthMetricsOverviewEventDialogBadgeView | null {
  if (isPast) return { label: 'Event held', icon, variant: 'line', tone: 'neutral' };
  if (daysLeft === null) return null;
  return { label: daysLeft === 1 ? '1 day left' : `${formatCount(daysLeft)} days left`, icon, variant: 'line', tone: 'neutral' };
}

/**
 * The level before the period's first week: the week before it when read, else that week's level less its change.
 * The newest week runs past its own end, so with nothing read before it the view's spine starts at the event's first
 * activity, and the level before is zero.
 */
function weeklyStart(
  first: HealthMetricsEventsSnapshotWeek | null,
  before: HealthMetricsEventsSnapshotWeek | null,
  latest: HealthMetricsEventsSnapshotWeek | null,
  level: (week: HealthMetricsEventsSnapshotWeek) => number,
  delta: (week: HealthMetricsEventsSnapshotWeek) => number,
  end: number
): number {
  if (before) return level(before);
  if (!first) return end;
  if (first === latest) return 0;
  return level(first) - delta(first);
}

function snapshotRow(
  key: string,
  label: string,
  levels: { start: number; end: number },
  format: (value: number) => string,
  tip: string | null = null
): HealthMetricsOverviewSnapshotRowView {
  return {
    key,
    label,
    tip,
    startLabel: format(levels.start),
    endLabel: format(levels.end),
    change: snapshotChange(levels.start, levels.end, format),
    totals: false,
  };
}

/** "+139 (74%)" against the start; no share when the start is zero. A change under one unit reads as none. */
function snapshotChange(start: number, end: number, format: (value: number) => string): HealthMetricsOverviewSnapshotChangeView {
  const change = Math.round(end - start);
  if (change === 0) return { label: 'No change', tone: 'neutral', icon: null, inkClass: 'text-gray-500' };

  const share = start > 0 ? ` (${Math.abs(Math.round((change / start) * 100))}%)` : '';
  return change > 0
    ? { label: `+${format(change)}${share}`, tone: 'success', icon: 'fa-solid fa-circle-arrow-up', inkClass: 'text-emerald-600' }
    : { label: `−${format(-change)}${share}`, tone: 'danger', icon: 'fa-solid fa-circle-arrow-down', inkClass: 'text-red-600' };
}

/** "Nov 6, 26": the Snapshot's phone headers shorten the year. */
function formatIsoShortYearDate(iso: string): string {
  const parsed = parseIsoDateAsUtcMidnight(iso);
  if (!parsed) return iso;
  const monthDay = parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${monthDay}, ${String(parsed.getUTCFullYear()).slice(-2)}`;
}

/** Whole dollars with separators, as the Snapshot shows money: `$4,575,877`. */
function formatDollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** `YYYY-MM-DD` moved by whole days, in UTC so no offset can slip it a day. */
function shiftIsoDate(iso: string, days: number): string {
  const date = parseIsoDateAsUtcMidnight(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

/** A 0–1 share as a whole percentage; a share under 1% reads "<1%" unless `allowLessThanOne` is off. */
function formatShare(value: number | null, allowLessThanOne = true): string {
  if (value === null || !Number.isFinite(value)) return NOT_AVAILABLE;
  const pct = value * 100;
  return allowLessThanOne && pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

function clampPct(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/**
 * A KPI strip's layout at its measured width: a row while every item has 170px, otherwise two per row while half the
 * strip is still 130px, otherwise one stacked column. An unmeasured strip stays a row.
 */
export function toHealthMetricsOverviewKpiStripLayout(widthPx: number | null, itemCount: number): HealthMetricsOverviewKpiStripLayout {
  if (widthPx === null || itemCount === 0 || widthPx / itemCount >= HEALTH_METRICS_OVERVIEW_KPI_MIN_ITEM_WIDTH_PX) return 'row';
  return itemCount >= 2 && widthPx / 2 >= HEALTH_METRICS_OVERVIEW_KPI_MIN_HALF_WIDTH_PX ? 'grid' : 'stack';
}
