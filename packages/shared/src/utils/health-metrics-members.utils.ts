// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_MEMBERS_BRIDGE_STEP_LABELS,
  HEALTH_METRICS_MEMBERS_DIRECTORY_ENGAGEMENT_DOT_CLASSES,
  HEALTH_METRICS_MEMBERS_DIRECTORY_NPS_CHIP_CLASSES,
  HEALTH_METRICS_MEMBERS_MOVEMENT_DRAWER_COPY,
  HEALTH_METRICS_MEMBERS_MOVEMENT_LIST_TYPES,
  HEALTH_METRICS_MEMBERS_NOT_AVAILABLE,
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_COLORS,
} from '../constants/health-metrics-members.constants';
import { formatIsoDateLabel } from './date-time.utils';
import { formatCurrency } from './number.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type {
  HealthMetricsMembersBridge,
  HealthMetricsMembersBridgeBarView,
  HealthMetricsMembersBridgeStep,
  HealthMetricsMembersBridgeTone,
  HealthMetricsMembersBridgeView,
  HealthMetricsMembersDirectoryCellView,
  HealthMetricsMembersDirectoryMember,
  HealthMetricsMembersDirectoryRowView,
  HealthMetricsMembersSectionKey,
  HealthMetricsMembersMovement,
  HealthMetricsMembersMovementListType,
  HealthMetricsMembersMovementRowView,
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

/** Sub-nav items for the Members tab; a section badges only once it reports a count. */
export function buildHealthMetricsMembersSubNavItems(
  counts: Partial<Record<HealthMetricsMembersSectionKey, number | null>> = {}
): HealthMetricsMembersSubNavItem[] {
  return HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: counts[section.key] ?? null, note: '' }));
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

function activityCell(key: string, value: number | null, format: (value: number | null) => string): HealthMetricsMembersDirectoryCellView {
  return { key, label: format(value), tracked: value !== null };
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

function pluralize(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}
