// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { capCodePointEdit, codePointLength, slugify, splitIntoParagraphs, toValidUuid, truncateSlug } from './string.utils';

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

  it('strips diacritics rather than dropping the accented letters entirely', () => {
    expect(slugify('Événements')).toBe('evenements');
    expect(slugify('Café Münchën')).toBe('cafe-munchen');
  });

  it('still collapses to empty for scripts with no Latin-equivalent decomposition (no transliteration)', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('Мой дайджест')).toBe('');
  });

  it('NFKD-expanding characters can derive a slug longer than the input text (the case truncateSlug exists for)', () => {
    // A single-codepoint ligature decomposes to two letters under NFKD, so
    // 60 input characters can derive a 120-character slug.
    const name = 'ﬁ'.repeat(60);
    expect(name.length).toBe(60);
    expect(slugify(name).length).toBe(120);
  });
});

describe('truncateSlug', () => {
  it('leaves a slug under the limit untouched', () => {
    expect(truncateSlug('weekly-digest', 100)).toBe('weekly-digest');
  });

  it('cuts a slug down to the limit', () => {
    expect(truncateSlug('a'.repeat(150), 100)).toBe('a'.repeat(100));
  });

  it('re-trims a trailing hyphen the cut exposes', () => {
    // Cutting 'abc-def' to 4 chars lands right after the hyphen ('abc-'),
    // which a plain slice() would leave dangling.
    expect(truncateSlug('abc-def', 4)).toBe('abc');
  });

  it('produces output matching the upstream slug pattern for an NFKD-expanded slug at the real 100-char cap', () => {
    const expanded = slugify('ﬁ'.repeat(60)); // 120 chars, all [a-z] (no hyphens introduced)
    const truncated = truncateSlug(expanded, 100);
    expect(truncated.length).toBe(100);
    expect(truncated).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
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

describe('toValidUuid', () => {
  const UUID = '11111111-1111-1111-1111-111111111111';

  it('returns the value unchanged when it is a canonical UUID', () => {
    expect(toValidUuid(UUID)).toBe(UUID);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(toValidUuid(`  ${UUID}  `)).toBe(UUID);
  });

  it('returns undefined for null', () => {
    expect(toValidUuid(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(toValidUuid(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(toValidUuid('')).toBeUndefined();
  });

  it('returns undefined for a whitespace-only string', () => {
    expect(toValidUuid('   ')).toBeUndefined();
  });

  it('returns undefined for a non-UUID string', () => {
    expect(toValidUuid('not-a-uuid')).toBeUndefined();
  });

  it('returns undefined for a non-canonical form uuid.Parse would accept (urn: prefix)', () => {
    expect(toValidUuid(`urn:uuid:${UUID}`)).toBeUndefined();
  });

  it('is case-insensitive, matching isUuid', () => {
    expect(toValidUuid(UUID.toUpperCase())).toBe(UUID.toUpperCase());
  });
});
