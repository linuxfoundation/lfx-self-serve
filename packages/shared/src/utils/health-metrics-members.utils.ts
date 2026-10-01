// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS } from '../constants/health-metrics-engagement.constants';
import {
  HEALTH_METRICS_MEMBERS_AT_RISK_BUCKET_LABELS,
  HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS,
  HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS,
  HEALTH_METRICS_MEMBERS_BRIDGE_STEP_LABELS,
  HEALTH_METRICS_MEMBERS_CHURN_HIGH_RATE_PCT,
  HEALTH_METRICS_MEMBERS_CHURN_TREND_YEARS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_DOT_CLASSES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CHIP_CLASSES,
  HEALTH_METRICS_MEMBERS_MOVEMENT_DRAWER_COPY,
  HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES,
  HEALTH_METRICS_MEMBERS_NOT_AVAILABLE,
  HEALTH_METRICS_MEMBERS_NPS_RATE_DROP_PP,
  HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT,
  HEALTH_METRICS_MEMBERS_NPS_SEGMENTS,
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_COLORS,
} from '../constants/health-metrics-members.constants';
import { formatIsoDateLabel, formatIsoDateShortLabel } from './date-time.utils';
import { resolveHealthMetricsEngagementAttendanceTone } from './health-metrics-engagement.utils';
import { formatCurrency } from './number.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
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
  HealthMetricsMembersBridge,
  HealthMetricsMembersBridgeBarView,
  HealthMetricsMembersBridgeStep,
  HealthMetricsMembersBridgeTone,
  HealthMetricsMembersBridgeView,
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
  HealthMetricsMembersDirectoryCellView,
  HealthMetricsMembersDirectoryMember,
  HealthMetricsMembersDirectoryRowView,
  HealthMetricsMembersSectionKey,
  HealthMetricsMembersMovement,
  HealthMetricsMembersMovementListType,
  HealthMetricsMembersMovementRowView,
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
  HealthMetricsMembersSubNavItem,
  HealthMetricsMembersTiers,
  HealthMetricsMembersTiersMode,
  HealthMetricsMembersTiersStatView,
  HealthMetricsMembersTiersTierView,
  HealthMetricsMembersTiersView,
  HealthMetricsMembersTiersYearSummary,
  HealthMetricsMembersTiersYearView,
  HealthMetricsMembersTierYear,
} from '../interfaces/health-metrics-members.interface';

/** Sub-nav items for the Members tab; a section badges only once it reports a count, and notes only once it reports a note. */
export function buildHealthMetricsMembersSubNavItems(
  counts: Partial<Record<HealthMetricsMembersSectionKey, number | null>> = {},
  notes: Partial<Record<HealthMetricsMembersSectionKey, string>> = {}
): HealthMetricsMembersSubNavItem[] {
  return HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => ({
    key: section.key,
    label: section.label,
    count: counts[section.key] ?? null,
    note: notes[section.key] ?? '',
  }));
}

/**
 * `#tiers` — the hero for the selected period, plus every year as a tier × year matrix and a
 * composition chart. Pure over the loaded response, so a period or mode change never re-reads.
 */
