// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_CHAR_LIMITS,
  CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES,
  GOOGLE_ADS_MAX_SEARCH_AD_PATH_WIDTH,
  GOOGLE_ADS_MAX_SEARCH_ADS_PER_AD_GROUP,
  GOOGLE_ADS_MAX_SEARCH_DESCRIPTIONS,
  GOOGLE_ADS_MAX_SEARCH_HEADLINES,
  GOOGLE_ADS_SEARCH_AD_PATH_REFUSED_CHARACTERS,
  googleAdsEchoed,
  googleAdsTrimSpace,
  VALID_CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPES,
} from '../constants/campaign.constants';
import type { CampaignNegativeKeywordInput, CampaignNegativeKeywordMatchType, CampaignSearchAd } from '../interfaces/campaign.interface';
import { parseNegativeKeywordInput } from './campaign.utils';

/**
 * Google Search create settings beyond the first ad's copy (#4991) — the second and third responsive
 * search ads, every ad's display paths, and the campaign-level negative keywords: the refusals
 * campaign-service makes on them before the budget mutate (`ad_copy.go`, `adgroup_plan.go` and
 * `validateNegativeKeywords` in `internal/platform/googleads`).
 *
 * One judge per field, shared by the Implement tab — which holds Create on it — and the BFF, which
 * refuses the create with the same sentence. Each returns `null` when upstream would accept the value.
 */

/**
 * The display width Google counts a string at: CJK and full-width characters count double, every
 * other code point once (`ad_copy.go`'s `googleAdsCharWeight`, the ranges copied as written there).
 */
export function googleAdsTextWeight(text: string): number {
  let weight = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const double =
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    weight += double ? 2 : 1;
  }
  return weight;
}

/**
 * Why upstream would refuse one ad's display paths, or `null` (`validateSearchAdPaths`). Each path is
 * trimmed as Go trims it, then judged in upstream's order: path1, then path2 — the width, then a
 * whitespace, control or `/ ? # & =` character — and last a path2 without a path1, which Google
 * would render nowhere. `adLabel` names the ad in the sentence ("ad 2"); `null` for the first ad.
 */
export function googleSearchAdPathsRefusal(path1: unknown, path2: unknown, adLabel: string | null = null): string | null {
  if ((path1 !== undefined && path1 !== null && typeof path1 !== 'string') || (path2 !== undefined && path2 !== null && typeof path2 !== 'string')) {
    return 'Google Ads display paths must be text.';
  }
  const where = adLabel === null ? '' : ` on ${adLabel}`;
  const p1 = googleAdsTrimSpace(path1 ?? '');
  const p2 = googleAdsTrimSpace(path2 ?? '');
  for (const [label, path] of [
    ['Display path 1', p1],
    ['Display path 2', p2],
  ] as const) {
    if (path === '') continue;
    if (googleAdsTextWeight(path) > GOOGLE_ADS_MAX_SEARCH_AD_PATH_WIDTH) {
      return `${label}${where} (${googleAdsEchoed(path)}) is longer than the ${GOOGLE_ADS_MAX_SEARCH_AD_PATH_WIDTH} characters Google Ads allows; CJK and full-width characters count double. Shorten it and create again.`;
    }
    if ([...path].some((char) => /[\s\p{Cc}]/u.test(char) || GOOGLE_ADS_SEARCH_AD_PATH_REFUSED_CHARACTERS.includes(char))) {
      return `${label}${where} (${googleAdsEchoed(path)}) cannot hold spaces, control characters or / ? # & =, because Google Ads shows it as part of the ad's URL. Change it and create again.`;
    }
  }
  if (p2 !== '' && p1 === '') {
    return `Display path 2${where} is set without display path 1. Google Ads shows path 2 only after path 1, so fill in path 1 or move the text into it.`;
  }
  return null;
}

/**
 * Why upstream would refuse one responsive search ad's copy for its display width, or `null`
 * (`callerCopy`, which campaign-service runs on EVERY Search ad before the budget mutate — the first
 * ad's campaign-level copy included, with one ad or three). Headlines first, then descriptions, the
 * first over-wide line named.
 *
 * Each list is walked exactly as `callerCopy` walks it, because only the lines it reaches are judged
 * there: it stops once {@link GOOGLE_ADS_MAX_SEARCH_HEADLINES} headlines or
 * {@link GOOGLE_ADS_MAX_SEARCH_DESCRIPTIONS} descriptions are KEPT (checked at the top of each step),
 * trims each line as Go trims it, skips a blank one, refuses an over-wide one, and only then skips an
 * exact repeat of a kept line — so a repeat does not count toward the cap, and a line past the cap is
 * never width-checked. A non-string entry is skipped. Counts themselves are not refused here: upstream
 * drops the rows past the cap on the first ad, whose Add buttons have never been capped.
 */
