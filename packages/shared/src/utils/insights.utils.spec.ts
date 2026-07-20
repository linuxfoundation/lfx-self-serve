// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { classifyHealthScore } from './insights.utils';

describe('classifyHealthScore', () => {
  it.each([
    [100, 'excellent'],
    [80, 'excellent'],
    [79, 'healthy'],
    [60, 'healthy'],
    [59, 'stable'],
    [40, 'stable'],
    [39, 'unsteady'],
    [20, 'unsteady'],
    [19, 'critical'],
    [0, 'critical'],
  ] as const)('classifies %i as %s', (score, band) => {
    expect(classifyHealthScore(score)).toBe(band);
  });

  it('places the five bands in a strictly worsening order as the score drops', () => {
    const order = [90, 70, 50, 30, 10].map(classifyHealthScore);
    expect(order).toEqual(['excellent', 'healthy', 'stable', 'unsteady', 'critical']);
  });
});
