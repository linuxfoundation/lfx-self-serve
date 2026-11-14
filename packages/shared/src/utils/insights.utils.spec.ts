// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildHealthAriaLabel, formatHealthLabel, isPartialHealthScore, normalizeHealthScoreCategoryV2 } from './insights.utils';

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

describe('formatHealthLabel', () => {
  it.each([
    ['Excellent', true, 'Excellent*'],
    ['Healthy', true, 'Healthy*'],
    ['Fair', true, 'Fair*'],
    ['Concerning', true, 'Concerning*'],
    ['Critical', true, 'Critical*'],
    ['Healthy', false, 'Healthy'],
    ['Unavailable', false, 'Unavailable'],
  ] as const)('formats %s with partial=%s as %s', (label, partial, expected) => {
    expect(formatHealthLabel(label, partial)).toBe(expected);
  });
});

describe('buildHealthAriaLabel', () => {
  const partial = {
    label: 'healthy',
    score: 52,
    maxScore: 65,
    coveredCount: 2,
    maintainer: 30,
    security: null,
    development: 22,
  } as const;

  it('spells a partial score out in words, with the score out of its capped max and a dash for the missing category', () => {
    expect(buildHealthAriaLabel(partial)).toBe(
      'Health: Healthy, partial score (52/65). Maintainer Health 30/40, Security & Supply Chain -/35, Development Activity 22/25.'
    );
  });

  it('names a full score by its band alone', () => {
    expect(buildHealthAriaLabel({ label: 'excellent', score: 88, maxScore: 100, coveredCount: 3, maintainer: 35, security: 30, development: 23 })).toBe(
      'Health: Excellent (88/100). Maintainer Health 35/40, Security & Supply Chain 30/35, Development Activity 23/25.'
    );
  });

  it('never reads out an asterisk or the retired suffix wording', () => {
    const aria = buildHealthAriaLabel(partial);

    expect(aria).not.toContain('*');
    expect(aria).not.toContain('- Partial');
  });

  it.each([
    { name: 'a null label', args: { ...partial, label: null } },
    { name: 'a null score', args: { ...partial, score: null } },
    { name: 'a null label and score', args: { ...partial, label: null, score: null } },
  ])('renders only "Health: Unavailable." for $name, even when the covered count is 2', ({ args }) => {
    expect(buildHealthAriaLabel(args)).toBe('Health: Unavailable.');
  });

  it('falls back to a max of 100 when the max score is missing', () => {
    expect(buildHealthAriaLabel({ ...partial, maxScore: null, coveredCount: 3 })).toContain('Health: Healthy (52/100).');
  });

  it('dashes every missing category, including on a full score, but keeps a real zero', () => {
    const aria = buildHealthAriaLabel({ label: 'critical', score: 10, maxScore: 100, coveredCount: 3, maintainer: 0, security: null, development: null });

    expect(aria).toBe('Health: Critical (10/100). Maintainer Health 0/40, Security & Supply Chain -/35, Development Activity -/25.');
  });

  it.each([null, 3, 1, 0])('does not call the score partial for a covered count of %s', (coveredCount) => {
    expect(buildHealthAriaLabel({ ...partial, coveredCount })).toContain('Health: Healthy (52/65).');
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
