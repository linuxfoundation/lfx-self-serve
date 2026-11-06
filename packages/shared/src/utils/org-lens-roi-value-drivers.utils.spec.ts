// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildValueDriverBars, formatSignedPercent, valueDriverAxisBound } from './org-lens-roi-value-drivers.utils';

const rows = [
  { category: 'Direct Cost Savings', pctDeviation: -9.7 },
  { category: 'Revenue Boosters', pctDeviation: 14.2 },
  { category: 'Risk Mitigation', pctDeviation: -5.3 },
  { category: 'Strategic', pctDeviation: 6.8 },
  { category: 'Prosocial', pctDeviation: 1.9 },
];

describe('org-lens-roi-value-drivers.utils', () => {
  it('formats signed percentages', () => {
    expect(formatSignedPercent(14.24)).toBe('+14.2%');
    expect(formatSignedPercent(-5.3)).toBe('-5.3%');
    expect(formatSignedPercent(-0.04)).toBe('0.0%');
  });

  it('picks a symmetric bound on a step', () => {
    expect(valueDriverAxisBound(rows)).toBe(20);
    expect(valueDriverAxisBound([{ category: 'Strategic', pctDeviation: 0.5 }])).toBe(10);
    expect(valueDriverAxisBound([{ category: 'Strategic', pctDeviation: -34 }])).toBe(50);
    expect(valueDriverAxisBound([])).toBe(10);
  });

  it('orders bars by deviation and colors by sign', () => {
    const bars = buildValueDriverBars(rows);
    expect(bars.map((bar) => bar.category)).toEqual(['Revenue Boosters', 'Strategic', 'Prosocial', 'Risk Mitigation', 'Direct Cost Savings']);
    expect(bars[0].subtitle).toBe('Productivity, standards');
    expect(bars[0].color).not.toBe(bars[4].color);
    expect(bars[4].label).toBe('-9.7%');
  });
});
