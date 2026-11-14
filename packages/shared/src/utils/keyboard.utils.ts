// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The spoken form of one key written with glyphs, or an empty string when it has none. Screen readers skip or misread glyphs such as ⌘,
 * so `'⌘K'` becomes "Command K" and `'⇧'` becomes "Shift". Each character is translated on its own, so a chord in one entry works.
 */
export function toSpokenKey(key: string): string {
  const names: Record<string, string> = {
    '⌘': 'Command',
    '⇧': 'Shift',
    '⌥': 'Option',
    '⌃': 'Control',
    '↵': 'Enter',
    '⏎': 'Enter',
    '⌫': 'Delete',
    '⎋': 'Escape',
    '⇥': 'Tab',
    '←': 'Left arrow',
    '→': 'Right arrow',
    '↑': 'Up arrow',
    '↓': 'Down arrow',
  };
  const chars = Array.from(key);
  return chars.some((char) => names[char]) ? chars.map((char) => names[char] ?? char).join(' ') : '';
}

/** The spoken form of a shortcut, such as "Command C" for `['⌘', 'C']`. Keys without glyphs are kept as written. */
export function toSpokenKeys(keys: string[]): string {
  return keys.map((key) => toSpokenKey(key) || key).join(' ');
}
