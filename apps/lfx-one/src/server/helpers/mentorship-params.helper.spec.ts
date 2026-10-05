// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { escapeMentorshipSearch, findByIdOrSlug, parseMentorshipAdminPaging, parseTrimmedString } from './mentorship-params.helper';

describe('parseTrimmedString', () => {
  it('returns the trimmed value', () => {
    expect(parseTrimmedString('  abc  ')).toBe('abc');
  });

  it('treats a blank string as absent', () => {
    expect(parseTrimmedString('   ')).toBeUndefined();
  });

  it('treats a non-string value as absent', () => {
    expect(parseTrimmedString(undefined)).toBeUndefined();
    expect(parseTrimmedString(['a', 'b'])).toBeUndefined();
    expect(parseTrimmedString(42)).toBeUndefined();
  });
});

describe('findByIdOrSlug', () => {
  const items = [
    { id: 'p-1', slug: 'alpha' },
    { id: 'p-2', slug: 'p-1' },
  ];

  it('finds an item by id', () => {
    expect(findByIdOrSlug(items, 'p-2')).toBe(items[1]);
  });

  it('falls back to the slug when no id matches', () => {
    expect(findByIdOrSlug(items, 'alpha')).toBe(items[0]);
  });

  it('prefers an id match over a slug match', () => {
    expect(findByIdOrSlug(items, 'p-1')).toBe(items[0]);
  });

  it('returns undefined when nothing matches', () => {
    expect(findByIdOrSlug(items, 'missing')).toBeUndefined();
  });
});

describe('escapeMentorshipSearch', () => {
  it('reads blank and non-string input as absent', () => {
    expect(escapeMentorshipSearch('   ')).toBeUndefined();
    expect(escapeMentorshipSearch(undefined)).toBeUndefined();
    expect(escapeMentorshipSearch(['a'])).toBeUndefined();
  });

  it('trims the value', () => {
    expect(escapeMentorshipSearch('  grid  ')).toBe('grid');
  });

  it('cuts the value to 100 characters', () => {
    expect(escapeMentorshipSearch('a'.repeat(150))).toBe('a'.repeat(100));
  });

  it('escapes backslash, percent and underscore', () => {
    expect(escapeMentorshipSearch('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});

describe('parseMentorshipAdminPaging', () => {
  const options = { defaultLimit: 12, maxLimit: 50 };

  it('defaults offset to 0 and limit to the default', () => {
    expect(parseMentorshipAdminPaging({}, options)).toEqual({ offset: 0, limit: 12 });
  });

  it('reads whole-number offset and limit', () => {
    expect(parseMentorshipAdminPaging({ offset: '24', limit: '50' }, options)).toEqual({ offset: 24, limit: 50 });
  });

  it('rejects a non-integer value with a 400', () => {
    expect(() => parseMentorshipAdminPaging({ offset: 'abc' }, options)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseMentorshipAdminPaging({ limit: '1.5' }, options)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseMentorshipAdminPaging({ offset: '-1' }, options)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects a limit above the maximum or below 1 with a 400', () => {
    expect(() => parseMentorshipAdminPaging({ limit: '51' }, options)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => parseMentorshipAdminPaging({ limit: '0' }, options)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
