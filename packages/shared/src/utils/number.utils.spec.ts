// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { formatCurrency, formatPercent } from './number.utils';

describe('formatPercent', () => {
  it('rounds a raw Snowflake float to a single decimal place', () => {
    // The bug this exists to fix: NRR arrived as 94.919659091 and rendered verbatim.
    expect(formatPercent(94.919659091)).toBe('94.9');
  });

  it('always emits one decimal, including for whole numbers', () => {
    expect(formatPercent(100)).toBe('100.0');
    expect(formatPercent(0)).toBe('0.0');
  });

  it('rounds half away from zero, matching toFixed', () => {
    expect(formatPercent(12.35)).toBe('12.3');
    expect(formatPercent(12.36)).toBe('12.4');
  });

  it('normalizes negative zero so "-0.0" never renders', () => {
    // A tiny negative change rounds to -0 in JS; Object.is distinguishes it from 0
    // and `===` would not, so this guard is load-bearing.
    expect(formatPercent(-0.04)).toBe('0.0');
    expect(formatPercent(-0)).toBe('0.0');
  });

  it('preserves a genuine negative once it is large enough to survive rounding', () => {
    expect(formatPercent(-3.75)).toBe('-3.8');
  });

  it('falls back to 0.0 for non-finite input rather than emitting NaN or Infinity', () => {
    expect(formatPercent(Number.NaN)).toBe('0.0');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('0.0');
    expect(formatPercent(Number.NEGATIVE_INFINITY)).toBe('0.0');
  });
});

describe('formatCurrency compact thresholds', () => {
  it('switches to billions at the threshold that would otherwise round to 1000.0M', () => {
    expect(formatCurrency(999_949_999)).toBe('$999.9M');
    expect(formatCurrency(999_950_000)).toBe('$1B');
    expect(formatCurrency(5_576_366_821.32)).toBe('$5.6B');
  });

  it('keeps the millions and thousands branches unchanged below the billions threshold', () => {
    expect(formatCurrency(999_949)).toBe('$999.9K');
    expect(formatCurrency(999_950)).toBe('$1M');
    expect(formatCurrency(147_932_363.97)).toBe('$147.9M');
    expect(formatCurrency(999)).toBe('$999');
  });

  it('places the sign outside the prefix for negative billions', () => {
    expect(formatCurrency(-2_400_000_000)).toBe('-$2.4B');
  });

  it('falls back to $0 for non-finite input', () => {
    expect(formatCurrency(Number.NaN)).toBe('$0');
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('$0');
  });
});
