// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { findByIdOrSlug, parseTrimmedString } from './mentorship-params.helper';

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
