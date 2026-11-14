// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { updateTruncatedKeys } from './truncation.util';

const element = (scrollWidth: number, clientWidth: number): HTMLElement => ({ scrollWidth, clientWidth }) as HTMLElement;

describe('updateTruncatedKeys', () => {
  it('adds a key whose label overflows', () => {
    expect([...updateTruncatedKeys(new Set(), 'a', element(200, 100))]).toEqual(['a']);
  });

  it('removes a key whose label fits again', () => {
    expect([...updateTruncatedKeys(new Set(['a', 'b']), 'a', element(100, 100))]).toEqual(['b']);
  });

  it('returns the same set when nothing changed', () => {
    const keys: ReadonlySet<string> = new Set(['a']);
    expect(updateTruncatedKeys(keys, 'a', element(200, 100))).toBe(keys);
    expect(updateTruncatedKeys(keys, 'b', element(50, 100))).toBe(keys);
  });
});
