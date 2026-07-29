// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { slugify } from './string.utils';

describe('slugify', () => {
  it('lowercases and joins words with a single hyphen', () => {
    expect(slugify('Alpha Project')).toBe('alpha-project');
  });

  it('collapses runs of non-alphanumeric characters (including existing hyphens) into one hyphen', () => {
    expect(slugify('Alpha  --  Project!!')).toBe('alpha-project');
  });

  it('trims leading and trailing hyphens produced by leading/trailing punctuation', () => {
    expect(slugify('  Foundation  ')).toBe('foundation');
    expect(slugify('-Other Groups-')).toBe('other-groups');
  });

  it('two labels that differ only in punctuation slugify to the same value (the collision case callers must disambiguate)', () => {
    expect(slugify('Alpha Project')).toBe(slugify('Alpha-Project'));
  });
});
