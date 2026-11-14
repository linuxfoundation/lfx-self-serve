// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { mapYearLabelToNumber } from './public-profile.utils';

describe('mapYearLabelToNumber', () => {
  it('resolves the upstream relative labels against the current year', () => {
    expect(mapYearLabelToNumber('current_year', 2026)).toBe(2026);
    expect(mapYearLabelToNumber('last_year', 2026)).toBe(2025);
    expect(mapYearLabelToNumber('2nd_last_year', 2026)).toBe(2024);
    expect(mapYearLabelToNumber('3rd_last_year', 2026)).toBe(2023);
    expect(mapYearLabelToNumber('4th_last_year', 2026)).toBe(2022);
  });

  it('accepts a four-digit year string', () => {
    expect(mapYearLabelToNumber('2021', 2026)).toBe(2021);
  });

  it('returns undefined for unknown or non-string labels so the row is dropped', () => {
    expect(mapYearLabelToNumber('2021-06-30', 2026)).toBeUndefined();
    expect(mapYearLabelToNumber('all-time', 2026)).toBeUndefined();
    expect(mapYearLabelToNumber('', 2026)).toBeUndefined();
    expect(mapYearLabelToNumber(undefined, 2026)).toBeUndefined();
    expect(mapYearLabelToNumber(2026, 2026)).toBeUndefined();
  });
});
