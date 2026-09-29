// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_MEMBERS_NOT_AVAILABLE,
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_TIERS_COLORS,
} from '../constants/health-metrics-members.constants';
import { formatCurrency } from './number.utils';

import type { HealthMetricsRange } from '../interfaces/dashboard-metric.interface';
import type {
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

/** Sub-nav items for the Members tab. No section reports a count yet, so none carries a badge or note. */
export function buildHealthMetricsMembersSubNavItems(): HealthMetricsMembersSubNavItem[] {
  return HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: null, note: '' }));
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
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
