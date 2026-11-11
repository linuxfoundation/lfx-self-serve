// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** `char.length`: UTF-16 units, the count `String.slice` cuts by. */
const utf16Width = (char: string): number => char.length;

/** Scripts written without spaces between words, where a cut between any two characters is a word boundary. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Characters a cut line must not end on: a joiner or separator that promises more text after it. A
 * `+` counts only as a standalone token ("Kubernetes +"); attached to a word it is part of the name,
 * as in `C++`, and stays.
 */
const DANGLING_TAIL = /(?:[\s&,;:/|\\\-–—([{·•]|(?:^|\s)\++)$/u;

/** English words a cut line must not end on, because they only make sense before another word. */
const DANGLING_WORD = /(^|\s)(and|or|with|for|the|a|an|to|of|in|at|on|by|from|plus|your|our)$/iu;

/**
 * Fit one line of generated ad copy within `maxWidth`, cutting on a word boundary rather than
 * mid-word (#5378). A line that already fits is returned unchanged.
 *
 * A longer line is cut at the last whole word that fits. When no space falls inside the width (one
 * unbroken word, or a script written without spaces such as Chinese or Japanese), the cut is made
 * between characters instead, since that is the only boundary there is. The cut line then loses any
 * trailing joiner, separator or connective word ("&", ",", "-", "and", "with") so it never ends on a
 * word that promises more. Returns `''` when nothing is left.
 *
 * `charWidth` measures each character: UTF-16 units by default, the count `String.slice` cuts by, or
 * a platform's own count such as Google's display width (`googleAdsTextWeight`, where CJK and
 * full-width characters count double). Every width the platforms use is a sum of per-character
 * widths, so one cut serves them all.
 */
export function fitAdCopyToWidth(text: string, maxWidth: number, charWidth: (char: string) => number = utf16Width): string {
  const chars = [...text];
  let width = 0;
  let fit = 0;
  for (const char of chars) {
    width += charWidth(char);
    if (width > maxWidth) break;
    fit += 1;
  }
  if (fit === chars.length) return text;

  let cut = chars.slice(0, fit).join('');
  const next = chars[fit] ?? '';
  const last = chars[fit - 1] ?? '';
  const atBoundary = /\s/u.test(next) || /\s/u.test(last) || UNSPACED_SCRIPT.test(next) || UNSPACED_SCRIPT.test(last);
  if (!atBoundary) {
    const space = cut.search(/\s\S*$/u);
    if (space > 0) cut = cut.slice(0, space);
  }

  let previous: string;
  do {
    previous = cut;
    cut = cut.replace(DANGLING_TAIL, '').replace(DANGLING_WORD, '').trimEnd();
  } while (cut !== previous && cut !== '');
  return cut.trim();
}
