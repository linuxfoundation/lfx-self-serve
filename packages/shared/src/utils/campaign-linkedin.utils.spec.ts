// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { LINKEDIN_CHAR_LIMITS } from '../constants/campaign.constants';
import type { LinkedInTargetingProfileConfig } from '../interfaces/campaign.interface';
import {
  linkedInCreativeTextLength,
  linkedInTargetingAfterRemovals,
  linkedInVariantTextError,
  normalizeLinkedInCreativeText,
  resolveLinkedInTargetingProfileId,
  roundUsdToCentsLikeGo,
} from './campaign-linkedin.utils';

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

  it('trims a long run of whitespace in linear time', () => {
    const started = Date.now();
    expect(linkedInVariantTextError('headline', `a${'\t'.repeat(100_000)}a`)).toBe("The headline is 100002 characters, over LinkedIn's 200. Shorten it.");
    expect(linkedInVariantTextError('headline', `${'\t'.repeat(100_000)}a`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("trims Go's whitespace set, not JavaScript's: U+0085 is trimmed and U+FEFF is kept", () => {
    expect(linkedInVariantTextError('headline', '\u0085')).toBe('Enter the headline.');
    expect(linkedInVariantTextError('headline', `\u0085${'a'.repeat(LINKEDIN_CHAR_LIMITS.headline)}\u3000`)).toBeNull();
    expect(linkedInVariantTextError('headline', `\uFEFF${'a'.repeat(LINKEDIN_CHAR_LIMITS.headline)}`)).toBe(
      "The headline is 201 characters, over LinkedIn's 200. Shorten it."
    );
  });
});

describe('resolveLinkedInTargetingProfileId', () => {
  it('reads custom as cloud-native and every other selection as itself, as campaign-service does', () => {
    expect(resolveLinkedInTargetingProfileId('custom')).toBe('cloud-native');
    expect(resolveLinkedInTargetingProfileId('cloud-native')).toBe('cloud-native');
    expect(resolveLinkedInTargetingProfileId('mcp')).toBe('mcp');
  });
});

describe('linkedInTargetingAfterRemovals', () => {
  const profile: LinkedInTargetingProfileConfig = {
    id: 'cloud-native',
    label: 'Cloud Native',
    skills: ['urn:li:skill:1', 'urn:li:skill:2', 'urn:li:skill:3'],
    groups: ['urn:li:group:10', 'urn:li:group:20'],
  };

  it('keeps the profile as configured when nothing is removed', () => {
    expect(linkedInTargetingAfterRemovals(profile, { skills: [], groups: [] })).toEqual({ skills: profile.skills, groups: profile.groups });
  });

  it('takes the removed URNs out and keeps the profile order', () => {
    expect(linkedInTargetingAfterRemovals(profile, { skills: ['urn:li:skill:2'], groups: ['urn:li:group:10'] })).toEqual({
      skills: ['urn:li:skill:1', 'urn:li:skill:3'],
      groups: ['urn:li:group:20'],
    });
  });

  it('ignores a removal the profile does not carry, and does not read a skill removal as a group one', () => {
    expect(linkedInTargetingAfterRemovals(profile, { skills: ['urn:li:group:10', 'urn:li:skill:99'], groups: [] })).toEqual({
      skills: profile.skills,
      groups: profile.groups,
    });
  });
});

describe('roundUsdToCentsLikeGo (#5774)', () => {
  it.each([
    // Exact binary ties break to the even cent, as strconv.FormatFloat(x, 'f', 2, 64) does.
    [100.125, 100.12],
    [0.125, 0.12],
    [0.375, 0.38],
    [2.625, 2.62],
    // Not ties: their exact binary values sit just below the half cent.
    [1.005, 1.0],
    [9.995, 9.99],
    // Ordinary amounts.
    [20, 20],
    [9.999, 10],
    [1000, 1000],
    [12.344, 12.34],
    [12.346, 12.35],
  ])('rounds %s to %s', (amount, want) => {
    expect(roundUsdToCentsLikeGo(amount)).toBe(want);
  });

  it('passes a non-finite amount through for the caller to refuse', () => {
    expect(roundUsdToCentsLikeGo(Number.NaN)).toBeNaN();
    expect(roundUsdToCentsLikeGo(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});
