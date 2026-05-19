// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MarketingImpactMonthOption } from '../interfaces/marketing-impact.interface';

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
