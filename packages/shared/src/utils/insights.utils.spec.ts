// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { classifyHealthScore, isPartialHealthScore, normalizeHealthScoreCategoryV2 } from './insights.utils';

describe('classifyHealthScore', () => {
  it.each([
    [100, 'excellent'],
    [85, 'excellent'],
    [84, 'healthy'],
    [70, 'healthy'],
    [69, 'fair'],
    [50, 'fair'],
    [49, 'concerning'],
    [30, 'concerning'],
    [29, 'critical'],
    [0, 'critical'],
  ] as const)('classifies %i as %s', (score, band) => {
    expect(classifyHealthScore(score)).toBe(band);
  });

  it('places the five bands in a strictly worsening order as the score drops', () => {
    const order = [90, 70, 50, 30, 10].map(classifyHealthScore);
    expect(order).toEqual(['excellent', 'healthy', 'fair', 'concerning', 'critical']);
  });
});

describe('isPartialHealthScore', () => {
  it.each([
    [2, true],
    [3, false],
    [1, false],
    [0, false],
    [null, false],
  ] as const)('returns %s for coveredCategoryCount %s', (coveredCategoryCount, expected) => {
    expect(isPartialHealthScore(coveredCategoryCount)).toBe(expected);
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
