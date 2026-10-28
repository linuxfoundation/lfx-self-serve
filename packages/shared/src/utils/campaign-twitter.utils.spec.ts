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

  it('judges the trimmed copy, as campaign-service does', () => {
    expect(twitterComposedTweetLength('  hello  ')).toBe(5 + 1 + TWITTER_TCO_URL_WEIGHT);
  });
});
