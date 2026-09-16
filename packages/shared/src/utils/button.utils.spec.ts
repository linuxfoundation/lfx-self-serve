// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { resolveButtonAriaPt } from './button.utils';

describe('resolveButtonAriaPt', () => {
  it('returns undefined (no pt object) when all three are unset — the ordinary-button case', () => {
    expect(resolveButtonAriaPt(undefined, undefined, undefined)).toBeUndefined();
  });

  it('returns a pt object with aria-pressed only when the others are unset', () => {
    expect(resolveButtonAriaPt(true, undefined, undefined)).toEqual({ root: { 'aria-pressed': true } });
    expect(resolveButtonAriaPt(false, undefined, undefined)).toEqual({ root: { 'aria-pressed': false } });
  });

  it('returns a pt object with aria-expanded only when the others are unset', () => {
    expect(resolveButtonAriaPt(undefined, true, undefined)).toEqual({ root: { 'aria-expanded': true } });
    expect(resolveButtonAriaPt(undefined, false, undefined)).toEqual({ root: { 'aria-expanded': false } });
  });

  it('returns a pt object with aria-haspopup only when the others are unset', () => {
    expect(resolveButtonAriaPt(undefined, undefined, 'menu')).toEqual({ root: { 'aria-haspopup': 'menu' } });
  });

  it('merges pressed and expanded into one root object when both are set', () => {
    expect(resolveButtonAriaPt(true, false, undefined)).toEqual({ root: { 'aria-pressed': true, 'aria-expanded': false } });
  });

  it('merges all three attributes into one root object when all are set', () => {
    expect(resolveButtonAriaPt(true, false, 'menu')).toEqual({ root: { 'aria-pressed': true, 'aria-expanded': false, 'aria-haspopup': 'menu' } });
  });

  // A menu trigger sets `aria-haspopup` on its own, without a toggle or a disclosure state, so the
  // popup kind has to be enough on its own to produce a `pt` object.
  it('returns a pt object with aria-haspopup only when it is the only one set', () => {
    expect(resolveButtonAriaPt(undefined, undefined, 'menu')).toEqual({ root: { 'aria-haspopup': 'menu' } });
  });

  it('merges the popup kind alongside the disclosure state a menu trigger also carries', () => {
    expect(resolveButtonAriaPt(undefined, true, 'menu')).toEqual({ root: { 'aria-expanded': true, 'aria-haspopup': 'menu' } });
  });

  it('still returns undefined when only the popup kind is left off', () => {
    expect(resolveButtonAriaPt(undefined, undefined, undefined)).toBeUndefined();
  });
});
