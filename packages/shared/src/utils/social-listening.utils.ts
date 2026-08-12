// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Social Listening mapping/filter helpers, shared by the Angular app and the Express server.
 * Ported from PCC; the bookmark (`mentionIds`) client branch is deferred to a follow-up ticket.
 */

import { MENTION_PLATFORM_CONFIG } from '../constants/social-listening.constants';
import type {
  AuthorOption,
  Mention,
  MentionFilters,
  MentionPlatform,
  MentionRelevance,
  MentionSentiment,
  SocialListeningMention,
  SocialListeningMentionAuthor,
  SocialListeningOption,
  SocialListeningPlatform,
  SocialListeningSubProject,
} from '../interfaces/social-listening.interface';

/** Lowercases + dedupes keywords so filter state and payloads stay canonical. */
export const normalizeKeywords = (keywords: string[]): string[] => [...new Set(keywords.map((keyword) => keyword.toLowerCase()))];

/**
 * Normalizes a raw Snowflake platform/network value to a `MentionPlatform` key.
 * Snowflake returns `'X'` for Twitter — mapped here. `Object.hasOwn` (not `in`)
 * so prototype keys like `'constructor'` can't pass the check.
 */
export function normalizePlatformKey(network: string): MentionPlatform {
  const normalized = (network || '').toLowerCase().trim().replace(/\s/g, '');
  if (normalized === 'x') return 'twitter';
  if (Object.hasOwn(MENTION_PLATFORM_CONFIG, normalized)) return normalized as MentionPlatform;
  return 'other';
}

export function mapRawToMention(raw: SocialListeningMention): Mention {
  const platform = normalizePlatformKey(raw.SOURCE_PLATFORM || raw.SOCIAL_NETWORK);
  const sentiment = (raw.SENTIMENT?.toLowerCase() || 'neutral') as MentionSentiment;
  const analysis = raw.RELEVANCE_COMMENT || `Mention from ${raw.SOCIAL_NETWORK || 'social media'} with ${sentiment} sentiment.`;

  return {
    id: raw.MENTION_ID,
    platform,
    keyword: (raw.KEYWORD || '').toLowerCase(),
    timestamp: raw.MENTION_TS || '',
    authorName: raw.AUTHOR || 'Unknown',
    authorProfileLink: raw.AUTHOR_PROFILE_LINK || '',
    title: raw.TITLE || '',
    content: raw.BODY || '',
    analysis,
    sentiment,
    relevance: mapRelevance(raw.RELEVANCE_SCORE),
    tags: buildTags(raw.TAGS),
    originalUrl: raw.URL || '',
    imageUrl: raw.IMAGE_URL || '',
    subreddit: (raw.SUBREDDIT || '').replace(/^r\//, ''),
    language: raw.LANGUAGE || '',
    raw,
  };
}

/**
 * Converts raw filter-signal values into the client request fragment:
 * `'all'`/empty values are dropped, keywords are normalized, empty arrays are omitted.
 */
export function buildMentionFilters(opts: {
  sentiment: string;
  relevance: string;
  platform: string;
  keywords: string[];
  tags: string[];
  authors?: string[];
  sourceProjectId?: string;
  language?: string;
  hasTitle?: string;
  search?: string;
}): MentionFilters {
  const isActive = (v?: string): boolean => !!v && v !== 'all';
  const filters: MentionFilters = {};

  if (isActive(opts.sentiment)) filters.sentiment = opts.sentiment as MentionSentiment;
  if (isActive(opts.relevance)) filters.relevance = opts.relevance as MentionRelevance;
  if (isActive(opts.platform)) filters.platform = opts.platform;
  if (isActive(opts.sourceProjectId)) filters.sourceProjectId = opts.sourceProjectId;
  if (isActive(opts.language)) filters.language = opts.language;
  if (isActive(opts.hasTitle)) filters.hasTitle = opts.hasTitle;
  if (opts.keywords.length > 0) filters.keywords = normalizeKeywords(opts.keywords);
  if (opts.tags.length > 0) filters.tags = opts.tags;
  if (opts.authors && opts.authors.length > 0) filters.authors = opts.authors;
  if (opts.search) filters.search = opts.search;

  return filters;
}

export function mapSubProjectsToOptions(projects: SocialListeningSubProject[]): SocialListeningOption[] {
  return [{ label: 'All Projects', value: 'all' }, ...projects.map((p) => ({ label: p.SOURCE_PROJECT_NAME, value: p.SOURCE_PROJECT_ID }))];
}

export function mapLanguagesToOptions(languages: string[]): SocialListeningOption[] {
  return [
    { label: 'All', value: 'all' },
    ...languages.map((lang) => ({ label: lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase(), value: lang.toLowerCase() })),
  ];
}

export function mapPlatformsToOptions(platforms: SocialListeningPlatform[]): SocialListeningOption[] {
  return [{ label: 'All Platforms', value: 'all' }, ...platforms.map((p) => ({ label: p.SOCIAL_NETWORK, value: p.SOURCE_PLATFORM }))];
}

export function mapAuthorsToOptions(authors: SocialListeningMentionAuthor[]): AuthorOption[] {
  return authors.map((a) => {
    const config = MENTION_PLATFORM_CONFIG[normalizePlatformKey(a.PLATFORM)];
    return { ...a, platformIcon: config.icon, platformIconClass: config.colorClass };
  });
}

/**
 * The author list cascades off other filters, so a kept selection can drop out of
 * the rescoped options. Re-add those as placeholders so the multiselect chip label
 * still resolves.
 */
export function mergeSelectedAuthors(options: AuthorOption[], selected: string[]): AuthorOption[] {
  const present = new Set(options.map((o) => o.AUTHOR));
  const missing = selected.filter((author) => !present.has(author));
  if (missing.length === 0) {
    return options;
  }
  const config = MENTION_PLATFORM_CONFIG[normalizePlatformKey('')];
  const placeholders: AuthorOption[] = missing.map((author) => ({
    AUTHOR: author,
    PLATFORM: '',
    MENTION_COUNT: 0,
    platformIcon: config.icon,
    platformIconClass: config.colorClass,
  }));
  return [...options, ...placeholders];
}

function buildTags(tagsStr: string): string[] {
  if (!tagsStr) {
    return [];
  }
  return tagsStr
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function mapRelevance(score: string): MentionRelevance {
  const normalized = (score || '').toLowerCase().trim();
  if (normalized === 'high' || normalized === 'low') {
    return normalized;
  }
  return 'low';
}
