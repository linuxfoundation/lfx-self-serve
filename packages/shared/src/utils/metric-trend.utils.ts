// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Gates the trend arrow on the rounded delta so it never contradicts the displayed "0.0%". Returns neutral + undefined when there is no prior period or the prior value is 0. */
export function computePeriodChange(
  values: number[],
  periodLabel = 'vs last month'
): { trend: 'up' | 'down' | 'neutral'; changePercentage: string | undefined } {
  const latest = values.length ? values[values.length - 1] : 0;
  const prior = values.length > 1 ? values[values.length - 2] : null;

  let trend: 'up' | 'down' | 'neutral' = 'neutral';
  let changePercentage: string | undefined;
  if (prior !== null && prior !== 0) {
    const deltaPercent = ((latest - prior) / prior) * 100;
    let rounded = Number(deltaPercent.toFixed(1));
    // Normalize JS -0 to 0 so the label never reads "-0.0%" while trend stays neutral.
    if (Object.is(rounded, -0)) rounded = 0;
    if (rounded > 0) {
      trend = 'up';
    } else if (rounded < 0) {
      trend = 'down';
    }
    const arrowByTrend: Record<'up' | 'down' | 'neutral', string> = { up: '▲ ', down: '▼ ', neutral: '' };
    const arrow = arrowByTrend[trend];
    const sign = trend === 'up' ? '+' : '';
    changePercentage = `${arrow}${sign}${rounded.toFixed(1)}% ${periodLabel}`;
  }
  return { trend, changePercentage };
}

/**
 * Structured period-over-period delta for drawer header rendering — returns the
 * direction plus an absolute-value percentage label so the template can render
 * the ▲/▼ arrow and sr-only text separately (matching the Active Contributors
 * drawer). Returns null when there is no prior period or the prior value is 0.
 */
export function computePeriodDelta(
  values: number[],
  periodLabel = 'vs last month'
): { direction: 'up' | 'down' | 'neutral'; deltaLabel: string; periodLabel: string } | null {
  if (values.length < 2) return null;
  const latest = values[values.length - 1];
  const prior = values[values.length - 2];
  if (prior === 0) return null;
  const deltaPercent = ((latest - prior) / prior) * 100;
  let rounded = Number(deltaPercent.toFixed(1));
  if (Object.is(rounded, -0)) rounded = 0;
  let direction: 'up' | 'down' | 'neutral' = 'neutral';
  if (rounded > 0) direction = 'up';
  else if (rounded < 0) direction = 'down';
  return {
    direction,
    deltaLabel: Math.abs(rounded).toFixed(1),
    periodLabel,
  };
}
