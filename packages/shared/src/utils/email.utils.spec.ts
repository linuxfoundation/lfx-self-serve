// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { emailsEqual, isMeetingInvitePrimarySentinel, isValidEmail, parseEmailList, redactEmailAddresses } from './email.utils';

describe('isValidEmail', () => {
  it('accepts a well-formed address', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
  });

  it('trims surrounding whitespace before testing', () => {
    expect(isValidEmail('  alice@example.com  ')).toBe(true);
  });

  it.each([['no-at'], ['missing@tld'], ['@example.com'], ['alice@'], ['a b@example.com'], ['']])('rejects %p', (value) => {
    expect(isValidEmail(value)).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});

describe('parseEmailList', () => {
  it('returns empty buckets for empty/nullish input', () => {
    expect(parseEmailList('')).toEqual({ valid: [], invalid: [], duplicates: [] });
    expect(parseEmailList(null)).toEqual({ valid: [], invalid: [], duplicates: [] });
    expect(parseEmailList(undefined)).toEqual({ valid: [], invalid: [], duplicates: [] });
  });

  it('splits on commas, semicolons, whitespace, and newlines', () => {
    const raw = 'a@example.com, b@example.com; c@example.com\nd@example.com\te@example.com';
    expect(parseEmailList(raw).valid).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com']);
  });

  it('normalizes to lowercase and trims each token', () => {
    expect(parseEmailList('  Alice@Example.COM ').valid).toEqual(['alice@example.com']);
  });

  it('de-duplicates case-insensitively, preserving first-seen order, and reports each dup once', () => {
    const result = parseEmailList('alice@example.com, ALICE@example.com, bob@example.com, alice@example.com');
    expect(result.valid).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.duplicates).toEqual(['alice@example.com']);
  });

  it('collects invalid tokens separately with original casing and keeps valid ones', () => {
    const result = parseEmailList('Good@Example.com, not-an-email, also bad@, real@corp.io');
    expect(result.valid).toEqual(['good@example.com', 'real@corp.io']);
    expect(result.invalid).toEqual(['not-an-email', 'also', 'bad@']);
  });

  it('ignores empty tokens produced by trailing/duplicate separators', () => {
    expect(parseEmailList(',,a@example.com,,\n\n').valid).toEqual(['a@example.com']);
  });
});

describe('emailsEqual', () => {
  it('matches identical addresses', () => {
    expect(emailsEqual('alice@example.com', 'alice@example.com')).toBe(true);
  });

  it('ignores casing differences between upstreams', () => {
    expect(emailsEqual('Alice@Example.COM', 'alice@example.com')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(emailsEqual('  alice@example.com ', 'alice@example.com')).toBe(true);
  });

  it('rejects different addresses', () => {
    expect(emailsEqual('alice@example.com', 'bob@example.com')).toBe(false);
  });

  it.each([
    [null, 'alice@example.com'],
    ['alice@example.com', null],
    [undefined, undefined],
    ['', ''],
  ])('returns false when either side is missing (%p, %p)', (a, b) => {
    expect(emailsEqual(a, b)).toBe(false);
  });
});

describe('redactEmailAddresses', () => {
  it('replaces a single embedded address', () => {
    expect(redactEmailAddresses('alice@example.com is not an active, verified address')).toBe('[redacted-email] is not an active, verified address');
  });

  it('replaces every address when more than one is embedded', () => {
    expect(redactEmailAddresses('alice@example.com and bob@example.com both failed')).toBe('[redacted-email] and [redacted-email] both failed');
  });

  it('leaves text unchanged when no address is present', () => {
    expect(redactEmailAddresses('something else broke')).toBe('something else broke');
  });

  it.each([
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('returns an empty string for %p', (value, expected) => {
    expect(redactEmailAddresses(value)).toBe(expected);
  });
});

describe('isMeetingInvitePrimarySentinel', () => {
  it('recognizes the sentinel', () => {
    expect(isMeetingInvitePrimarySentinel('primary')).toBe(true);
  });

  it.each(['Primary', 'PRIMARY', '  primary  '])('matches upstream case-insensitively and trims (%p)', (value) => {
    expect(isMeetingInvitePrimarySentinel(value)).toBe(true);
  });

  it.each(['primary@example.com', 'alice@example.com', '', null, undefined])('rejects anything else (%p)', (value) => {
    expect(isMeetingInvitePrimarySentinel(value)).toBe(false);
  });
});
