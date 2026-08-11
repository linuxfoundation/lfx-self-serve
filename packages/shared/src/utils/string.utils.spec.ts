// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { capCodePointEdit, codePointLength, slugify } from './string.utils';

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

describe('capCodePointEdit', () => {
  it('returns the value unchanged when within the cap', () => {
    expect(capCodePointEdit('ab', 'abc', 5)).toBe('abc');
  });

  it('clips an over-cap paste into an empty field to exactly max code points', () => {
    expect(capCodePointEdit('', '😀'.repeat(2001), 2000)).toBe('😀'.repeat(2000));
  });

  it('drops the inserted char, not trailing content, when inserting at the start of a full field', () => {
    const full = 'a'.repeat(2000);
    // Insert 'z' at the front → 'z' + 2000 a's; the excess 'z' is rejected, the 2000 a's are kept.
    expect(capCodePointEdit(full, `z${full}`, 2000)).toBe(full);
  });

  it('drops the inserted run in the middle, preserving the head and tail', () => {
    // previous = "aaXbb" style: insert a long run between head and tail of a full value.
    const previous = `${'a'.repeat(1000)}${'b'.repeat(1000)}`;
    const next = `${'a'.repeat(1000)}${'x'.repeat(50)}${'b'.repeat(1000)}`;
    expect(capCodePointEdit(previous, next, 2000)).toBe(previous);
  });

  it('rejects an over-cap append, keeping the existing content', () => {
    const full = '😀'.repeat(2000);
    expect(capCodePointEdit(full, `${full}😀`, 2000)).toBe(full);
  });

  it('counts by code point so the clip lands on a whole emoji, never a lone surrogate', () => {
    const result = capCodePointEdit('', '😀'.repeat(2001), 2000);
    expect(codePointLength(result)).toBe(2000);
    expect(result.endsWith('😀')).toBe(true);
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