export function buildHealthMetricsMembersTiersView(
  tiers: HealthMetricsMembersTiers,
  range: HealthMetricsRange,
  mode: HealthMetricsMembersTiersMode
): HealthMetricsMembersTiersView {
  const years = [...new Set(tiers.rows.map((row) => row.year))].sort((a, b) => a - b);
  const tierNames = orderTiers(tiers.rows);
  const rowsByYear = new Map(years.map((year) => [year, tiers.rows.filter((row) => row.year === year)]));

  const selectedYear = getYearForRange(range);
  const currentYear = getYearForRange('YTD');
  const selected = summarizeYear(rowsByYear.get(selectedYear) ?? []);
  const prior = summarizeYear(rowsByYear.get(selectedYear - 1) ?? []);
  const yearMeasured = rowsByYear.has(selectedYear);

  const yearViews: HealthMetricsMembersTiersYearView[] = years.map((year) => {
    const summary = summarizeYear(rowsByYear.get(year) ?? []);
    return {
      year,
      isCurrent: year === currentYear,
      isPartial: summary.isPartial,
      totalMembers: summary.members,
      totalMembersLabel: formatCount(summary.members),
      totalRevenueLabel: formatUsd(summary.revenue),
    };
  });

  const tierViews: HealthMetricsMembersTiersTierView[] = tierNames.map((tier, index) => ({
    tier,
    color: HEALTH_METRICS_MEMBERS_TIERS_COLORS[index % HEALTH_METRICS_MEMBERS_TIERS_COLORS.length],
    cells: yearViews.map((yearView) => {
      const count = (rowsByYear.get(yearView.year) ?? []).find((row) => row.tier === tier)?.memberCount ?? null;
      const total = yearView.totalMembers ?? 0;
      return { year: yearView.year, count, label: count ? formatCount(count) : '—', sharePct: sharePercent(count, total) };
    }),
  }));

  // A partial year has no same-window prior to compare with, so its delta is not available.
  const comparable = yearMeasured && !selected.isPartial && prior.measured;
  const baseline = `vs ${selectedYear - 1}`;
  const membersStat = buildStat('members', 'Members', formatCount(selected.members), comparable, baseline, selected.members, prior.members);
  const revenueStat = buildStat('revenue', 'Annual revenue', formatUsd(selected.revenue), comparable, baseline, selected.revenue, prior.revenue);
  const newStat: HealthMetricsMembersTiersStatView = {
    key: 'new',
    label: range === 'YTD' ? 'New this year' : `New in ${selectedYear}`,
    value: formatCount(selected.newMembers),
    delta: null,
    deltaDirection: 'neutral',
    baseline: null,
    positive: selected.newMembers !== null && selected.newMembers > 0,
  };
  const shareStat: HealthMetricsMembersTiersStatView = {
    key: 'share',
    label: 'Share of foundation revenue',
    value: formatShare(selected.revenue, tiers.foundationRevenue.find((period) => period.range === range)?.totalUsd ?? null),
    delta: null,
    deltaDirection: 'neutral',
    baseline: null,
    positive: false,
  };

  const headline = mode === 'members' ? membersStat : revenueStat;
  const side = [
    mode === 'members'
      ? { ...revenueStat, delta: null, deltaDirection: 'neutral' as const, baseline: null }
      : { ...membersStat, delta: null, deltaDirection: 'neutral' as const, baseline: null },
    newStat,
    shareStat,
  ];

  return {
    measured: tiers.rows.length > 0,
    yearMeasured,
    metaLabel: `${pluralize(tierNames.length, 'tier')} · ${pluralize(years.length, 'year')}`,
    headline,
    side,
    years: yearViews,
    tiers: tierViews,
  };
}

/**
 * The selected period's membership bridge. Bars keep the model's figures as they are; when start plus
 * the signed movements misses the end total, the view carries a note instead of adjusting a bar.
 */
export function buildHealthMetricsMembersBridgeView(bridge: HealthMetricsMembersBridge, range: HealthMetricsRange): HealthMetricsMembersBridgeView {
  const year = getYearForRange(range);
  const isCurrentYear = year === getYearForRange('YTD');
  const steps = bridge.steps.filter((step) => step.year === year).sort((a, b) => a.sortOrder - b.sortOrder);
  const endLabel = isCurrentYear || steps.some((step) => step.isPartialYear) ? 'Today' : `End of ${year}`;

  return {
    measured: bridge.steps.length > 0,
    yearMeasured: steps.length > 0,
    year,
    heading: range === 'YTD' ? 'How the base changed this year' : `How the base changed in ${year}`,
    bars: buildBridgeBars(steps, endLabel),
    reconcileNote: buildReconcileNote(steps, endLabel),
  };
}

/** A movement drawer's title: the design's "this year" wording for the running year, the year otherwise. */
export function buildHealthMetricsMembersMovementDrawerTitle(listType: HealthMetricsMembersMovementListType, year: number): string {
  const copy = HEALTH_METRICS_MEMBERS_MOVEMENT_DRAWER_COPY[listType];
  return year === getYearForRange('YTD') ? copy.title : `${copy.pastTitle} ${year}`;
}

