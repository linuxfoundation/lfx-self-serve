// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_CLA_AUTHORITY_NAME_MAX_LENGTH, ORG_CLA_AUTHORITY_NAME_MIN_LENGTH } from '../constants/cla.constants';
import { isSendableAuthorityName } from './org-cla-signatory.utils';

describe('isSendableAuthorityName', () => {
  it('accepts an ordinary signatory name', () => {
    expect(isSendableAuthorityName('Alex Contributor')).toBe(true);
  });

  it('refuses a blank', () => {
    expect(isSendableAuthorityName('')).toBe(false);
  });

  /**
   * The producer declares `minLength: 2` on `authority_name` while its handler only refuses a
   * blank, so one character is refused upstream by generated request validation at a status the
   * BFF does not relabel — a generic failure with no field named. This is the gate that keeps
   * that request from being sent at all.
   */
  it('refuses a single character, which the producer would reject upstream', () => {
    expect(isSendableAuthorityName('A')).toBe(false);
  });

  it('accepts the minimum exactly', () => {
    expect(isSendableAuthorityName('A'.repeat(ORG_CLA_AUTHORITY_NAME_MIN_LENGTH))).toBe(true);
  });

  it('accepts the maximum exactly and refuses one past it', () => {
    expect(isSendableAuthorityName('A'.repeat(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH))).toBe(true);
    expect(isSendableAuthorityName('A'.repeat(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH + 1))).toBe(false);
  });

  /**
   * Trimming belongs to the caller, and both call sites do it to build the request. A predicate
   * that trimmed here would answer for a string neither of them is sending.
   */
  it('measures what it is given, leaving the trim to the caller', () => {
    expect(isSendableAuthorityName(' A')).toBe(true);
    expect(isSendableAuthorityName('A '.trim())).toBe(false);
  });

  /**
   * The producer counts runes (go-openapi's `MinLength` uses `utf8.RuneCount`), so a
   * `String.length` check disagrees with it on any non-BMP character. `𠮷` is one rune and two
   * UTF-16 units: counting units would pass it here and let upstream reject it, which is the
   * generic-failure dead end this predicate exists to close.
   */
  it('counts a one-code-point non-BMP name as one, matching the producer rune count', () => {
    expect('𠮷'.length).toBe(2);

    expect(isSendableAuthorityName('𠮷')).toBe(false);
  });

  it('accepts a two-code-point non-BMP name', () => {
    expect(isSendableAuthorityName('𠮷𠮷')).toBe(true);
  });

  /**
   * The upper bound is measured the same way, for one source of truth. It cannot admit anything
   * upstream refuses: a UTF-16 count is never below a rune count, so the producer's 255-rune cap
   * has room for 200 code points whatever they are.
   */
  it('accepts the maximum in non-BMP code points', () => {
    const name = '😀'.repeat(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH);

    expect(name.length).toBe(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH * 2);
    expect(isSendableAuthorityName(name)).toBe(true);
    expect(isSendableAuthorityName(`${name}😀`)).toBe(false);
  });
});
