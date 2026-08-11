// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BEHIND_GOAL_PERCENT_THRESHOLD } from '../constants/marketing-impact.constants';

import type { MarketingImpactPeriodOption, ResolvedPeriodRange } from '../interfaces/marketing-impact.interface';

/** Number of past months to show in the Marketing Impact period picker. */
const MONTH_COUNT = 12;

/** Returns the default reporting month (previous calendar month, UTC). */
export function getDefaultMarketingImpactMonth(): string {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

// === Trend Helpers ===

export type TrendDirection = 'up' | 'down' | 'neutral';

/** Determines trend direction from a percentage change value. */
export function trendDirection(pct: number | null | undefined): TrendDirection {
  if (pct == null || !Number.isFinite(pct)) return 'neutral';
  if (Math.abs(pct) < 0.05) return 'neutral';
  if (pct > 0) return 'up';
  return 'down';
}

/** Returns a Tailwind color class based on trend direction. */
export function trendColorClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return 'text-gray-500';
  if (Math.abs(pct) < 0.05) return 'text-gray-500';
  if (pct > 0) return 'text-green-600';
  return 'text-red-600';
}

/** Formats a percentage change with sign and suffix (e.g., "+5.2% MoM"). */
export function formatChangePct(pct: number | null | undefined, suffix: string): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) < 0.05) return `0.0% ${suffix}`;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% ${suffix}`;
}

const MONTH_LABEL_REGEX = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;
const ISO_YEAR_MONTH_REGEX = /^(\d{4})-(0[1-9]|1[0-2])(?:$|-)/;
const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Calendar month ordinal (year * 12 + monthIndex) parsed deterministically
 * from a month string: either an en-US "MMM YYYY" label (e.g. "Jan 2026",
 * as emitted by toLocaleDateString('en-US', { month: 'short', year:
 * 'numeric' })) or an ISO "YYYY-MM"-prefixed string ("2026-01",
 * "2026-01-01", "2026-01-01T00:00:00.000Z"). Returns NaN for any other
 * format so adjacency checks fail closed instead of relying on
 * implementation-defined Date string parsing.
 */
export function monthLabelOrdinal(label: string): number {
  const labelMatch = MONTH_LABEL_REGEX.exec(label);
  if (labelMatch) {
    return Number(labelMatch[2]) * 12 + SHORT_MONTH_NAMES.indexOf(labelMatch[1]);
  }
  const isoMatch = ISO_YEAR_MONTH_REGEX.exec(label);
  if (isoMatch) {
    return Number(isoMatch[1]) * 12 + (Number(isoMatch[2]) - 1);
  }
  return Number.NaN;
}

/** Returns MoM percent change from the last two values of a monthly series. */
export function computeMomPct(arr: number[] | undefined): number | null {
  if (!arr || arr.length < 2) return null;
  const current = arr.at(-1) ?? 0;
  const previous = arr.at(-2) ?? 0;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// === Period Utilities ===

const PERIOD_PRESETS = ['ytd', 'last-3', 'last-6'] as const;
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Builds grouped period options: presets first, then individual months. */
export function buildMarketingImpactPeriodOptions(): MarketingImpactPeriodOption[] {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const presets: MarketingImpactPeriodOption[] = [
    { label: `Year to Date (${currentYear})`, value: 'ytd' },
    { label: 'Last 3 months', value: 'last-3' },
    { label: 'Last 6 months', value: 'last-6' },
  ];

  const months: MarketingImpactPeriodOption[] = [];
  for (let i = 1; i <= MONTH_COUNT; i++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push({ label, value });
  }

  return [...presets, ...months];
}

/** Returns the default period value (previous calendar month as YYYY-MM). */
export function getDefaultMarketingImpactPeriod(): string {
  return getDefaultMarketingImpactMonth();
}

/** Checks whether a period string is a preset identifier. */
export function isPeriodPreset(value: string): value is (typeof PERIOD_PRESETS)[number] {
  return (PERIOD_PRESETS as readonly string[]).includes(value);
}

/** Checks whether a period string is a valid YYYY-MM month. */
export function isPeriodMonth(value: string): boolean {
  return MONTH_REGEX.test(value);
}

/** Resolves a period value to a concrete date range with start/end dates in YYYY-MM-DD format. */
export function resolvePeriodRange(period: string): ResolvedPeriodRange | null {
  const now = new Date();
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth() + 1;

  if (isPeriodPreset(period)) {
    const endDate = firstOfMonth(utcYear, utcMonth);

    if (period === 'ytd') {
      return {
        type: 'ytd',
        startDate: `${utcYear}-01-01`,
        endDate,
        label: `Year to Date (${utcYear})`,
      };
    }

    const months = period === 'last-3' ? 3 : 6;
    return {
      type: 'trailing',
      startDate: firstOfMonth(utcYear, utcMonth - months),
      endDate,
      label: `Last ${months} months`,
    };
  }

  if (isPeriodMonth(period)) {
    const [year, mo] = period.split('-').map(Number);
    if (year > utcYear || (year === utcYear && mo > utcMonth)) {
      return null;
    }
    const date = new Date(Date.UTC(year, mo - 1, 1));
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return {
      type: 'month',
      startDate: firstOfMonth(year, mo),
      endDate: firstOfMonth(year, mo + 1),
      label,
    };
  }

  return null;
}

function firstOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// === Event Roster Helpers ===

/**
 * Registration progress as a whole percentage, or null when the event carries no real goal.
 * A goal of 0/absent means "no goal required", which is not the same as 0% attained.
 */
export function eventRegistrationPercent(registrations: { actual: number; goal: number }): number | null {
  if (!registrations.goal || registrations.goal <= 0) return null;
  return Math.round((registrations.actual / registrations.goal) * 100);
}

/**
 * Shared at-risk predicate: an event is at risk when it has a real registration goal it is
 * materially behind on AND it is pacing low against last year. Both the roster's row flag and
 * the needs-attention strip read this so the two views can never disagree about what "at risk"
 * means.
 */
export function isEventAtRisk(percent: number | null, compScore: string | null | undefined): boolean {
  return percent !== null && percent < BEHIND_GOAL_PERCENT_THRESHOLD && compScore === 'low';
}
