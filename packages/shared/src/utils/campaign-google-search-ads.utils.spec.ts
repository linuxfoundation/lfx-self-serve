// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  googleAdditionalSearchAdsRefusal,
  googleAdsTextWeight,
  googleCreateNegativeKeywords,
  googleCreateNegativeKeywordsRefusal,
  googleSearchAdCopyWidthRefusal,
  googleSearchAdPathsRefusal,
  googleSuggestedNegativeKeywordsText,
} from './campaign-google-search-ads.utils';

/**
 * The Search ads, display path and create-time negative refusals are the ONE judge both the
 * Implement tab and the BFF refuse by. The controller spec drives the common cases through
 * `createCampaign`; these pin each branch directly, and above all the nearest value upstream ACCEPTS.
 */

const ad = (overrides: Record<string, unknown> = {}) => ({ headlines: ['Register today'], descriptions: ['Join us.'], path1: '', path2: '', ...overrides });

describe('googleAdsTextWeight', () => {
  it('counts CJK and full-width characters double, as Google does', () => {
    expect(googleAdsTextWeight('kubecon')).toBe(7);
    expect(googleAdsTextWeight('日本')).toBe(4);
    expect(googleAdsTextWeight('ＡＢ')).toBe(4);
    expect(googleAdsTextWeight('한')).toBe(2);
  });
});

describe('googleSearchAdPathsRefusal', () => {
  it('accepts two paths at the width limit, blanks and a padded path', () => {
    expect(googleSearchAdPathsRefusal('a'.repeat(15), 'b'.repeat(15))).toBeNull();
    expect(googleSearchAdPathsRefusal('', '')).toBeNull();
    expect(googleSearchAdPathsRefusal(undefined, null)).toBeNull();
    expect(googleSearchAdPathsRefusal('  kubecon  ', '')).toBeNull();
  });

  it('refuses a path wider than 15, counting CJK double', () => {
    expect(googleSearchAdPathsRefusal('a'.repeat(16), '')).toContain('Display path 1');
    expect(googleSearchAdPathsRefusal('日本語日本語日本語', '')).toContain('count double');
    expect(googleSearchAdPathsRefusal('日本語日本語日', '')).toBeNull();
  });

  it.each([['kube con'], ['kube/con'], ['a?b'], ['a#b'], ['a&b'], ['a=b'], ['a\tb']])('refuses %j', (path) => {
    expect(googleSearchAdPathsRefusal('ok', path)).toContain('Display path 2');
  });

  it('refuses path 2 without path 1 and names the ad when given', () => {
    expect(googleSearchAdPathsRefusal('', 'na')).toContain('without display path 1');
    expect(googleSearchAdPathsRefusal('', 'na', 'ad 3')).toContain('on ad 3');
  });

  it('refuses a non-string path', () => {
    expect(googleSearchAdPathsRefusal(5, '')).toContain('must be text');
  });
});

describe('googleAdditionalSearchAdsRefusal', () => {
  it('accepts no list, an empty list and two complete ads', () => {
    expect(googleAdditionalSearchAdsRefusal(undefined)).toBeNull();
    expect(googleAdditionalSearchAdsRefusal([])).toBeNull();
    expect(googleAdditionalSearchAdsRefusal([ad(), ad({ path1: 'agenda', path2: 'day1' })])).toBeNull();
  });

  it('accepts an ad at the per-ad counts and widths', () => {
    expect(
      googleAdditionalSearchAdsRefusal([ad({ headlines: Array.from({ length: 15 }, (_, i) => `h${i}`.padEnd(30, 'x')), descriptions: ['d'.repeat(90)] })])
    ).toBeNull();
  });

  it('refuses a third further ad, which would be a fourth in the group', () => {
    expect(googleAdditionalSearchAdsRefusal([ad(), ad(), ad()])).toContain('at most 3');
  });

  it.each([
    ['no headline', ad({ headlines: ['  ', ''] }), 'headline to ad 2'],
    ['no description', ad({ descriptions: [] }), 'description to ad 2'],
    ['16 headlines', ad({ headlines: Array.from({ length: 16 }, (_, i) => `h${i}`) }), 'at most 15 headlines'],
    ['5 descriptions', ad({ descriptions: ['a', 'b', 'c', 'd', 'e'] }), 'at most 4 descriptions'],
    ['a headline over 30 wide', ad({ headlines: ['日'.repeat(16)] }), 'headline on ad 2'],
    ['a description over 90', ad({ descriptions: ['d'.repeat(91)] }), 'description on ad 2'],
    ['a bad path', ad({ path2: 'na' }), 'on ad 2'],
  ])('refuses an ad with %s', (_label, entry, fragment) => {
    expect(googleAdditionalSearchAdsRefusal([entry])).toContain(fragment);
  });

  it('names the ad the refusal is about', () => {
    expect(googleAdditionalSearchAdsRefusal([ad(), ad({ headlines: [] })])).toContain('ad 3');
  });

  it.each([[{}], ['ads'], [[{ headlines: 'A', descriptions: ['B'] }]], [[{ headlines: ['A'], descriptions: ['B'], path1: 3 }]]])(
    'refuses the malformed list %j',
    (value) => {
      expect(googleAdditionalSearchAdsRefusal(value)).toContain('must be a list');
    }
  );
});

