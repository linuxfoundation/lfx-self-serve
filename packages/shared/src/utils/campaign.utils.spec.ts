// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_ACTION_RULE_LEVERS,
  CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS,
  MAX_NEGATIVE_KEYWORD_TEXT_LENGTH,
  MAX_SPONSORS,
  MAX_SPONSOR_NAME_LENGTH,
} from '../constants/campaign.constants';
import type { BriefMetricsActionRule, CampaignOptimizeLever } from '../interfaces/campaign.interface';
import { campaignActionItemLever, campaignActionRuleLever, keywordActionKey, normalizeSponsors, parseNegativeKeywordInput } from './campaign.utils';

/**
 * Sponsor entries arrive from a SCRAPED page: attacker-influenced names and logo urls that reach
 * a sent email. Coverage was indirect only, through the controller and component specs, so the
 * bounds and the per-entry sanitizing had nothing asserting them directly.
 */
describe('normalizeSponsors', () => {
  const logo = (n: number): string => `https://cdn.example.com/${n}.png`;

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not an array'],
    ['an object', { name: 'x' }],
  ])('returns [] for %s rather than throwing', (_label, input) => {
    expect(normalizeSponsors(input)).toEqual([]);
  });

  it('drops an entry whose name is not a string', () => {
    // The type guard, not cosmetics: `sponsor.name.trim()` below would throw on a non-string.
    expect(
      normalizeSponsors([
        { name: 42, logoUrl: logo(1) },
        { name: 'Acme', logoUrl: logo(2) },
      ])
    ).toEqual([{ name: 'Acme', logoUrl: logo(2) }]);
  });

  it('drops an entry with no usable logo url', () => {
    // `canonicalHttpUrl` returns '' for a private host, a bad scheme or a non-default port, and
    // an entry with no logo has nothing to render.
    const sponsors = normalizeSponsors([
      { name: 'Private', logoUrl: 'https://10.0.0.1/logo.png' },
      { name: 'Javascript', logoUrl: 'javascript:alert(1)' },
      { name: 'OddPort', logoUrl: 'https://cdn.example.com:8443/logo.png' },
      { name: 'Good', logoUrl: logo(1) },
    ]);

    expect(sponsors).toEqual([{ name: 'Good', logoUrl: logo(1) }]);
  });

  it('sanitizes the name, because it reaches a recipient as display text', () => {
    // A BIDI override renders a name as something other than what it contains.
    const [sponsor] = normalizeSponsors([{ name: 'Acme\u202Ekcatta', logoUrl: logo(1) }]);

    expect(sponsor?.name).not.toContain('\u202E');
  });

  it('drops an entry whose name sanitizes to nothing', () => {
    // Invisible-only names render blank while reading as non-empty.
    expect(normalizeSponsors([{ name: '\u200B\u200B', logoUrl: logo(1) }])).toEqual([]);
  });

  it('truncates a long name by CODE POINT, not by UTF-16 unit', () => {
    // `.slice()` on the string would cut an astral character in half and leave a lone surrogate.
    const [sponsor] = normalizeSponsors([{ name: '😀'.repeat(MAX_SPONSOR_NAME_LENGTH + 10), logoUrl: logo(1) }]);

    expect([...(sponsor?.name ?? '')]).toHaveLength(MAX_SPONSOR_NAME_LENGTH);
  });

  it('caps the result at MAX_SPONSORS', () => {
    const many = Array.from({ length: MAX_SPONSORS + 5 }, (_, i) => ({ name: `S${i}`, logoUrl: logo(i) }));

    expect(normalizeSponsors(many)).toHaveLength(MAX_SPONSORS);
  });

  it('parses only the pre-sliced window, never the whole list', () => {
    // `toHaveLength(MAX_SPONSORS)` alone proves nothing here -- the FINAL slice guarantees it
    // whether or not the pre-slice exists. What the pre-slice actually buys is not parsing
    // entries beyond the window, so this counts the parses: a getter on `logoUrl` fires once per
    // entry the pipeline touches.
    //
    // The caller that passes a wider factor is `campaign.controller.ts` (a DIRECT request, whose
    // list is unbounded), not the scrape path.
    let parsed = 0;
    const counting = Array.from({ length: 5000 }, (_, i) => ({
      name: `S${i}`,
      get logoUrl(): string {
        parsed++;
        return logo(i);
      },
    }));

    expect(normalizeSponsors(counting)).toHaveLength(MAX_SPONSORS);
    expect(parsed).toBe(MAX_SPONSORS);
  });

  it('lets preSliceFactor keep entries the default would have cut before parsing', () => {
    // The first MAX_SPONSORS entries are all unusable; the good ones sit past that window. With
    // the default factor they are pre-sliced away and the result is empty.
    const unusable = Array.from({ length: MAX_SPONSORS }, (_, i) => ({ name: `Bad${i}`, logoUrl: 'javascript:alert(1)' }));
    const list = [...unusable, { name: 'Good', logoUrl: logo(1) }];

    expect(normalizeSponsors(list)).toEqual([]);
    expect(normalizeSponsors(list, 2)).toEqual([{ name: 'Good', logoUrl: logo(1) }]);
  });
});

/**
 * Monitor finding → Optimize lever. The mapping decides which control an operator is handed for a
 * finding about live spend, so every rule is pinned explicitly rather than sampled.
 */
