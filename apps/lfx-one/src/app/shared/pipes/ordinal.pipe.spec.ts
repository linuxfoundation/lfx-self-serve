// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { OrdinalPipe } from './ordinal.pipe';

describe('OrdinalPipe', () => {
  const pipe = new OrdinalPipe();

  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
    [112, '112th'],
  ])('formats %i as %s', (rank, expected) => {
    expect(pipe.transform(rank)).toBe(expected);
  });
});