/** Drawer rows: tier and movement date under the name, and the dues change signed by direction. */
export function buildHealthMetricsMembersMovementRows(
  rows: HealthMetricsMembersMovement[],
  listType: HealthMetricsMembersMovementListType
): HealthMetricsMembersMovementRowView[] {
  const { verb } = HEALTH_METRICS_MEMBERS_MOVEMENT_DRAWER_COPY[listType];
  const loss = listType === 'downgrade';

  return rows.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    detail: [row.membershipTier ?? 'No tier recorded', row.movementDate ? `${verb} ${formatIsoDateLabel(row.movementDate)}` : null]
      .filter((part): part is string => part !== null)
      .join(' · '),
    duesLabel: formatSignedUsd(row.duesImpactUsd, listType === 'new' ? 'neutral' : toneFor(listType)),
    loss,
  }));
}

/** Set when the list and its bar disagree; the list still shows every organization it has. */
export function buildHealthMetricsMembersMovementCountNote(totalRecords: number, barCount: number | null): string | null {
  if (barCount === null || barCount === totalRecords) return null;

  return `${pluralize(totalRecords, 'organization')} listed, while the bar counts ${barCount.toLocaleString('en-US')}. The list and the bar are counted separately, so they can differ slightly.`;
}

/** Directory rows. A NULL activity count is not tracked for the foundation and renders as a dash, never 0. */
export function buildHealthMetricsMembersDirectoryRows(rows: HealthMetricsMembersDirectoryMember[]): HealthMetricsMembersDirectoryRowView[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    npsLabel: row.npsCategory,
    npsClass: row.npsCategory ? HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CHIP_CLASSES[row.npsCategory] : '',
    isAtRisk: row.isAtRisk,
    tierLabel: row.membershipTier ?? '—',
    duesLabel: formatUsd(row.annualDuesUsd),
    engagementLabel: row.engagementLevel ?? '—',
    engagementDotClass: row.engagementLevel ? HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_DOT_CLASSES[row.engagementLevel] : '',
    scoreLabel: row.engagementScore === null ? '—' : row.engagementScore.toFixed(1),
    renewsLabel: formatIsoDate(row.renewalDate),
    renewalDuesLabel: formatUsd(row.renewalDuesUsd),
    lastEngagedLabel: formatIsoDate(row.lastEngagedDate),
    activity: [
      activityCell('contribution', row.contributionCount, formatCount),
      activityCell('sponsorship', row.sponsorshipUsd, (value) => formatUsd(value === null ? null : Math.round(value))),
      activityCell('training', row.trainingEnrollmentCount, formatCount),
      activityCell('events', row.eventRegistrationCount, formatCount),
    ],
  }));
}

