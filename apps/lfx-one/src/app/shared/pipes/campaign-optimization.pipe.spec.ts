// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { AdsCurrencyPipe } from './campaign-optimization.pipe';

describe('AdsCurrencyPipe', () => {
  const pipe = new AdsCurrencyPipe();

  it('prints dollars, two decimals, by default', () => {
    expect(pipe.transform(1234.5)).toBe('$1,234.50');
  });

  /** A connected account's own, unnamed currency (#4807) prints without a symbol rather than as dollars. */
  it("prints a connected account's amount without a symbol", () => {
    expect(pipe.transform(1234.5, true)).toBe('1,234.50');
  });
});