export function googleSearchAdCopyWidthRefusal(headlines: unknown, descriptions: unknown, adLabel: string): string | null {
  const wideHeadline = firstOverWideLine(headlines, CAMPAIGN_CHAR_LIMITS.searchHeadline, GOOGLE_ADS_MAX_SEARCH_HEADLINES);
  if (wideHeadline !== null) {
    return `A headline on ${adLabel} (${googleAdsEchoed(wideHeadline)}) is longer than the ${CAMPAIGN_CHAR_LIMITS.searchHeadline} characters Google Ads allows; CJK and full-width characters count double. Shorten it and create again.`;
  }
  const wideDescription = firstOverWideLine(descriptions, CAMPAIGN_CHAR_LIMITS.searchDescription, GOOGLE_ADS_MAX_SEARCH_DESCRIPTIONS);
  if (wideDescription !== null) {
    return `A description on ${adLabel} (${googleAdsEchoed(wideDescription)}) is longer than the ${CAMPAIGN_CHAR_LIMITS.searchDescription} characters Google Ads allows; CJK and full-width characters count double. Shorten it and create again.`;
  }
  return null;
}

/**
 * Why upstream would refuse the second and third responsive search ads, or `null`. The list may hold
 * at most {@link GOOGLE_ADS_MAX_SEARCH_ADS_PER_AD_GROUP} minus the first ad. Each ad, in order, needs
 * at least one headline and one description — upstream would otherwise pad it with the same generated
 * lines as every other empty ad — within the per-ad counts and Google's display widths
 * (`callerCopy`, which refuses an over-wide line), and display paths `googleSearchAdPathsRefusal` accepts.
 */
export function googleAdditionalSearchAdsRefusal(ads: unknown): string | null {
  if (ads === undefined || ads === null) return null;
  if (!Array.isArray(ads) || !ads.every((ad) => isSearchAdShape(ad))) {
    return 'Google Ads additional search ads must be a list of ads, each with lists of headlines and descriptions.';
  }
  const maxAdditional = GOOGLE_ADS_MAX_SEARCH_ADS_PER_AD_GROUP - 1;
  if (ads.length > maxAdditional) {
    return `Google Ads takes at most ${GOOGLE_ADS_MAX_SEARCH_ADS_PER_AD_GROUP} responsive search ads in one ad group, and this campaign has ${ads.length + 1}. Remove an ad and create again.`;
  }
  for (const [i, ad] of (ads as CampaignSearchAd[]).entries()) {
    const label = `ad ${i + 2}`;
    const headlines = ad.headlines.map((h) => googleAdsTrimSpace(h)).filter((h) => h !== '');
    const descriptions = ad.descriptions.map((d) => googleAdsTrimSpace(d)).filter((d) => d !== '');
    if (headlines.length === 0) return `Add at least one headline to ${label}, or remove the ad.`;
    if (descriptions.length === 0) return `Add at least one description to ${label}, or remove the ad.`;
    if (headlines.length > GOOGLE_ADS_MAX_SEARCH_HEADLINES) {
      return `Google Ads takes at most ${GOOGLE_ADS_MAX_SEARCH_HEADLINES} headlines on one ad, and ${label} has ${headlines.length}. Remove some and create again.`;
    }
    if (descriptions.length > GOOGLE_ADS_MAX_SEARCH_DESCRIPTIONS) {
      return `Google Ads takes at most ${GOOGLE_ADS_MAX_SEARCH_DESCRIPTIONS} descriptions on one ad, and ${label} has ${descriptions.length}. Remove some and create again.`;
    }
    const widthRefusal = googleSearchAdCopyWidthRefusal(headlines, descriptions, label);
    if (widthRefusal) return widthRefusal;
    const pathRefusal = googleSearchAdPathsRefusal(ad.path1, ad.path2, label);
    if (pathRefusal) return pathRefusal;
  }
  return null;
}

/**
 * Why upstream would refuse the create-time negative keywords, or `null`. At most Google's
 * `maxKeywords`; each entry a known match type and text `parseNegativeKeywordInput` accepts under
 * Google's 80-character cap — the same rules the Optimize tab's editor sends by — and no keyword twice
 * under the same match type, compared case-insensitively (upstream would silently send it once).
 */
