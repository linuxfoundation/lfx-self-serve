// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildTestDurations, weightDrift } from './refresh-test-durations.mjs';

describe('buildTestDurations', () => {
  it.each([
    ['drops files under 3 s', [{ file: 'a', ms: 2_999 }], {}],
    ['keeps exactly 3 s', [{ file: 'a', ms: 3_000 }], { a: 3 }],
    ['rounds to 0.1 s', [{ file: 'a', ms: 5_735 }], { a: 5.7 }],
    ['keeps the slower of duplicate timings', [{ file: 'a', ms: 4_000 }, { file: 'a', ms: 6_040 }], { a: 6 }],
  ])('%s', (_, timings, expected) => {
    expect(buildTestDurations(timings)).toEqual(expected);
  });

  it('sorts by path', () => {
    expect(Object.keys(buildTestDurations([{ file: 'b', ms: 5_000 }, { file: 'a', ms: 5_000 }]))).toEqual(['a', 'b']);
  });
});

describe('weightDrift', () => {
  it.each([
    ['unchanged', { a: 10 }, { a: 10 }, 0],
    ['one file doubles', { a: 10, b: 10 }, { a: 20, b: 10 }, 0.5],
    ['a file drops under 3 s counts down to one unit', { a: 10, b: 10 }, { b: 10 }, 0.45],
    ['a new slow file counts from one unit', { a: 10 }, { a: 10, b: 3 }, 2 / 11],
    ['empty maps', {}, {}, 0],
  ])('%s', (_, previous, next, expected) => {
    expect(weightDrift(previous, next)).toBeCloseTo(expected);
  });
});
