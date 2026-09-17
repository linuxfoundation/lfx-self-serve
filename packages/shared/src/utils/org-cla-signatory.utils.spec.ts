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
});
