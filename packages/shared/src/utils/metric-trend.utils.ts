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
    const sign = rounded > 0 ? '+' : '';
    const arrow = rounded > 0 ? '▲ ' : rounded < 0 ? '▼ ' : '';
    changePercentage = `${arrow}${sign}${rounded.toFixed(1)}% ${periodLabel}`;
  }
  return { trend, changePercentage };
}
