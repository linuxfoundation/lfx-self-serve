// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { TWITTER_MAX_TWEET_WEIGHTED_CHARS, TWITTER_TCO_URL_WEIGHT } from '../constants/campaign.constants';
import { twitterComposedTweetLength, twitterTweetTextError, twitterWeightedLength } from './campaign-twitter.utils';

describe('twitterWeightedLength', () => {
  it('counts Latin text one per character', () => {
    expect(twitterWeightedLength('Join us at KubeCon')).toBe(18);
  });

  it('counts every link at the t.co weight, whatever its length', () => {
    const long = `https://events.example.org/${'a'.repeat(200)}?utm_source=x`;
    expect(twitterWeightedLength(long)).toBe(TWITTER_TCO_URL_WEIGHT);
    expect(twitterWeightedLength(`Register: ${long}`)).toBe(10 + TWITTER_TCO_URL_WEIGHT);
  });

  it('leaves the sentence full stop after a link outside it, as X does', () => {
    expect(twitterWeightedLength('See https://events.example.org/kc.')).toBe(4 + TWITTER_TCO_URL_WEIGHT + 1);
  });

  it('does not count a run glued to a letter as a link', () => {
    expect(twitterWeightedLength('xhttps://a.example')).toBe('xhttps://a.example'.length);
  });

  it('counts CJK characters two each and an emoji two per grapheme', () => {
    expect(twitterWeightedLength('東京')).toBe(4);
    expect(twitterWeightedLength('🎉')).toBe(2);
    expect(twitterWeightedLength('👍🏽')).toBe(2);
  });

  it('follows emojiClusterLen for code points outside the emoji plane', () => {
    // A bare © asks for no emoji presentation, so it weighs 1 as any Latin-1 character does.
    expect(twitterWeightedLength('©')).toBe(1);
    expect(twitterWeightedLength('©️')).toBe(2);
    // A keycap is one emoji: digit, U+FE0F, U+20E3.
    expect(twitterWeightedLength('1️⃣')).toBe(2);
    // A flag is exactly one pair of regional indicators.
    expect(twitterWeightedLength('🇺🇸🇩🇪')).toBe(4);
    // A zero-width-joined family is one emoji.
    expect(twitterWeightedLength('👨‍👩‍👧')).toBe(2);
    // U+FE0E asks for TEXT presentation, so it ends the cluster and is charged on its own.
    expect(twitterWeightedLength('🖥︎')).toBe(4);
  });

  it('accepts 255 ASCII characters and a ©, or 254 and a keycap, at exactly the cap', () => {
    expect(twitterTweetTextError(`${'a'.repeat(255)}©`)).toBeNull();
    expect(twitterTweetTextError(`${'a'.repeat(254)}1️⃣`)).toBeNull();
  });
});

describe('twitterTweetTextError', () => {
  it('refuses blank copy', () => {
    expect(twitterTweetTextError('   ')).toBe('Enter the tweet text.');
    expect(twitterComposedTweetLength('  ')).toBe(0);
  });

  it('counts the appended registration link and its space against the 280 cap', () => {
    const room = TWITTER_MAX_TWEET_WEIGHTED_CHARS - 1 - TWITTER_TCO_URL_WEIGHT;
    expect(twitterTweetTextError('a'.repeat(room))).toBeNull();
    expect(twitterComposedTweetLength('a'.repeat(room))).toBe(TWITTER_MAX_TWEET_WEIGHTED_CHARS);
    expect(twitterTweetTextError('a'.repeat(room + 1))).toBe("The tweet is 281 characters with the registration link, over X's 280. Shorten the text.");
  });

  it('judges copy carrying its own link on its own weight when lenient, since the service may not append one', () => {
    const copy = `${'a'.repeat(250)} https://events.example.org/kc`;
    expect(twitterTweetTextError(copy)).not.toBeNull();
    expect(twitterTweetTextError(copy, true)).toBeNull();
    // Lenient changes nothing for copy with no link of its own.
    expect(twitterTweetTextError('a'.repeat(257), true)).not.toBeNull();
  });

  it('refuses copy over the 8 KiB raw bound before weighing it', () => {
    expect(twitterTweetTextError('a'.repeat(8 * 1024 + 1), true)).toContain('longer than X can take');
  });

  it('trims a run of unbalanced closing brackets in linear time', () => {
    const run = `https://a.example${')'.repeat(200_000)}`;
    const started = Date.now();
    expect(twitterWeightedLength(run)).toBe(TWITTER_TCO_URL_WEIGHT + 200_000);
    expect(Date.now() - started).toBeLessThan(2000);
    // A balanced bracket stays part of the link.
    expect(twitterWeightedLength('https://en.example.org/wiki/X_(Twitter)')).toBe(TWITTER_TCO_URL_WEIGHT);
  });

  it('judges the trimmed copy, as campaign-service does', () => {
    expect(twitterComposedTweetLength('  hello  ')).toBe(5 + 1 + TWITTER_TCO_URL_WEIGHT);
  });
});
