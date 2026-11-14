// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  TWITTER_MAX_TWEET_RAW_BYTES,
  TWITTER_MAX_TWEET_WEIGHTED_CHARS,
  TWITTER_MIN_START_LEAD_MS,
  TWITTER_TCO_URL_WEIGHT,
} from '../constants/campaign.constants';

/**
 * Whether campaign-service would refuse `startDate` as too soon at `nowMs`: it sends the date as
 * UTC midnight and requires that instant to be MORE than `TWITTER_MIN_START_LEAD_MS` ahead
 * (`minStartLead`, `CreateCampaign`). Today is always too soon, and tomorrow is too soon in the
 * last five minutes before midnight UTC. A date that does not parse is left to the other checks.
 */
export function twitterStartDateTooSoon(startDate: string, nowMs: number): boolean {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start)) return false;
  return start <= nowMs + TWITTER_MIN_START_LEAD_MS;
}

/**
 * X tweet length, the client-side mirror of campaign-service's `weightedTweetLen` and
 * `composeTweetText` (`internal/platform/twitter/client.go`).
 *
 * campaign-service stays the authority — it refuses an over-long composed tweet before anything is
 * created — but these let the Implement tab and the BFF say why before submitting. Emoji clusters
 * follow `emojiClusterLen` rule for rule.
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

/**
 * Why `tweetText` cannot be sent, or `null` when it can.
 *
 * `lenient` is for a caller that cannot know the destination: campaign-service does NOT append the
 * link when the copy already carries it as a link of its own (`textCarriesURL`), and only the
 * service knows the UTM-tagged destination it would compare. So with `lenient`, copy that contains
 * any link is judged on its own weight, never refused for a link that may not be appended — the BFF
 * must not refuse what the service accepts. The Implement tab stays strict: an operator cannot type
 * the tagged destination, so the link is always appended there.
 */
export function twitterTweetTextError(tweetText: string, lenient = false): string | null {
  if (tweetText.trim() === '') return 'Enter the tweet text.';
  const trimmed = tweetText.trim();
  // campaign-service's raw bound (`maxTweetRawBytes`), checked FIRST so the weighing below never
  // runs over an absurd caller-supplied string: no tweet within 280 weighted characters is this big.
  if (new TextEncoder().encode(trimmed).length > TWITTER_MAX_TWEET_RAW_BYTES) {
    return `The tweet text is longer than X can take. Keep it within ${TWITTER_MAX_TWEET_WEIGHTED_CHARS} characters.`;
  }
  const carriesLink = new RegExp(TWEET_URL_RUN.source, 'iu').test(trimmed);
  const length = lenient && carriesLink ? twitterWeightedLength(trimmed) : twitterComposedTweetLength(tweetText);
  if (length > TWITTER_MAX_TWEET_WEIGHTED_CHARS) {
    return `The tweet is ${length} characters${lenient && carriesLink ? '' : ' with the registration link'}, over X's ${TWITTER_MAX_TWEET_WEIGHTED_CHARS}. Shorten the text.`;
  }
  return null;
}

/**
 * `trimTweetURLPunct`: strip trailing sentence punctuation, and a closing bracket only while it is
 * unbalanced. Linear: the bracket counts are taken once and adjusted as characters come off, so a
 * run ending in many `)` costs one pass rather than a recount per character.
 */
function trimTrailingPunct(run: string): string {
  const counts: Record<string, number> = { '(': 0, ')': 0, '[': 0, ']': 0, '{': 0, '}': 0 };
  for (const char of run) {
    if (char in counts) counts[char]++;
  }
  const opener: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let end = run.length;
  while (end > 0) {
    const lastChar = run[end - 1];
    const open = opener[lastChar];
    const unbalanced = open !== undefined && counts[open] < counts[lastChar];
    if (!TWEET_URL_TRAILING_PUNCT.includes(lastChar) && !unbalanced) break;
    if (lastChar in counts) counts[lastChar]--;
    end--;
  }
  return run.slice(0, end);
}

/** Per code point, with every emoji cluster `emojiClusterLength` finds counting 2 (`weightedRunLen`). */
function weightedRunLength(text: string): number {
  const points = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  let total = 0;
  for (let i = 0; i < points.length; ) {
    const size = emojiClusterLength(points, i);
    if (size > 0) {
      total += 2;
      i += size;
      continue;
    }
    total += codePointWeight(points[i]);
    i++;
  }
  return total;
}

/**
 * How many code points from `start` form one emoji, or 0 when none starts there — `emojiClusterLen`
 * rule for rule. A code point outside the emoji plane is an emoji only when the next one asks for it
 * (U+FE0F, an enclosing keycap or a skin tone), so a bare `©` stays its weight of 1; a regional
 * indicator pairs with exactly one more; and a cluster absorbs U+FE0F, keycaps, skin tones, tags and
 * zero-width-joined code points, ending before U+FE0E, which asks for text presentation.
 */
function emojiClusterLength(points: readonly number[], start: number): number {
  if (start >= points.length) return 0;
  const first = points[start];
  const next = points[start + 1];
  const inPlane = first >= 0x1f000 && first <= 0x1fffd;
  const requested = next !== undefined && (next === 0xfe0f || next === 0x20e3 || (next >= 0x1f3fb && next <= 0x1f3ff));
  if (!inPlane && !requested) return 0;
  const isRegional = (point: number | undefined): boolean => point !== undefined && point >= 0x1f1e6 && point <= 0x1f1ff;
  if (isRegional(first)) return isRegional(next) ? 2 : 1;
  let i = start + 1;
  while (i < points.length) {
    const point = points[i];
    if (point === 0xfe0f || point === 0x20e3 || (point >= 0x1f3fb && point <= 0x1f3ff) || (point >= 0xe0020 && point <= 0xe007f)) {
      i++;
    } else if (point === 0x200d && i + 1 < points.length) {
      i += 2;
    } else {
      break;
    }
  }
  return i - start;
}

function codePointWeight(codePoint: number): number {
  return TWEET_WEIGHT_ONE_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi) ? 1 : 2;
}