/** The unfiltered count line: "725 members · 12 at risk · highest dues first". */
export function buildHealthMetricsMembersDirectorySummary(scopeTotal: number, atRiskCount: number): string {
  return [pluralize(scopeTotal, 'member'), atRiskCount > 0 ? `${atRiskCount.toLocaleString('en-US')} at risk` : null, 'highest dues first']
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** The search box placeholder, sized to the whole foundation. */
export function buildHealthMetricsMembersDirectorySearchPlaceholder(scopeTotal: number): string {
  return `Search ${pluralize(scopeTotal, 'member')}…`;
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
  const isBelowExpectedLevel = selected?.isBelowExpectedLevel === true;
  const neverAttendedCount = Math.max(0, selected?.neverAttendedCount ?? 0);
  const noun = HEALTH_METRICS_MEMBERS_BOARD_MEETING_NOUNS[cohort];
  const attended = selected?.latestAttendedCount ?? null;
  const invited = selected?.latestInvitedCount ?? null;
  const meetings = selected?.meetingsInRangeCount ?? null;
  return {
    meetingsLabel: meetings === null ? '—' : `${pluralize(meetings, 'meeting')} in range`,
    latestPctLabel: formatPct(selected?.latestAttendancePct ?? null),
    latestCaption: `Last ${noun}${isBelowExpectedLevel ? ' · below the ~100% this should be' : ''}`,
    isBelowExpectedLevel,
    otherCohortLabel: HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS.find((option) => option.id !== cohort)?.label ?? '',
    otherCohortPctLabel: formatPct(other?.latestAttendancePct ?? null),
    attendedInvitedLabel: attended === null || invited === null ? '—' : `${formatCount(attended)} / ${formatCount(invited)}`,
    neverAttendedLabel: formatCount(selected?.neverAttendedCount ?? null),
    neverAttendedCount,
  };
}

/** Meeting rows; the rate bar takes the Engagement attendance tones. */
export function buildHealthMetricsMembersBoardMeetingRows(rows: HealthMetricsMembersBoardMeeting[]): HealthMetricsMembersBoardMeetingRowView[] {
  return rows.map((row) => {
    const ratePct = toWholePct(row.attendancePct);
    return {
      meetingId: row.meetingId,
      committeeName: row.committeeName ?? '—',
      dateLabel: formatIsoDate(row.meetingDate),
      attendedLabel: row.attendedCount === null || row.invitedCount === null ? '—' : `${formatCount(row.attendedCount)} / ${formatCount(row.invitedCount)}`,
      ratePct,
      rateLabel: ratePct === null ? '—' : `${ratePct}%`,
      rateFillClass: HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS[resolveHealthMetricsEngagementAttendanceTone(row.attendancePct)],
    };
  });
}

/** Trend bars, labelled by short date; the rate is clamped like the table's. */
export function buildHealthMetricsMembersBoardTrend(trend: HealthMetricsMembersBoardMeeting[]): HealthMetricsMembersBoardTrendBarView[] {
  return trend.map((meeting) => {
    const pct = toWholePct(meeting.attendancePct);
    return {
      meetingId: meeting.meetingId,
      label: formatIsoDateShortLabel(meeting.meetingDate) ?? '—',
      dateLabel: formatIsoDate(meeting.meetingDate),
      committeeName: meeting.committeeName ?? '—',
      pct,
      pctLabel: pct === null ? '—' : `${pct}%`,
      isLatest: meeting.isLatestMeeting,
    };
  });
}

/** The sub-nav note, from the board cohort: unused seats first, else the latest share when below its level. */
export function buildHealthMetricsMembersBoardNote(board: HealthMetricsMembersBoardCohortSummary | null): string {
  if (!board) return '';
  const never = board.neverAttendedCount ?? 0;
  if (never > 0) return `${pluralize(never, 'seat')} unused`;
  if (board.isBelowExpectedLevel === true && board.latestAttendancePct !== null) return `${formatPct(board.latestAttendancePct)} attended`;
  return '';
}

/** The "N meetings" line over the table. */
export function buildHealthMetricsMembersBoardCountLabel(totalRecords: number): string {
  return pluralize(totalRecords, 'meeting');
}

/** The audience toggle, in the read's order. */
export function buildHealthMetricsMembersNpsAudienceOptions(audiences: HealthMetricsMembersNpsAudience[]): HealthMetricsMembersNpsAudienceOption[] {
  return audiences.map((audience) => ({ id: audience.audience, label: audience.audience }));
}

/** The NPS hero, banner and footer for one audience; a flagged sample withholds the score rather than showing it as precise. */
export function buildHealthMetricsMembersNpsSummary(audience: HealthMetricsMembersNpsAudience | null): HealthMetricsMembersNpsSummaryView {
  const isWithheld = !audience || audience.isSampleTooSmall || audience.npsScore === null;
  const recipients = audience?.recipientsCount ?? null;
  const responses = audience?.responsesCount ?? null;
  const ratePct = toWholePct(audience?.responseRatePct ?? null);
  const isRateBelowFloor = ratePct !== null && ratePct < HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT;
  const change = isWithheld ? null : (audience?.scoreChangePp ?? null);
  const respondedLabel = responses === null || recipients === null ? '—' : `${formatCount(responses)} of ${formatCount(recipients)}`;
  const rateLabel = ratePct === null ? '—' : `${ratePct}%`;

  return {
    isWithheld,
    scoreLabel: isWithheld ? '—' : formatSignedScore(audience?.npsScore ?? null),
    changeLabel: change === null ? null : `${formatSignedScore(change)}pp`,
    changeDirection: directionOf(change),
    caption: isWithheld ? 'Not enough responses to report a score' : `Net Promoter Score · ${audience?.audience.toLowerCase()} audience`,
    respondedLabel,
    rateLabel,
    isRateBelowFloor,
    lowSampleNote: audience?.isSampleTooSmall
      ? `Only ${respondedLabel} responded (${rateLabel}). Below the confidence threshold — the score is suppressed rather than shown as precise.`
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

/** Trend points, oldest first; a flagged wave keeps its response rate but withholds its score. */
export function buildHealthMetricsMembersNpsTrend(trend: HealthMetricsMembersNpsQuarter[]): HealthMetricsMembersNpsTrendPointView[] {
  return trend.map((quarter) => {
    const score = quarter.isSampleTooSmall ? null : quarter.npsScore;
    const ratePct = toWholePct(quarter.responseRatePct);
    return {
      quarterStartDate: quarter.quarterStartDate,
      label: quarter.quarterLabel ?? '—',
      score,
      scoreLabel: score === null ? 'Withheld' : formatSignedScore(score),
      ratePct,
      rateLabel: ratePct === null ? '—' : `${ratePct}%`,
      isRateBelowFloor: ratePct !== null && ratePct < HEALTH_METRICS_MEMBERS_NPS_RATE_FLOOR_PCT,
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
  const rateOf = (row: HealthMetricsMembersChurnYear | null): number | null => (mode === 'revenue' ? row?.revenueChurnRate : row?.logoChurnRate) ?? null;
  const rate = rateOf(current);
  const priorRate = rateOf(prior);
  const change = mode === 'revenue' ? churnRevenueChange(current, prior) : churnDifference(rate, priorRate);
  const isCurrentYear = year === getYearForRange('YTD');

  return {
    measured: churn.years.length > 0,
    yearMeasured: current !== null,
    year,
    hasChurn: lostCount > 0,
    lostCount,
    metaLabel:
      current?.openingCount === null || current?.openingCount === undefined
        ? `${pluralize(lostCount, 'membership')} lost`
        : `${formatCount(lostCount)} of ${pluralize(Math.round(current.openingCount), 'membership')} lost`,
    heroLabel: formatChurnRate(rate),
    changeLabel: change === null ? null : formatChurnChange(change),
    changeTone: churnChangeTone(change),
    caption: buildChurnCaption(mode, year, isCurrentYear),
    sides: buildChurnSides(current, mode, year, isCurrentYear),
    tiers: buildChurnTierRows(churn.tiers.filter((row) => row.year === year)),
    inversion: buildChurnInversion(churn.tiers.filter((row) => row.year === year)),
    trendTitle: mode === 'revenue' ? 'Revenue churn trend' : 'Logo churn trend',
    trendSubtitle: mode === 'revenue' ? 'share of dues not renewed, by year' : 'share of memberships lost, by year',
    trend: buildChurnTrend(churn.years, year, rateOf),
    trendRose: rate !== null && priorRate !== null && rate > priorRate,
  };
}

/** "Who left" rows: dues lost, the lapse and the last engagement, a dash where the model has none. */
export function buildHealthMetricsMembersChurnDepartureRows(rows: HealthMetricsMembersChurnDeparture[]): HealthMetricsMembersChurnDepartureRowView[] {
  return rows.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    tierLabel: row.membershipTier ?? '—',
    duesLabel: formatUsd(row.duesLostUsd),
    lapsedLabel: formatIsoDate(row.lapsedDate),
    lastEngagedLabel: formatIsoDate(row.lastEngagedDate),
  }));
}

/** "Who left"'s subtitle; it claims the bridge's count only when the list carries exactly that many. */
export function buildHealthMetricsMembersChurnDeparturesSubtitle(totalRecords: number, lostCount: number): string {
  return totalRecords === lostCount ? `largest dues lost first · the same ${formatCount(lostCount)} as the bridge above` : 'largest dues lost first';
}

/** The view's own point change, read only when the year before is in the read to compare against. */
function churnRevenueChange(current: HealthMetricsMembersChurnYear | null, prior: HealthMetricsMembersChurnYear | null): number | null {
  return prior === null ? null : (current?.revenueChurnRateChangePp ?? null);
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
      : { key: 'revenue', label: 'Revenue churn', value: formatChurnRate(current?.revenueChurnRate ?? null), note: null, isLoss: false };

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
      const share = raw === null ? null : Math.round(raw);
      return {
        tier: row.tier,
        lostLabel: formatCount(row.lostCount),
        rateLabel: formatChurnRate(row.churnRate),
        isHighRate: row.churnRate !== null && row.churnRate >= HEALTH_METRICS_MEMBERS_CHURN_HIGH_RATE_PCT,
        duesLabel: formatUsd(row.duesLostUsd),
        shareLabel: formatChurnShare(raw, share),
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
        valueLabel: value === null ? '—' : `${Math.round(value)}%`,
        isSelected: row.year === year,
      };
    });
}

/** A percentage to one decimal, dropping a trailing `.0`. */
function formatChurnRate(pct: number | null): string {
  return pct === null ? '—' : `${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

/** A whole-percent share; a loss too small to round up still reads as one. */
function formatChurnShare(raw: number | null, share: number | null): string {
  if (raw === null || share === null) return '—';
  return raw > 0 && share === 0 ? '<1%' : `${share}%`;
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

function activityCell(key: string, value: number | null, format: (value: number | null) => string): HealthMetricsMembersDirectoryCellView {
  return { key, label: format(value), tracked: value !== null };
}

function toWholePct(share: number | null): number | null {
  return share === null ? null : Math.min(100, Math.max(0, Math.round(share * 100)));
}

function formatIsoDate(value: string | null): string {
  return value ? formatIsoDateLabel(value) : '—';
}

function buildBridgeBars(steps: HealthMetricsMembersBridgeStep[], endLabel: string): HealthMetricsMembersBridgeBarView[] {
  // Each movement floats from the running total, as a waterfall; the two totals stand on zero.
  let running = 0;
  const spans = steps.map((step) => {
    if (step.movementType === 'start_of_year' || step.movementType === 'today') {
      const total = Math.max(0, step.memberCount ?? 0);
      if (step.movementType === 'start_of_year') running = total;
      return { step, low: 0, high: total };
    }

    const from = running;
    running = Math.max(0, running + (step.signedMemberCount ?? 0));
    return { step, low: Math.min(from, running), high: Math.max(from, running) };
  });

  // Headroom above the tallest bar leaves space for its labels.
  const scale = Math.max(1, ...spans.map((span) => span.high)) * 1.12;

  return spans.map(({ step, low, high }) => {
    const tone = toneFor(step.movementType);
    const label = step.movementType === 'today' ? endLabel : HEALTH_METRICS_MEMBERS_BRIDGE_STEP_LABELS[step.movementType];
    const countLabel = formatSignedCount(step.memberCount, tone);
    const duesLabel = formatSignedUsd(step.revenueImpactUsd, tone);
    const hasMembers = (step.memberCount ?? 0) > 0;
    const listType = hasMembers ? (HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES.find((type) => type === step.movementType) ?? null) : null;
    const opensChurn = hasMembers && step.movementType === 'churned';
    const action = listType ? ', opens the list' : '';

    return {
      movementType: step.movementType,
      label,
      countLabel,
      duesLabel,
      tone,
      bottomPct: (low / scale) * 100,
      heightPct: ((high - low) / scale) * 100,
      listType,
      opensChurn,
      memberCount: step.memberCount,
      ariaLabel: `${label}: ${countLabel} members${duesLabel ? `, ${duesLabel} in dues` : ''}${opensChurn ? ', goes to churn' : action}`,
    };
  });
}

/** Checked, never assumed: a year missing either total or a movement's signed count cannot be checked. */
function buildReconcileNote(steps: HealthMetricsMembersBridgeStep[], endLabel: string): string | null {
  const start = steps.find((step) => step.movementType === 'start_of_year')?.memberCount ?? null;
  const end = steps.find((step) => step.movementType === 'today')?.memberCount ?? null;
  const movements = steps.filter((step) => step.movementType !== 'start_of_year' && step.movementType !== 'today');
  if (start === null || end === null || movements.some((step) => step.signedMemberCount === null)) return null;

  const expected = movements.reduce((sum, step) => sum + (step.signedMemberCount ?? 0), start);
  if (expected === end) return null;

  const endPhrase = endLabel === 'Today' ? 'today' : `at the ${endLabel.toLowerCase()}`;
  return `These figures don't reconcile: ${formatCount(start)} at the start of the year plus the movements comes to ${formatCount(expected)}, but ${formatCount(end)} are recorded ${endPhrase}. The bars show the recorded figures.`;
}

function toneFor(movementType: HealthMetricsMembersBridgeStep['movementType']): HealthMetricsMembersBridgeTone {
  if (movementType === 'new' || movementType === 'upgrade') return 'gain';
  if (movementType === 'downgrade' || movementType === 'churned') return 'loss';
  return 'neutral';
}

/** Counts arrive unsigned, so a movement's sign comes from its direction. */
function formatSignedCount(value: number | null, tone: HealthMetricsMembersBridgeTone): string {
  if (value === null) return '—';
  if (value === 0 || tone === 'neutral') return formatCount(value);
  return `${tone === 'gain' ? '+' : '−'}${formatCount(value)}`;
}

/** Empty for an unmeasured figure, so the bar shows only its count. */
function formatSignedUsd(value: number | null, tone: HealthMetricsMembersBridgeTone): string {
  if (value === null) return '';
  const amount = formatCurrency(Math.abs(value));
  if (value === 0 || tone === 'neutral') return amount;
  return `${tone === 'gain' ? '+' : '−'}${amount}`;
}

function summarizeYear(rows: HealthMetricsMembersTierYear[]): HealthMetricsMembersTiersYearSummary {
  return {
    measured: rows.length > 0,
    isPartial: rows.some((row) => row.isPartialYear),
    members: sumMeasured(rows.map((row) => row.memberCount)),
    newMembers: sumMeasured(rows.map((row) => row.newMemberCount)),
    revenue: sumMeasured(rows.map((row) => row.revenueUsd)),
  };
}

/** Sum of the measured values; `null` when none is measured, so an unread year never reads as zero. */
function sumMeasured(values: (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0 ? null : measured.reduce((sum, value) => sum + value, 0);
}

/** Tier names by their lowest sort rank across years, then by name, so every year lists tiers in one order. */
function orderTiers(rows: HealthMetricsMembersTierYear[]): string[] {
  const rankByTier = new Map<string, number>();
  for (const row of rows) rankByTier.set(row.tier, Math.min(rankByTier.get(row.tier) ?? Infinity, row.sortRank));

  return [...rankByTier.entries()].sort(([a, rankA], [b, rankB]) => rankA - rankB || a.localeCompare(b, 'en-US')).map(([tier]) => tier);
}

function buildStat(
  key: string,
  label: string,
  value: string,
  comparable: boolean,
  baseline: string,
  current: number | null,
  previous: number | null
): HealthMetricsMembersTiersStatView {
  const change = comparable && current !== null && previous !== null && previous > 0 ? (current - previous) / previous : null;
  return { key, label, value, ...formatDelta(change), baseline: change === null ? null : baseline, positive: false };
}

/** A tier's share of its year; an unmeasured count stays `null` rather than reading as 0%. */
function sharePercent(count: number | null, total: number): number | null {
  if (count === null) return null;
  return total > 0 ? (count / total) * 100 : 0;
}

/** A change as a whole percent (`−25%`); the sign follows the rounded value. */
function formatDelta(fraction: number | null): Pick<HealthMetricsMembersTiersStatView, 'delta' | 'deltaDirection'> {
  if (fraction === null) return { delta: HEALTH_METRICS_MEMBERS_NOT_AVAILABLE, deltaDirection: 'neutral' };

  const rounded = Math.round(fraction * 100);
  if (rounded === 0) return { delta: '0%', deltaDirection: 'neutral' };

  return { delta: `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`, deltaDirection: rounded > 0 ? 'up' : 'down' };
}

function formatShare(revenue: number | null, foundationTotal: number | null): string {
  if (revenue === null || foundationTotal === null || foundationTotal <= 0) return HEALTH_METRICS_MEMBERS_NOT_AVAILABLE;
  return `${Math.round((revenue / foundationTotal) * 100)}%`;
}

function formatCount(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString('en-US');
}

function formatUsd(value: number | null): string {
  return value === null ? '—' : formatCurrency(value);
}

function formatPct(fraction: number | null): string {
  const pct = toWholePct(fraction);
  return pct === null ? '—' : `${pct}%`;
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
