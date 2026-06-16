// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MarketingImpactMonthOption, MarketingImpactPeriodOption, ResolvedPeriodRange } from '../interfaces/marketing-impact.interface';

/** Number of past months to show in the Marketing Impact month picker. */
const MONTH_COUNT = 12;

/** Builds the last 12 month options in descending order for the month picker. */
export function buildMarketingImpactMonthOptions(): MarketingImpactMonthOption[] {
  const now = new Date();
  const options: MarketingImpactMonthOption[] = [];

  for (let i = 1; i <= MONTH_COUNT; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    options.push({ label, value });
  }

  return options;
}

/** Returns the default reporting month (previous calendar month). */
export function getDefaultMarketingImpactMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
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
  const currentYear = now.getFullYear();
  const presets: MarketingImpactPeriodOption[] = [
    { label: `Year to Date (${currentYear})`, value: 'ytd' },
    { label: 'Last 3 months', value: 'last-3' },
    { label: 'Last 6 months', value: 'last-6' },
  ];

  const months: MarketingImpactPeriodOption[] = [];
  for (let i = 1; i <= MONTH_COUNT; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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

  if (isPeriodPreset(period)) {
    const endDate = firstOfMonth(now.getFullYear(), now.getMonth() + 1);

    if (period === 'ytd') {
      return {
        type: 'ytd',
        startDate: `${now.getFullYear()}-01-01`,
        endDate,
        label: `Year to Date (${now.getFullYear()})`,
      };
    }

    const months = period === 'last-3' ? 3 : 6;
    return {
      type: 'trailing',
      startDate: firstOfMonth(now.getFullYear(), now.getMonth() + 1 - months),
      endDate,
      label: `Last ${months} months`,
    };
  }

  if (isPeriodMonth(period)) {
    const [year, mo] = period.split('-').map(Number);
    if (year > now.getFullYear() || (year === now.getFullYear() && mo > now.getMonth() + 1)) {
      return null;
    }
    const date = new Date(year, mo - 1, 1);
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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
  const d = new Date(year, month - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
