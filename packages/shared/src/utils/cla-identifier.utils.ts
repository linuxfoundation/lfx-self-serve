// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CLA_GROUP_ID_PATTERN } from '../constants/regex.constants';

/**
 * The one spelling of a CLA Group id that two values can be compared in.
 *
 * `CLA_GROUP_ID_PATTERN` accepts hyphenated and unhyphenated forms in either case, because the
 * EasyCLA producer does. That means two strings can name the same CLA Group and still fail `===`,
 * so any comparison has to canonicalise first — lower-cased, hyphens removed. Returns an empty
 * string for anything that is not CLA-Group-shaped, so a malformed value can never canonicalise
 * into an accidental match with another malformed one.
 */
export function canonicalClaGroupId(value: unknown): string {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  if (!CLA_GROUP_ID_PATTERN.test(trimmed)) return '';

  return trimmed.toLowerCase().replaceAll('-', '');
}

/**
 * A CLA Group id in the lower-case hyphenated spelling the producer stores, for an upstream path
 * that the producer matches literally. Empty for anything that is not CLA-Group-shaped.
 */
export function hyphenatedClaGroupId(value: unknown): string {
  const bare = canonicalClaGroupId(value);
  if (!bare) return '';

  return `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`;
}

/**
 * Whether two CLA Group identifiers name the same group, allowing for the spellings the producer
 * accepts. Two unrecognizable values are never "the same": both canonicalise to empty, and an
 * empty canonical form is treated as no answer rather than as a match.
 */
export function isSameClaGroup(left: unknown, right: unknown): boolean {
  const a = canonicalClaGroupId(left);
  return a !== '' && a === canonicalClaGroupId(right);
}
