// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isValidEmail, parseEmailList } from './email.utils';

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
