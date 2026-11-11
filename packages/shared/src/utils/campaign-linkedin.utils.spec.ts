// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { LINKEDIN_CHAR_LIMITS } from '../constants/campaign.constants';
import { linkedInCreativeTextLength, linkedInVariantTextError, normalizeLinkedInCreativeText } from './campaign-linkedin.utils';

describe('normalizeLinkedInCreativeText', () => {
  it('trims and turns em and en dashes into commas, as campaign-service does', () => {
    expect(normalizeLinkedInCreativeText('  Join us — in Paris  ')).toBe('Join us, in Paris');
    expect(normalizeLinkedInCreativeText('Paris–Berlin')).toBe('Paris, Berlin');
  });

  it('drops one leading and one trailing ", " left by a dash at either end', () => {
    expect(normalizeLinkedInCreativeText('— Register now —')).toBe('Register now');
  });

  it('normalizes a dash-only value to empty', () => {
    expect(normalizeLinkedInCreativeText(' — ')).toBe('');
  });
});

describe('linkedInCreativeTextLength', () => {
  it('counts code points, so an emoji is one character', () => {
    expect(linkedInCreativeTextLength('Hi 👋')).toBe(4);
  });

  it('counts a dash as the two characters it becomes', () => {
    expect(linkedInCreativeTextLength('a—b')).toBe(4);
  });
});

describe('linkedInVariantTextError', () => {
  it('asks for copy that is blank, or dash-only, after normalization', () => {
    expect(linkedInVariantTextError('introText', '   ')).toBe('Enter the intro text.');
    expect(linkedInVariantTextError('headline', '—')).toBe('Enter the headline.');
  });

  it('accepts copy at the limit and refuses one character over it', () => {
    expect(linkedInVariantTextError('introText', 'a'.repeat(LINKEDIN_CHAR_LIMITS.introText))).toBeNull();
    expect(linkedInVariantTextError('introText', 'a'.repeat(LINKEDIN_CHAR_LIMITS.introText + 1))).toBe(
      "The intro text is 601 characters, over LinkedIn's 600. Shorten it."
    );
    expect(linkedInVariantTextError('headline', 'a'.repeat(LINKEDIN_CHAR_LIMITS.headline))).toBeNull();
    expect(linkedInVariantTextError('headline', 'a'.repeat(LINKEDIN_CHAR_LIMITS.headline + 1))).toBe(
      "The headline is 201 characters, over LinkedIn's 200. Shorten it."
    );
  });

  it('judges the normalized text, so surrounding spaces do not count', () => {
    expect(linkedInVariantTextError('headline', `  ${'a'.repeat(LINKEDIN_CHAR_LIMITS.headline)}  `)).toBeNull();
  });

  it("trims Go's whitespace set, not JavaScript's: U+0085 is trimmed and U+FEFF is kept", () => {
    expect(linkedInVariantTextError('headline', '\u0085')).toBe('Enter the headline.');
    expect(linkedInVariantTextError('headline', `\u0085${'a'.repeat(LINKEDIN_CHAR_LIMITS.headline)}\u3000`)).toBeNull();
    expect(linkedInVariantTextError('headline', `\uFEFF${'a'.repeat(LINKEDIN_CHAR_LIMITS.headline)}`)).toBe(
      "The headline is 201 characters, over LinkedIn's 200. Shorten it."
    );
  });
});
