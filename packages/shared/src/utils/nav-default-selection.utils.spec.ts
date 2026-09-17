// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { shouldSkipNavDefaultSelection } from './nav-default-selection.utils';

describe('shouldSkipNavDefaultSelection', () => {
  it('skips when the existing selection is already on the first page', () => {
    expect(shouldSkipNavDefaultSelection(false, 'group-uid', true)).toBe(true);
    expect(shouldSkipNavDefaultSelection(true, 'group-uid', true)).toBe(true);
  });

  it('skips a ?project= deep link even when the slug is missing from the first page (#2697)', () => {
    expect(shouldSkipNavDefaultSelection(true, 'group-uid', false)).toBe(true);
    expect(shouldSkipNavDefaultSelection(true, null, false)).toBe(true);
  });

  it('skips entity pages that have no ?project= so syncEntityProjectContext is preserved (#960)', () => {
    expect(shouldSkipNavDefaultSelection(false, 'group-uid', false)).toBe(true);
  });

  it('does not skip a context-less overview with no ?project= (persona-priority default applies)', () => {
    expect(shouldSkipNavDefaultSelection(false, null, false)).toBe(false);
    expect(shouldSkipNavDefaultSelection(false, undefined, false)).toBe(false);
    expect(shouldSkipNavDefaultSelection(false, '', false)).toBe(false);
  });
});
