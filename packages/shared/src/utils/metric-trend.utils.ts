// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Latest-vs-prior-period delta for an oldest→newest numeric series. The trend
 * arrow is gated on the rounded delta (not the raw value) so a near-zero change
 * never renders a direction arrow alongside a displayed "0.0%" — the arrow and
 * the number must always agree. Returns neutral + undefined when there is no
 * prior period or the prior value is 0 (avoids divide-by-zero).
 */
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
    const rounded = Number(deltaPercent.toFixed(1));
    if (rounded > 0) {
      trend = 'up';
    } else if (rounded < 0) {
      trend = 'down';
    }
    const sign = rounded > 0 ? '+' : '';
    changePercentage = `${sign}${rounded.toFixed(1)}% ${periodLabel}`;
  }
  return { trend, changePercentage };
}
