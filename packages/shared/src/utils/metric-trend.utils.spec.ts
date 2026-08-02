// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { computePeriodChange, computePeriodDelta } from './metric-trend.utils';

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
    expect(computePeriodChange([100, 150])).toEqual({ trend: 'up', changePercentage: '▲ +50.0% vs last month' });
  });

  it('classifies a negative delta as down with a signed percentage', () => {
    expect(computePeriodChange([150, 100])).toEqual({ trend: 'down', changePercentage: '▼ -33.3% vs last month' });
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
      changePercentage: '▲ +50.0% vs last quarter',
    });
  });

  it('uses only the last two elements of a longer series', () => {
    expect(computePeriodChange([10, 20, 30, 40, 60])).toEqual({ trend: 'up', changePercentage: '▲ +50.0% vs last month' });
  });
});

describe('computePeriodDelta', () => {
  it('returns null for an empty series', () => {
    expect(computePeriodDelta([])).toBeNull();
  });

  it('returns null for a single-element series', () => {
    expect(computePeriodDelta([42])).toBeNull();
  });

  it('returns null when the prior value is 0', () => {
    expect(computePeriodDelta([0, 10])).toBeNull();
  });

  it('classifies a positive delta as up with an absolute percentage', () => {
    expect(computePeriodDelta([100, 150])).toEqual({ direction: 'up', deltaLabel: '50.0', periodLabel: 'vs last month' });
  });

  it('classifies a negative delta as down with an absolute percentage', () => {
    expect(computePeriodDelta([150, 100])).toEqual({ direction: 'down', deltaLabel: '33.3', periodLabel: 'vs last month' });
  });

  it('classifies an exactly-zero delta as neutral with 0.0', () => {
    expect(computePeriodDelta([100, 100])).toEqual({ direction: 'neutral', deltaLabel: '0.0', periodLabel: 'vs last month' });
  });

  it('treats a sub-threshold positive delta as neutral so the arrow never contradicts the rounded 0.0%', () => {
    // raw +0.04% rounds to 0.0% — direction must stay neutral, not up
    expect(computePeriodDelta([10000, 10004])).toEqual({ direction: 'neutral', deltaLabel: '0.0', periodLabel: 'vs last month' });
  });

  it('treats a sub-threshold negative delta as neutral and never leaks -0.0', () => {
    // raw -0.04% rounds to 0.0% — direction must stay neutral, not down, and no "-0.0" leaks
    expect(computePeriodDelta([10004, 10000])).toEqual({ direction: 'neutral', deltaLabel: '0.0', periodLabel: 'vs last month' });
  });

  it('passes the custom period label through', () => {
    expect(computePeriodDelta([100, 150], 'vs last quarter')).toEqual({
      direction: 'up',
      deltaLabel: '50.0',
      periodLabel: 'vs last quarter',
    });
  });

  it('uses only the last two elements of a longer series', () => {
    expect(computePeriodDelta([10, 20, 30, 40, 60])).toEqual({ direction: 'up', deltaLabel: '50.0', periodLabel: 'vs last month' });
  });
});
