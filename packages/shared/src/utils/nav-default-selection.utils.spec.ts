// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { shouldSkipNavDefaultSelection } from './nav-default-selection.utils';

describe('shouldSkipNavDefaultSelection', () => {
  it('skips when an existing context is already set (#960)', () => {
    expect(shouldSkipNavDefaultSelection(false, 'group-uid')).toBe(true);
    expect(shouldSkipNavDefaultSelection(true, 'group-uid')).toBe(true);
  });

  it('skips a non-empty ?project= deep link even with no existing context (#2697)', () => {
    expect(shouldSkipNavDefaultSelection(true, null)).toBe(true);
    expect(shouldSkipNavDefaultSelection(true, undefined)).toBe(true);
    expect(shouldSkipNavDefaultSelection(true, '')).toBe(true);
  });

  it('does not skip a context-less overview with no explicit slug (persona-priority default applies)', () => {
    expect(shouldSkipNavDefaultSelection(false, null)).toBe(false);
    expect(shouldSkipNavDefaultSelection(false, undefined)).toBe(false);
    expect(shouldSkipNavDefaultSelection(false, '')).toBe(false);
  });
});