export function googleCreateNegativeKeywordsRefusal(keywords: unknown): string | null {
  if (keywords === undefined || keywords === null) return null;
  if (!Array.isArray(keywords) || !keywords.every((kw) => isNegativeKeywordShape(kw))) {
    return 'Google Ads negative keywords must be a list of keywords, each with text and a match type.';
  }
  const rules = CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['google-ads'];
  if (keywords.length > rules.maxKeywords) {
    return `Google Ads takes at most ${rules.maxKeywords} negative keywords when a campaign is created, and this one has ${keywords.length}. Remove some and create again; you can add more from Optimize once the campaign is live.`;
  }
  const seen = new Set<string>();
  for (const keyword of keywords as CampaignNegativeKeywordInput[]) {
    if (!VALID_CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPES.has(keyword.matchType)) {
      return `Negative keyword "${googleAdsEchoed(keyword.text)}" has a match type Google Ads does not take. Use Exact, Phrase or Broad.`;
    }
    // One line through the editor's own parser, so a keyword is judged exactly as typed there. A line
    // break would make it two keywords, so it is refused first.
    const { keywords: parsed, problems } = /[\r\n]/.test(keyword.text)
      ? { keywords: [], problems: [] }
      : parseNegativeKeywordInput(keyword.text, rules.maxTextLength);
    if (problems.length > 0) return `Negative keyword "${googleAdsEchoed(keyword.text)}": ${problems[0].reason}`;
    if (parsed.length !== 1) return 'Each Google Ads negative keyword needs text on one line.';
    const key = `${keyword.matchType}\u0000${parsed[0].toLocaleLowerCase()}`;
    if (seen.has(key)) return `Negative keyword "${googleAdsEchoed(parsed[0])}" is listed more than once. Remove the repeat and create again.`;
    seen.add(key);
  }
  return null;
}

/**
 * The editor text as the request carries it: one `{ text, matchType }` per kept line, in order, each
 * text normalised as `parseNegativeKeywordInput` normalises it. Lines the parser refuses are left
 * out here; the editor's error names them and Create waits.
 */
export function googleCreateNegativeKeywords(text: string, matchType: CampaignNegativeKeywordMatchType): CampaignNegativeKeywordInput[] {
  const { keywords } = parseNegativeKeywordInput(text, CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['google-ads'].maxTextLength);
  return keywords.map((keyword) => ({ text: keyword, matchType }));
}

/**
 * The brief's suggested negatives as the create-time editor's text: one per line, keeping only the
 * lines `parseNegativeKeywordInput` accepts under Google's 80-character cap — which also drops a
 * case-insensitive repeat, the key `googleCreateNegativeKeywordsRefusal` uses for one match type —
 * and only the first `maxKeywords` of those. A stored brief is runtime-arbitrary, so a suggestion
 * the judge would refuse is dropped here rather than holding Create on a create the operator never
 * touched; what the operator types is still judged in full.
 */
export function googleSuggestedNegativeKeywordsText(suggestions: unknown): string {
  if (!Array.isArray(suggestions)) return '';
  const rules = CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['google-ads'];
  const text = suggestions.filter((entry): entry is string => typeof entry === 'string').join('\n');
  return parseNegativeKeywordInput(text, rules.maxTextLength).keywords.slice(0, rules.maxKeywords).join('\n');
}

/** `callerCopy`'s walk over one list, returning the first line it would refuse for width, or `null`. */
function firstOverWideLine(list: unknown, maxWeight: number, maxCount: number): string | null {
  if (!Array.isArray(list)) return null;
  const kept = new Set<string>();
  for (const raw of list) {
    if (kept.size >= maxCount) return null;
    if (typeof raw !== 'string') continue;
    const line = googleAdsTrimSpace(raw);
    if (line === '') continue;
    if (googleAdsTextWeight(line) > maxWeight) return line;
    kept.add(line);
  }
  return null;
}

function isSearchAdShape(ad: unknown): boolean {
  if (!ad || typeof ad !== 'object') return false;
  const { headlines, descriptions, path1, path2 } = ad as Record<string, unknown>;
  const isStringList = (value: unknown): boolean => Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  const isOptionalString = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string';
  return isStringList(headlines) && isStringList(descriptions) && isOptionalString(path1) && isOptionalString(path2);
}

function isNegativeKeywordShape(keyword: unknown): boolean {
  if (!keyword || typeof keyword !== 'object') return false;
  const { text, matchType } = keyword as Record<string, unknown>;
  return typeof text === 'string' && typeof matchType === 'string';
}