describe('campaignActionRuleLever', () => {
  // Every token campaign-service's brief rule engine emits (internal/service/rules/actions.go).
  // Listed here independently of the map, so a rule dropped from the map fails this spec.
  const expected: Record<BriefMetricsActionRule, CampaignOptimizeLever> = {
    zero_delivery: 'pause_resume',
    underspending: 'budget',
    budget_constrained: 'budget',
    low_ctr: 'none',
    no_conversions: 'none',
  };

  it('covers exactly the rule engine tokens, no more and no fewer', () => {
    expect(Object.keys(CAMPAIGN_ACTION_RULE_LEVERS).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))('maps %s to %s', (rule, lever) => {
    expect(campaignActionRuleLever(rule)).toBe(lever);
  });

  it.each([
    ['an unknown token', 'paused_should_run'],
    ['an empty string', ''],
    ['an inherited key', 'toString'],
    ['a prototype key', '__proto__'],
    ['a different case', 'UNDERSPENDING'],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to none for %s', (_label, rule) => {
    expect(campaignActionRuleLever(rule)).toBe('none');
  });
});

describe('campaignActionItemLever', () => {
  const allPlatforms = ['google-ads', 'microsoft-ads', 'linkedin-ads', 'meta-ads', 'reddit-ads', 'twitter-ads'];

  it.each(['google-ads', 'linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads'])('offers the budget lever on %s', (platform) => {
    expect(campaignActionItemLever('underspending', platform)).toBe('budget');
    expect(campaignActionItemLever('budget_constrained', platform)).toBe('budget');
  });

  // X has no budget write upstream; offering the lever would open an editor whose every save 400s.
  it('offers no budget lever on X', () => {
    expect(campaignActionItemLever('underspending', 'twitter-ads')).toBe('none');
    expect(campaignActionItemLever('budget_constrained', 'twitter-ads')).toBe('none');
  });

  // Gated on the SAME set the row toggle uses, so the lever can never be offered where the toggle
  // itself would be unavailable for the platform.
  it.each(allPlatforms)('offers pause/resume on %s exactly when the row toggle supports it', (platform) => {
    const expected = CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS.pause_resume.has(platform) ? 'pause_resume' : 'none';
    expect(campaignActionItemLever('zero_delivery', platform)).toBe(expected);
  });

  // Microsoft keyword actions run through campaign-service since #3308; every other platform has none.
  it.each(allPlatforms)('restricts keyword actions to Google Ads and Microsoft Advertising (%s)', (platform) => {
    expect(CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS.keywords.has(platform)).toBe(platform === 'google-ads' || platform === 'microsoft-ads');
  });

  // No rule is mapped to the bid or negative-keyword levers: the rule engine's advice for none of
  // them is a bid change or a negative keyword, so every rule's lever is one of the three below.
  it('maps no rule to a lever outside budget, pause/resume and none', () => {
    expect(new Set(Object.values(CAMPAIGN_ACTION_RULE_LEVERS))).toEqual(new Set(['budget', 'pause_resume', 'none']));
  });

  it.each(allPlatforms)('offers nothing for a rule without a lever on %s', (platform) => {
    expect(campaignActionItemLever('low_ctr', platform)).toBe('none');
    expect(campaignActionItemLever('no_conversions', platform)).toBe('none');
  });

  it.each([
    ['an unknown platform', 'hubspot'],
    ['an empty platform', ''],
    ['a missing platform', undefined],
    ['a non-string platform', 42],
  ])('offers nothing for %s', (_label, platform) => {
    expect(campaignActionItemLever('underspending', platform)).toBe('none');
    expect(campaignActionItemLever('zero_delivery', platform)).toBe('none');
  });

  it('offers nothing for an unknown rule on a supported platform', () => {
    expect(campaignActionItemLever('some_future_rule', 'google-ads')).toBe('none');
  });
});

describe('parseNegativeKeywordInput', () => {
  it('keeps one keyword per line, in order, ignoring blank lines and normalising whitespace', () => {
    expect(parseNegativeKeywordInput('free download\n\n  cheap   tickets \r\njobs')).toEqual({
      keywords: ['free download', 'cheap tickets', 'jobs'],
      problems: [],
    });
  });

  it('accepts the allowed punctuation and non-Latin letters', () => {
    expect(parseNegativeKeywordInput("rock & roll\nO'Brien\nk8s-tutorial\nv1.2\ncafé\n東京").problems).toEqual([]);
  });

  it('reports each line it cannot send, by its 1-based line number, and does not send it', () => {
    const parsed = parseNegativeKeywordInput('good\nbad!\n\nfoo--bar\nGood');
    expect(parsed.keywords).toEqual(['good']);
    expect(parsed.problems.map((p) => [p.line, p.text])).toEqual([
      [2, 'bad!'],
      [4, 'foo--bar'],
      [5, 'Good'],
    ]);
    expect(parsed.problems[0].reason).toContain('letters, digits, spaces');
    expect(parsed.problems[1].reason).toContain('punctuation');
    expect(parsed.problems[2].reason).toContain('more than once');
  });

  // Characters, not UTF-16 units, as upstream counts them.
  it('counts length in characters', () => {
    const astral = '𝔸'.repeat(MAX_NEGATIVE_KEYWORD_TEXT_LENGTH);
    expect(parseNegativeKeywordInput(astral).problems).toEqual([]);
    expect(parseNegativeKeywordInput('a'.repeat(MAX_NEGATIVE_KEYWORD_TEXT_LENGTH + 1)).problems[0].reason).toContain(`${MAX_NEGATIVE_KEYWORD_TEXT_LENGTH}`);
  });

  it.each([null, undefined, 42])('treats a non-string (%s) as empty', (value) => {
    expect(parseNegativeKeywordInput(value)).toEqual({ keywords: [], problems: [] });
  });
});

describe('keywordActionKey', () => {
  it('keeps the Google key unchanged and qualifies the Microsoft one', () => {
    expect(keywordActionKey('google-ads', '11', '22')).toBe('11-22');
    expect(keywordActionKey('microsoft-ads', '11', '22')).toBe('microsoft-ads:11-22');
  });
});
