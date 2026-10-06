// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_ACTION_RULE_LEVERS,
  CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS,
  MAX_NEGATIVE_KEYWORD_TEXT_LENGTH,
  MAX_SPONSORS,
  MAX_SPONSOR_NAME_LENGTH,
  NEGATIVE_KEYWORD_TEXT_PATTERN,
} from '../constants/campaign.constants';
import type {
  BriefMetricsActionRule,
  CampaignEventSponsor,
  CampaignOptimizeLever,
  KeywordActionPlatform,
  NegativeKeywordInputProblem,
  ParsedNegativeKeywordInput,
} from '../interfaces/campaign.interface';
import { sanitizeDisplayText } from './html-utils';
import { canonicalHttpUrl } from './url.utils';

/**
 * The sponsor list exactly as it will be staged: sanitized, bounded, and capped.
 *
 * ONE implementation because the preview and the wire must agree. The component rendered this
 * list and the controller rebuilt it, and the two drifted repeatedly -- blank names kept in one
 * and dropped in the other, the name cap applied in one only, the sanitizer added to one first.
 * Each drift showed the operator a sponsor the sent draft omits, or vice versa.
 *
 * @param sponsors - Raw entries from a scraped brief or a direct request; any shape
 * @param preSliceFactor - Entries to keep BEFORE the per-entry URL parse, as a multiple of
 *   MAX_SPONSORS. The server bounds untrusted input this way so a direct request cannot make it
 *   parse an unbounded list; the client's input is already bounded, so it passes 1.
 * @returns At most MAX_SPONSORS entries, each with a non-empty name and a usable http(s) logo
 */
export function normalizeSponsors(sponsors: unknown, preSliceFactor = 1): CampaignEventSponsor[] {
  if (!Array.isArray(sponsors)) return [];
  return sponsors
    .filter((sponsor): sponsor is { name: string; logoUrl?: unknown } => !!sponsor && typeof sponsor.name === 'string')
    .slice(0, MAX_SPONSORS * preSliceFactor)
    .map((sponsor) => ({
      name: sanitizeDisplayText([...sponsor.name.trim()].slice(0, MAX_SPONSOR_NAME_LENGTH).join('')),
      logoUrl: canonicalHttpUrl(sponsor.logoUrl),
    }))
    .filter((sponsor) => sponsor.name !== '' && sponsor.logoUrl !== '')
    .slice(0, MAX_SPONSORS);
}

/**
 * The lever a monitor rule maps to, ignoring platform.
 *
 * Total over ANY input: the wire's `rule` is typed closed but is not validated, so a token added
 * upstream later, a non-string, or an inherited key like `toString` all resolve to `none` rather
 * than to `undefined` or a prototype member.
 */
export function campaignActionRuleLever(rule: unknown): CampaignOptimizeLever {
  if (typeof rule !== 'string' || !Object.prototype.hasOwnProperty.call(CAMPAIGN_ACTION_RULE_LEVERS, rule)) {
    return 'none';
  }
  return CAMPAIGN_ACTION_RULE_LEVERS[rule as BriefMetricsActionRule];
}

/**
 * The lever that resolves a monitor finding on a campaign of `platform`, or `none`.
 *
 * `none` when the rule has no lever, and also when the platform cannot take it — X has no budget
 * write, and keyword actions are Google Ads and Microsoft Advertising only — so a finding never offers a control that would
 * refuse its campaign.
 */
export function campaignActionItemLever(rule: unknown, platform: unknown): CampaignOptimizeLever {
  const lever = campaignActionRuleLever(rule);
  if (lever === 'none') {
    return 'none';
  }
  return typeof platform === 'string' && CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS[lever].has(platform) ? lever : 'none';
}

/**
 * Parse the negative-keyword editor's text: one keyword per line, blank lines ignored.
 *
 * Each kept line is normalised the way campaign-service normalises it before sending it to the
 * platform (whitespace collapsed to one space, trimmed; case kept), so what the editor shows as
 * sent is what upstream echoes back. The checks mirror the BFF's and upstream's own, so a batch
 * this accepts is not refused for its shape: the character set (`NEGATIVE_KEYWORD_TEXT_PATTERN`),
 * `MAX_NEGATIVE_KEYWORD_TEXT_LENGTH` counted in characters rather than UTF-16 units, no two
 * punctuation characters together, and no keyword twice (compared case-insensitively). The count
 * limit is the caller's to check, against `keywords.length`.
 */
export function parseNegativeKeywordInput(text: unknown): ParsedNegativeKeywordInput {
  const keywords: string[] = [];
  const problems: NegativeKeywordInputProblem[] = [];
  if (typeof text !== 'string') {
    return { keywords, problems };
  }
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const keyword = raw.replace(/\s+/g, ' ').trim();
    if (keyword === '') {
      return;
    }
    const line = i + 1;
    const reason = negativeKeywordProblem(keyword, seen);
    if (reason !== null) {
      problems.push({ line, text: keyword, reason });
      return;
    }
    seen.add(keyword.toLocaleLowerCase());
    keywords.push(keyword);
  });
  return { keywords, problems };
}

function negativeKeywordProblem(keyword: string, seen: ReadonlySet<string>): string | null {
  if ([...keyword].length > MAX_NEGATIVE_KEYWORD_TEXT_LENGTH) {
    return `Longer than ${MAX_NEGATIVE_KEYWORD_TEXT_LENGTH} characters.`;
  }
  if (!NEGATIVE_KEYWORD_TEXT_PATTERN.test(keyword)) {
    return "Use only letters, digits, spaces and & ' - .";
  }
  if (/[&'.-]{2}/.test(keyword)) {
    return 'Two punctuation characters cannot be next to each other.';
  }
  if (seen.has(keyword.toLocaleLowerCase())) {
    return 'Listed more than once.';
  }
  return null;
}

/**
 * The key a keyword's action state is stored under on the Optimize tab.
 *
 * Google's key is unchanged (`adGroupId-criterionId`); Microsoft's is prefixed with its platform,
 * because Google and Microsoft mint ids in unrelated spaces and the same digits could name one
 * keyword on each — sharing a key would show one platform's outcome against the other's row.
 */
export function keywordActionKey(platform: KeywordActionPlatform, adGroupId: string, criterionId: string): string {
  const base = `${adGroupId}-${criterionId}`;
  return platform === 'google-ads' ? base : `${platform}:${base}`;
}

/**
 * A keyword's stable identity across reads — (platform, campaign, ad group, criterion) — for state
 * that must outlive the table it was asked from, such as a keyword a confirmed REMOVE deleted.
 */
export function keywordIdentityKey(platform: KeywordActionPlatform, campaignId: string, adGroupId: string, criterionId: string): string {
  return `${platform}:${campaignId}:${adGroupId}:${criterionId}`;
}
