// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TWITTER_MAX_TWEET_WEIGHTED_CHARS, TWITTER_TCO_URL_WEIGHT } from '../constants/campaign.constants';

/**
 * X tweet length, the client-side mirror of campaign-service's `weightedTweetLen` and
 * `composeTweetText` (`internal/platform/twitter/client.go`).
 *
 * campaign-service stays the authority — it refuses an over-long composed tweet before anything is
 * created — but these let the Implement tab and the BFF say why before submitting. The mirror is
 * deliberately close rather than exact in one place, an emoji sequence, which is counted as 2 per
 * grapheme here as it is there.
 */

/** Any http(s) run, as `tweetURLRe` finds it: up to whitespace, `<`, `>` or CJK punctuation. */
const TWEET_URL_RUN = /https?:\/\/[^\s<>。、！？，：；]+/giu;

/** Trailing punctuation X does not count as part of a link (`trimTweetURLPunct`). */
const TWEET_URL_TRAILING_PUNCT = `.,;:!?'"`;

/** The code-point ranges X weighs as 1 (`tweetWeightOneRanges`); everything else weighs 2. */
const TWEET_WEIGHT_ONE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

/**
 * The weighted length X gives `text`: every http(s) link counts `TWITTER_TCO_URL_WEIGHT` whatever
 * its length, an emoji grapheme counts 2, and every other code point 1 or 2 by its range. NFC first,
 * as X normalizes before counting.
 */
export function twitterWeightedLength(text: string): number {
  const normalized = text.normalize('NFC');
  let total = 0;
  let last = 0;
  for (const match of normalized.matchAll(TWEET_URL_RUN)) {
    const start = match.index ?? 0;
    // A run glued to a preceding ASCII letter or digit is not a link X recognises (`urlRunStartIsBounded`).
    if (start > 0 && /[A-Za-z0-9]/.test(normalized[start - 1])) continue;
    const link = trimTrailingPunct(match[0]);
    total += weightedRunLength(normalized.slice(last, start)) + TWITTER_TCO_URL_WEIGHT;
    last = start + link.length;
  }
  return total + weightedRunLength(normalized.slice(last));
}

/**
 * The weighted length of the tweet campaign-service will actually publish: the trimmed copy plus
 * one space and the destination link it appends. The link is the brief's registration URL with UTM
 * parameters campaign-service adds, so the copy cannot already carry it verbatim, and it is always
 * counted. Blank copy is 0, which is a refusal of its own (`twitterTweetTextError`).
 */
export function twitterComposedTweetLength(tweetText: string): number {
  const trimmed = tweetText.trim();
  if (trimmed === '') return 0;
  return twitterWeightedLength(trimmed) + 1 + TWITTER_TCO_URL_WEIGHT;
}

/** Why `tweetText` cannot be sent, or `null` when it can. */
export function twitterTweetTextError(tweetText: string): string | null {
  if (tweetText.trim() === '') return 'Enter the tweet text.';
  const length = twitterComposedTweetLength(tweetText);
  if (length > TWITTER_MAX_TWEET_WEIGHTED_CHARS) {
    return `The tweet is ${length} characters with the registration link, over X's ${TWITTER_MAX_TWEET_WEIGHTED_CHARS}. Shorten the text.`;
  }
  return null;
}

function trimTrailingPunct(run: string): string {
  let out = run;
  for (;;) {
    const lastChar = out.at(-1);
    if (lastChar === undefined) return out;
    const unbalanced =
      (lastChar === ')' && count(out, '(') < count(out, ')')) ||
      (lastChar === ']' && count(out, '[') < count(out, ']')) ||
      (lastChar === '}' && count(out, '{') < count(out, '}'));
    if (!TWEET_URL_TRAILING_PUNCT.includes(lastChar) && !unbalanced) return out;
    out = out.slice(0, -1);
  }
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

function weightedRunLength(text: string): number {
  let total = 0;
  for (const grapheme of graphemes(text)) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(grapheme)) {
      total += 2;
      continue;
    }
    for (const char of grapheme) {
      total += codePointWeight(char.codePointAt(0) ?? 0);
    }
  }
  return total;
}

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

function codePointWeight(codePoint: number): number {
  return TWEET_WEIGHT_ONE_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi) ? 1 : 2;
}
