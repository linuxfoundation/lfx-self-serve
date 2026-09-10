// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isPartialHealthScore, normalizeHealthScoreCategoryV2 } from './insights.utils';

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
