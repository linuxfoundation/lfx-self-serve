// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { classifyHealthScore, normalizeHealthScoreCategoryV2 } from './insights.utils';

describe('classifyHealthScore', () => {
  it.each([
    [100, 'excellent'],
    [80, 'excellent'],
    [79, 'healthy'],
    [60, 'healthy'],
    [59, 'fair'],
    [40, 'fair'],
    [39, 'concerning'],
    [20, 'concerning'],
    [19, 'critical'],
    [0, 'critical'],
  ] as const)('classifies %i as %s', (score, band) => {
    expect(classifyHealthScore(score)).toBe(band);
  });

  it('places the five bands in a strictly worsening order as the score drops', () => {
    const order = [90, 70, 50, 30, 10].map(classifyHealthScore);
    expect(order).toEqual(['excellent', 'healthy', 'fair', 'concerning', 'critical']);
  });
});

describe('normalizeHealthScoreCategoryV2', () => {
  it.each([
    ['Excellent', 'excellent'],
    ['Healthy', 'healthy'],
    ['Fair', 'fair'],
    ['Concerning', 'concerning'],
    ['Critical', 'critical'],
    ['CRITICAL', 'critical'],
  ] as const)('normalizes %s to %s', (category, band) => {
    expect(normalizeHealthScoreCategoryV2(category)).toBe(band);
  });

  it.each([null, undefined, '', 'Typo', 'unavailable'])('returns null for %s', (category) => {
    expect(normalizeHealthScoreCategoryV2(category)).toBeNull();
  });
});
