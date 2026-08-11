// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { slugify, splitIntoParagraphs } from './string.utils';

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

describe('splitIntoParagraphs', () => {
  it('returns a single paragraph when the text has no blank lines', () => {
    expect(splitIntoParagraphs('First line\nsecond line')).toEqual(['First line\nsecond line']);
  });

  it('splits paragraphs on blank lines', () => {
    expect(splitIntoParagraphs('First paragraph.\n\nSecond paragraph.')).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('treats lines containing only spaces or tabs as blank', () => {
    expect(splitIntoParagraphs('First.\n \t \nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('collapses three or more consecutive line breaks into a single paragraph split', () => {
    expect(splitIntoParagraphs('First.\n\n\n\nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('handles Windows-style CRLF line endings', () => {
    expect(splitIntoParagraphs('First.\r\n\r\nSecond.')).toEqual(['First.', 'Second.']);
  });

  it('trims each paragraph and drops empty results', () => {
    expect(splitIntoParagraphs('  First.  \n\n   \n\n  Second.  ')).toEqual(['First.', 'Second.']);
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(splitIntoParagraphs('')).toEqual([]);
    expect(splitIntoParagraphs('  \n\n  ')).toEqual([]);
  });
});
