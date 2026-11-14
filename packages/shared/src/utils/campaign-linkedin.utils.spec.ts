// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { LINKEDIN_CHAR_LIMITS } from '../constants/campaign.constants';
import type { LinkedInTargetingProfileConfig } from '../interfaces/campaign.interface';
import {
  isLinkedInCallToAction,
  linkedInCreativeNameLength,
  linkedInCreativeTextLength,
  linkedInTargetingAfterRemovals,
  linkedInVariantDescriptionError,
  linkedInVariantNameErrors,
  linkedInVariantTextError,
  normalizeLinkedInCreativeName,
  normalizeLinkedInCreativeText,
  resolveLinkedInTargetingProfileId,
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

describe('normalizeLinkedInCreativeName', () => {
  it('collapses every whitespace run to one space and trims, keeping dashes', () => {
    expect(normalizeLinkedInCreativeName('  OSSNA 2026\t–\n Skill   Up  ')).toBe('OSSNA 2026 – Skill Up');
  });

  it('treats a Go-only space (U+0085, U+3000) as whitespace and a blank name as none', () => {
    expect(normalizeLinkedInCreativeName('\u0085A\u3000B\u0085')).toBe('A B');
    expect(normalizeLinkedInCreativeName(' \n ')).toBe('');
  });

  it('measures the normalized name in code points', () => {
    expect(linkedInCreativeNameLength('  a  👋 ')).toBe(3);
  });
});

describe('linkedInVariantNameErrors', () => {
  it('accepts blank and distinct names', () => {
    expect(linkedInVariantNameErrors(['', 'Skill Up', 'Keynotes'], 'OSSNA')).toEqual(['', '', '']);
  });

  it("refuses a name over LinkedIn's 255 characters rather than letting campaign-service cut it", () => {
    expect(linkedInVariantNameErrors(['a'.repeat(LINKEDIN_CHAR_LIMITS.name)], 'E')).toEqual(['']);
    expect(linkedInVariantNameErrors(['a'.repeat(LINKEDIN_CHAR_LIMITS.name + 1)], 'E')[0]).toBe("The name is 256 characters, over LinkedIn's 255. Shorten it.");
  });

  it('refuses the later of two names that match once whitespace is collapsed', () => {
    expect(linkedInVariantNameErrors(['Skill Up', 'x', ' Skill   Up '], 'E')).toEqual([
      '',
      '',
      "This name repeats variant 1's. Give each variant its own name.",
    ]);
  });

  it("refuses a name equal to an unnamed variant's default, before or after it", () => {
    expect(linkedInVariantNameErrors(['', 'OSSNA | variant-1'], 'OSSNA')[1]).toBe("This name repeats variant 1's. Give each variant its own name.");
    expect(linkedInVariantNameErrors(['OSSNA | variant-2', ''], 'OSSNA')[0]).toBe("This name is variant 2's default name. Give each variant its own name.");
    // A named variant has no default, so its own "variant-N" spelling is free.
    expect(linkedInVariantNameErrors(['OSSNA | variant-2', 'B'], 'OSSNA')).toEqual(['', '']);
  });
});

describe('linkedInVariantDescriptionError', () => {
  it('accepts blank and up to 300 characters, measured like the intro text', () => {
    expect(linkedInVariantDescriptionError('')).toBeNull();
    expect(linkedInVariantDescriptionError(`  ${'a'.repeat(LINKEDIN_CHAR_LIMITS.description)}  `)).toBeNull();
  });

  it('refuses a description campaign-service would cut', () => {
    expect(linkedInVariantDescriptionError('a'.repeat(LINKEDIN_CHAR_LIMITS.description + 1))).toBe(
      "The description is 301 characters, over LinkedIn's 300. Shorten it."
    );
  });
});

describe('isLinkedInCallToAction', () => {
  it('matches the upper-case LinkedIn labels exactly', () => {
    expect(isLinkedInCallToAction('REGISTER')).toBe(true);
    expect(isLinkedInCallToAction('SHOP_NOW')).toBe(true);
    expect(isLinkedInCallToAction('register')).toBe(false);
    expect(isLinkedInCallToAction('Register')).toBe(false);
    expect(isLinkedInCallToAction('')).toBe(false);
  });
});
