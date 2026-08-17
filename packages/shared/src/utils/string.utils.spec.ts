// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { capCodePointEdit, codePointLength, joinAsSentenceList, slugify, splitIntoParagraphs, truncateToUtf16Units } from './string.utils';

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

  it('known limitation: a select-all replace whose paste coincidentally shares a trailing code point can displace one boundary code point', () => {
    // Select-all + over-cap paste of different content that ends like the previous value ('.'). The
    // shared '.' is misread as an unchanged suffix, so the result is first-3-of-paste + '.' ("WXY.")
    // rather than the first 4 code points ("WXYZ"). Documented trade-off — see capCodePointEdit's
    // "Known limitation" note; a faithful fix needs the input's real selection range. The cap itself
    // still holds: the result is always exactly `max` code points.
    const result = capCodePointEdit('abc.', 'WXYZ.', 4);
    expect(result).toBe('WXY.');
    expect(codePointLength(result)).toBe(4);
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

describe('truncateToUtf16Units', () => {
  it('returns the value untouched when it is within the cap', () => {
    expect(truncateToUtf16Units('agenda', 10)).toBe('agenda');
    expect(truncateToUtf16Units('agenda', 6)).toBe('agenda');
  });

  it('clips to exactly the cap in UTF-16 units', () => {
    expect(truncateToUtf16Units('abcdef', 3)).toBe('abc');
    expect(truncateToUtf16Units('x'.repeat(2001), 2000)).toHaveLength(2000);
  });

  it('drops a boundary code unit rather than splitting a surrogate pair', () => {
    // '🎉' is a surrogate pair, so a cap of 3 would otherwise land between its two units.
    const value = `ab🎉cd`;
    const truncated = truncateToUtf16Units(value, 3);

    expect(truncated).toBe('ab');
    // The real guard: no lone surrogate survived the cut.
    expect([...truncated]).toHaveLength(2);
  });

  it('keeps a surrogate pair whole when the cut falls after it', () => {
    expect(truncateToUtf16Units('ab🎉cd', 4)).toBe('ab🎉');
  });

  it('returns an empty string for a non-positive cap', () => {
    expect(truncateToUtf16Units('agenda', 0)).toBe('');
    expect(truncateToUtf16Units('agenda', -5)).toBe('');
  });
});

describe('joinAsSentenceList', () => {
  it('returns a single label unchanged', () => {
    expect(joinAsSentenceList(['Email address'])).toBe('Email address');
  });

  it('joins two labels with a bare and', () => {
    expect(joinAsSentenceList(['Meeting ID', 'Email address'])).toBe('Meeting ID and Email address');
  });

  // The case a plain join(' and ') gets wrong — three items chant instead of reading as a list.
  it('commas all but the last label for three or more', () => {
    expect(joinAsSentenceList(['Meeting ID', 'Email address', 'First name'])).toBe('Meeting ID, Email address and First name');
  });

  it('returns an empty string for no labels', () => {
    expect(joinAsSentenceList([])).toBe('');
  });
});
