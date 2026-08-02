// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PeriodDelta } from '../interfaces/metric-trend.interface';

type Trend = 'up' | 'down' | 'neutral';

/** Latest/prior pair with the rounded, `-0`-normalized percentage delta. `null` when there is no prior period or the prior value is 0. */
interface RoundedDelta {
  rounded: number;
  trend: Trend;
}

/** Shared rounding + direction logic so `computePeriodChange` and `computePeriodDelta` can never drift on edge cases (sub-threshold deltas, `-0`). */
function computeRoundedDelta(values: number[]): RoundedDelta | null {
  if (values.length < 2) return null;
  const latest = values[values.length - 1];
  const prior = values[values.length - 2];
  if (prior === 0) return null;
  const deltaPercent = ((latest - prior) / prior) * 100;
  let rounded = Number(deltaPercent.toFixed(1));
  // Normalize JS -0 to 0 so the label never reads "-0.0%" while trend stays neutral.
  if (Object.is(rounded, -0)) rounded = 0;
  let trend: Trend = 'neutral';
  if (rounded > 0) trend = 'up';
  else if (rounded < 0) trend = 'down';
  return { rounded, trend };
}

/** Gates the trend arrow on the rounded delta so it never contradicts the displayed "0.0%". Returns neutral + undefined when there is no prior period or the prior value is 0. */
export function computePeriodChange(values: number[], periodLabel = 'vs last month'): { trend: Trend; changePercentage: string | undefined } {
  const result = computeRoundedDelta(values);
  if (!result) return { trend: 'neutral', changePercentage: undefined };
  const { rounded, trend } = result;
  const arrowByTrend: Record<Trend, string> = { up: '▲ ', down: '▼ ', neutral: '' };
  const sign = trend === 'up' ? '+' : '';
  return { trend, changePercentage: `${arrowByTrend[trend]}${sign}${rounded.toFixed(1)}% ${periodLabel}` };
}

/**
 * Structured period-over-period delta for drawer header rendering — returns the
 * direction plus an absolute-value percentage label so the template can render
 * the ▲/▼ arrow and sr-only text separately. Returns null when there is no
 * prior period or the prior value is 0.
 */
export function computePeriodDelta(values: number[], periodLabel = 'vs last month'): PeriodDelta | null {
  const result = computeRoundedDelta(values);
  if (!result) return null;
  const { rounded, trend } = result;
  return {
    direction: trend,
    deltaLabel: Math.abs(rounded).toFixed(1),
    periodLabel,
  };
}
