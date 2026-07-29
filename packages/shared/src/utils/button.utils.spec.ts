// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { resolveAriaPressedPt } from './button.utils';

describe('resolveAriaPressedPt', () => {
  it('returns undefined (no pt object) when pressed is unset — the ordinary-button case', () => {
    expect(resolveAriaPressedPt(undefined)).toBeUndefined();
  });

  it('returns a pt object with aria-pressed=true when pressed', () => {
    expect(resolveAriaPressedPt(true)).toEqual({ root: { 'aria-pressed': true } });
  });

  it('returns a pt object with aria-pressed=false when explicitly not pressed', () => {
    expect(resolveAriaPressedPt(false)).toEqual({ root: { 'aria-pressed': false } });
  });
});
