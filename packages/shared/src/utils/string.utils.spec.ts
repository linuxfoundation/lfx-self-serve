// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { codePointLength, slugify } from './string.utils';

describe('codePointLength', () => {
  it('counts ASCII the same as String.length', () => {
    expect(codePointLength('hello')).toBe(5);
  });

  it('returns 0 for an empty string', () => {
    expect(codePointLength('')).toBe(0);
  });

  it('counts a non-BMP emoji as one code point (String.length counts two UTF-16 units)', () => {
    expect('😀'.length).toBe(2);
    expect(codePointLength('😀')).toBe(1);
  });

  it('measures a repeated emoji by code point, matching the Go rune cap', () => {
    const bio = '😀'.repeat(2000);
    expect(bio.length).toBe(4000);
    expect(codePointLength(bio)).toBe(2000);
  });

  it('counts BMP characters (including surrogate-free CJK) as one each', () => {
    expect(codePointLength('café')).toBe(4);
    expect(codePointLength('日本語')).toBe(3);
  });
});

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
