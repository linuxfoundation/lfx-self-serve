// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { computePeriodChange } from './metric-trend.utils';

describe('computePeriodChange', () => {
  it('returns neutral trend and undefined changePercentage for an empty series', () => {
    expect(computePeriodChange([])).toEqual({ trend: 'neutral', changePercentage: undefined });
  });

  it('returns neutral trend and undefined changePercentage for a single-element series', () => {
    expect(computePeriodChange([42])).toEqual({ trend: 'neutral', changePercentage: undefined });
  });

  it('returns neutral trend and undefined changePercentage when the prior value is 0', () => {
    expect(computePeriodChange([0, 10])).toEqual({ trend: 'neutral', changePercentage: undefined });
  });

  it('classifies a positive delta as up with a signed percentage', () => {
    expect(computePeriodChange([100, 150])).toEqual({ trend: 'up', changePercentage: '+50.0% vs last month' });
  });

  it('classifies a negative delta as down with a signed percentage', () => {
    expect(computePeriodChange([150, 100])).toEqual({ trend: 'down', changePercentage: '-33.3% vs last month' });
  });

  it('classifies an exactly-zero delta as neutral with a 0.0% label', () => {
    expect(computePeriodChange([100, 100])).toEqual({ trend: 'neutral', changePercentage: '0.0% vs last month' });
  });

  it('treats a sub-threshold positive delta as neutral so the arrow never contradicts the rounded 0.0%', () => {
    // raw +0.04% rounds to 0.0% — arrow must stay neutral, not up
    expect(computePeriodChange([10000, 10004])).toEqual({ trend: 'neutral', changePercentage: '0.0% vs last month' });
  });

  it('treats a sub-threshold negative delta as neutral so the arrow never contradicts the rounded 0.0%', () => {
    // raw -0.04% rounds to 0.0% — arrow must stay neutral, not down, and no "-0.0%" sign leaks
    expect(computePeriodChange([10004, 10000])).toEqual({ trend: 'neutral', changePercentage: '0.0% vs last month' });
  });

  it('passes the custom period label through to the changePercentage string', () => {
    expect(computePeriodChange([100, 150], 'vs last quarter')).toEqual({
      trend: 'up',
      changePercentage: '+50.0% vs last quarter',
    });
  });

  it('uses only the last two elements of a longer series', () => {
    expect(computePeriodChange([10, 20, 30, 40, 60])).toEqual({ trend: 'up', changePercentage: '+50.0% vs last month' });
  });
});
