// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { canonicalClaGroupId, isSameClaGroup } from './cla-identifier.utils';

const HYPHENATED = '01234567-89ab-cdef-0123-456789abcdef';
const BARE = '0123456789abcdef0123456789abcdef';

describe('canonicalClaGroupId', () => {
  it.each([
    [HYPHENATED, BARE],
    [HYPHENATED.toUpperCase(), BARE],
    [BARE, BARE],
    [`  ${HYPHENATED}  `, BARE],
  ])('canonicalises %p', (input, expected) => {
    expect(canonicalClaGroupId(input)).toBe(expected);
  });

  // An empty canonical form is the "no answer" value the comparison relies on, so anything that is
  // not CLA-Group-shaped has to reach it rather than pass through as itself.
  it.each([[''], ['   '], ['not-a-uuid'], ['0123456789abcdef0123456789abcde'], [null], [undefined], [42], [{}]])('rejects %p', (input) => {
    expect(canonicalClaGroupId(input)).toBe('');
  });
});

describe('isSameClaGroup', () => {
  // The case this exists for: the request carries one accepted spelling and the producer answers in
  // its own. Comparing raw is what made a valid signing session look like a mismatch.
  it.each([
    [HYPHENATED, BARE],
    [HYPHENATED, HYPHENATED.toUpperCase()],
    [BARE.toUpperCase(), HYPHENATED],
  ])('treats %p and %p as the same group', (left, right) => {
    expect(isSameClaGroup(left, right)).toBe(true);
  });

  it('distinguishes genuinely different groups', () => {
    expect(isSameClaGroup(HYPHENATED, 'fedcba98-7654-3210-fedc-ba9876543210')).toBe(false);
  });

  // Two values that cannot be read are not evidence of a match. Folding them together would make
  // the mismatch guard pass on exactly the input it is least able to vouch for.
  it.each([
    ['', ''],
    ['nonsense', 'nonsense'],
    [null, null],
    [undefined, undefined],
  ])('does not call %p and %p the same group', (left, right) => {
    expect(isSameClaGroup(left, right)).toBe(false);
  });
});
