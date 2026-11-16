// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { toSpokenKey, toSpokenKeys } from './keyboard.utils';

describe('toSpokenKey', () => {
  it.each([
    ['⌘', 'Command'],
    ['⇧', 'Shift'],
    ['⌥', 'Option'],
    ['⌃', 'Control'],
    ['↵', 'Enter'],
    ['⏎', 'Enter'],
    ['⌫', 'Delete'],
    ['⎋', 'Escape'],
    ['⇥', 'Tab'],
    ['←', 'Left arrow'],
    ['→', 'Right arrow'],
    ['↑', 'Up arrow'],
    ['↓', 'Down arrow'],
  ])('speaks %s as %s', (glyph, spoken) => {
    expect(toSpokenKey(glyph)).toBe(spoken);
  });

  it('translates each glyph of a chord written as one key', () => {
    expect(toSpokenKey('⌘K')).toBe('Command K');
    expect(toSpokenKey('⇧⌘P')).toBe('Shift Command P');
  });

  it('returns an empty string for a key with no glyph', () => {
    expect(toSpokenKey('K')).toBe('');
    expect(toSpokenKey('Esc')).toBe('');
    expect(toSpokenKey('')).toBe('');
  });
});

describe('toSpokenKeys', () => {
  it('joins the spoken keys with spaces', () => {
    expect(toSpokenKeys(['⌘', 'C'])).toBe('Command C');
    expect(toSpokenKeys(['⇧', '⇥'])).toBe('Shift Tab');
  });

  it('handles chords and plain keys together', () => {
    expect(toSpokenKeys(['⌘K'])).toBe('Command K');
    expect(toSpokenKeys(['Esc'])).toBe('Esc');
  });

  it('is empty for no keys', () => {
    expect(toSpokenKeys([])).toBe('');
  });
});