describe('googleCreateNegativeKeywordsRefusal', () => {
  const kw = (text: string, matchType = 'Exact') => ({ text, matchType });

  it('accepts no list, 60 keywords and the same text under two match types', () => {
    expect(googleCreateNegativeKeywordsRefusal(undefined)).toBeNull();
    expect(googleCreateNegativeKeywordsRefusal(Array.from({ length: 60 }, (_, i) => kw(`term ${i}`)))).toBeNull();
    expect(googleCreateNegativeKeywordsRefusal([kw('jobs'), kw('jobs', 'Phrase')])).toBeNull();
    expect(googleCreateNegativeKeywordsRefusal([kw('x'.repeat(80))])).toBeNull();
  });

  it.each([
    ['61 keywords', Array.from({ length: 61 }, (_, i) => kw(`term ${i}`)), 'at most 60'],
    ['an 81-character keyword', [kw('x'.repeat(81))], 'Longer than 80'],
    ['a refused character', [kw('free!')], 'letters, digits'],
    ['adjacent punctuation', [kw("rock'-n-roll")], 'next to each other'],
    ['a line break', [kw('free\ntickets')], 'one line'],
    ['a blank keyword', [kw('   ')], 'one line'],
    ['an unknown match type', [kw('jobs', 'Fuzzy')], 'Exact, Phrase or Broad'],
    ['a case-insensitive repeat', [kw('Jobs'), kw('jobs')], 'more than once'],
    ['a malformed entry', [{ text: 'jobs' }], 'must be a list'],
  ])('refuses %s', (_label, value, fragment) => {
    expect(googleCreateNegativeKeywordsRefusal(value)).toContain(fragment);
  });
});

describe('googleCreateNegativeKeywords', () => {
  it('turns the editor text into one entry per kept line, normalized, with the one match type', () => {
    expect(googleCreateNegativeKeywords('free  tickets\n\n  jobs \nbad!', 'Phrase')).toEqual([
      { text: 'free tickets', matchType: 'Phrase' },
      { text: 'jobs', matchType: 'Phrase' },
    ]);
  });
});

describe('googleSearchAdCopyWidthRefusal', () => {
  it('accepts copy at the widths, blanks and non-strings', () => {
    expect(googleSearchAdCopyWidthRefusal(['h'.repeat(30), '日'.repeat(15), '  '], ['d'.repeat(90), 5], 'ad 1')).toBeNull();
    expect(googleSearchAdCopyWidthRefusal(undefined, 'not a list', 'ad 1')).toBeNull();
  });

  it('refuses an over-wide headline, then description, naming the ad', () => {
    expect(googleSearchAdCopyWidthRefusal(['日'.repeat(16)], [], 'ad 1')).toContain('A headline on ad 1');
    expect(googleSearchAdCopyWidthRefusal(['ok'], ['ｄ'.repeat(46)], 'ad 1')).toContain('A description on ad 1');
    expect(googleSearchAdCopyWidthRefusal(['h'.repeat(31)], ['d'.repeat(91)], 'ad 1')).toContain('headline');
  });

  it('walks each list as callerCopy does: stops once the cap is KEPT, width before repeats, blanks skipped', () => {
    const wide = '日'.repeat(16);
    const fifteen = Array.from({ length: 15 }, (_, i) => `H${i}`);
    expect(googleSearchAdCopyWidthRefusal([...fifteen.slice(0, 14), wide], [], 'ad 1')).toContain('A headline on ad 1');
    expect(googleSearchAdCopyWidthRefusal([...fifteen, wide], [], 'ad 1')).toBeNull();
    expect(googleSearchAdCopyWidthRefusal([...Array.from({ length: 20 }, () => 'Same'), wide], [], 'ad 1')).toContain('A headline on ad 1');
    expect(googleSearchAdCopyWidthRefusal([...Array.from({ length: 20 }, () => ' '), wide], [], 'ad 1')).toContain('A headline on ad 1');
    expect(googleSearchAdCopyWidthRefusal([wide, wide], [], 'ad 1')).toContain('A headline on ad 1');
    expect(googleSearchAdCopyWidthRefusal([], ['a', 'b', 'c', 'd', 'ｄ'.repeat(46)], 'ad 1')).toBeNull();
    expect(googleSearchAdCopyWidthRefusal([], ['a', 'b', 'c', 'ｄ'.repeat(46)], 'ad 1')).toContain('A description on ad 1');
  });

  it('judges each line trimmed, as Go trims it', () => {
    expect(googleSearchAdCopyWidthRefusal([` ${'h'.repeat(30)} `], [], 'ad 1')).toBeNull();
  });
});

describe('googleSuggestedNegativeKeywordsText', () => {
  it('keeps only the suggestions the judge accepts, the first of a repeat, and the first 60', () => {
    const many = Array.from({ length: 61 }, (_, i) => `term ${i}`);
    const text = googleSuggestedNegativeKeywordsText(['free!', 'x'.repeat(81), 'Jobs', 'jobs', 5, ...many]);
    const lines = text.split('\n');

    expect(lines).toHaveLength(60);
    expect(lines[0]).toBe('Jobs');
    expect(lines).not.toContain('free!');
    expect(lines).not.toContain('jobs');
    expect(lines.at(-1)).toBe('term 58');
    expect(googleCreateNegativeKeywordsRefusal(lines.map((t) => ({ text: t, matchType: 'Exact' })))).toBeNull();
  });

  it('keeps an 80-character suggestion and seeds nothing from a non-list', () => {
    expect(googleSuggestedNegativeKeywordsText(['x'.repeat(80)])).toBe('x'.repeat(80));
    expect(googleSuggestedNegativeKeywordsText(undefined)).toBe('');
    expect(googleSuggestedNegativeKeywordsText('jobs')).toBe('');
  });
});
