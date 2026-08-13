// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Social Listening mapping/filter helpers, shared by the Angular app and the Express server.
 * Ported from PCC; the bookmark (`mentionIds`) client branch is deferred to a follow-up ticket.
 */

import type { ChartData } from 'chart.js';

import {
  ANALYTICS_TOP_PLATFORMS_LIMIT,
  DEFAULT_MENTION_PREDICATE,
  MENTION_HAS_TITLE_OPTIONS,
  MENTION_PLATFORM_CONFIG,
  MENTION_RELEVANCE_OPTIONS,
  MENTION_SENTIMENT_CONFIG,
  MENTION_SENTIMENT_OPTIONS,
  SOCIAL_LISTENING_CHART_PALETTE,
} from '../constants/social-listening.constants';
import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type {
  AuthorOption,
  FilterPredicate,
  Mention,
  MentionFilters,
  MentionPlatform,
  MentionRelevance,
  MentionSentiment,
  SocialListeningMention,
  SocialListeningMentionAuthor,
  SocialListeningOption,
  SocialListeningOverTimePoint,
  SocialListeningPlatform,
  SocialListeningPlatformDistribution,
  SocialListeningPlatformRow,
  SocialListeningSentimentDistribution,
  SocialListeningSentimentRow,
  SocialListeningSubProject,
  SocialListeningTagCount,
} from '../interfaces/social-listening.interface';
import type { StatCardDelta, StatCardDeltaDirection } from '../interfaces/stat-card.interface';
import { capitalizeFirst } from './string.utils';

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

/** Upstream also emits values like `mixed`/`unknown`, which have no config entry — those fall back to `neutral`. */
export function normalizeSentiment(sentiment: string | null | undefined): MentionSentiment {
  const normalized = (sentiment || '').toLowerCase().trim();
  if (Object.hasOwn(MENTION_SENTIMENT_CONFIG, normalized)) return normalized as MentionSentiment;
  return 'neutral';
}

export function mapRawToMention(raw: SocialListeningMention): Mention {
  const platform = normalizePlatformKey(raw.SOURCE_PLATFORM || raw.SOCIAL_NETWORK);
  const sentiment = normalizeSentiment(raw.SENTIMENT);
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
 * Formats a raw Social Listening tag for display: underscores become spaces, each word is
 * capitalized, and `ai` is special-cased to `AI` (e.g. `ai_agents` -> `AI Agents`).
 * Standalone so non-template consumers (e.g. the filters panel's option mapping) share it
 * with the `formatTag` pipe (rule: pipes needing programmatic access wrap a function).
 */
export function formatTag(value: string): string {
  if (!value) {
    return '';
  }

  return value
    .split('_')
    .map((word) => (word === 'ai' ? 'AI' : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
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

// ---------------------------------------------------------------------------
// Analytics tab builders (LFXV2-3018) — pure functions over the feed-derived endpoint rows
// ---------------------------------------------------------------------------

/** Palette index for the Nth series — index 0 is reserved for the "Total" line, so cycles run over the remaining slots and never collide with it. */
function seriesColor(index: number): string {
  return SOCIAL_LISTENING_CHART_PALETTE[1 + (index % (SOCIAL_LISTENING_CHART_PALETTE.length - 1))];
}

/** Snowflake's TO_CHAR month labels arrive uppercase (`MAR 2026`, `MAR 05`) — title-case the words for display. */
function formatPeriodLabel(label: string): string {
  return label.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Mentions Over Time line chart: one dataset per sub-project plus a leading "Total" line.
 * Buckets order by `PERIOD_START` (the DATE_TRUNC ISO start), not `PERIOD_LABEL`, which is
 * display-only and can't sort across grains. Projects group by NAME (PCC parity — children
 * may share the parent's id in the feed) and duplicate (bucket, name) rows fold by summing,
 * since the server groups by (bucket, id, name). Returns null when there's nothing to chart
 * (drives the panel's empty state).
 */
export function buildOverTimeChartData(points: SocialListeningOverTimePoint[]): ChartData<'line'> | null {
  if (points.length === 0) return null;

  const bucketStarts = [...new Set(points.map((p) => p.PERIOD_START))].sort();
  const labelByStart = new Map<string, string>();
  for (const point of points) {
    if (!labelByStart.has(point.PERIOD_START)) {
      labelByStart.set(point.PERIOD_START, formatPeriodLabel(point.PERIOD_LABEL));
    }
  }
  const labels = bucketStarts.map((start) => labelByStart.get(start) ?? start);

  const projectMap = new Map<string, Map<string, number>>();
  for (const point of points) {
    let byPeriod = projectMap.get(point.SOURCE_PROJECT_NAME);
    if (!byPeriod) {
      byPeriod = new Map();
      projectMap.set(point.SOURCE_PROJECT_NAME, byPeriod);
    }
    byPeriod.set(point.PERIOD_START, (byPeriod.get(point.PERIOD_START) ?? 0) + (point.TOTAL_MENTIONS || 0));
  }

  const totals = bucketStarts.map((start) => {
    let sum = 0;
    projectMap.forEach((byPeriod) => {
      sum += byPeriod.get(start) ?? 0;
    });
    return sum;
  });

  const line = (label: string, data: number[], color: string) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    pointBackgroundColor: color,
    borderWidth: 2,
  });

  const datasets = [line('Total', totals, SOCIAL_LISTENING_CHART_PALETTE[0])];
  let index = 0;
  projectMap.forEach((byPeriod, name) => {
    datasets.push(
      line(
        name,
        bucketStarts.map((start) => byPeriod.get(start) ?? 0),
        seriesColor(index)
      )
    );
    index++;
  });

  return { labels, datasets };
}

/**
 * Mentions by Tag bar chart: server rows arrive pre-sorted and capped at `MENTION_TOP_TAGS_LIMIT`,
 * labels are title-cased with underscores as spaces (`formatTag`). Returns null when empty.
 */
export function buildTagsChartData(tags: SocialListeningTagCount[]): ChartData<'bar'> | null {
  const rows = tags.filter((tag) => !!tag.TAG);
  if (rows.length === 0) return null;

  return {
    labels: rows.map((tag) => formatTag(tag.TAG)),
    datasets: [
      {
        data: rows.map((tag) => tag.TOTAL_COUNT),
        backgroundColor: rows.map((_, i) => seriesColor(i)),
        borderRadius: 4,
        borderSkipped: false,
      },
    ],
  };
}

/** Top-N platform rows (default `ANALYTICS_TOP_PLATFORMS_LIMIT`) with display config pre-resolved. */
export function mapPlatformDistributionRows(
  rows: SocialListeningPlatformDistribution[],
  limit: number = ANALYTICS_TOP_PLATFORMS_LIMIT
): SocialListeningPlatformRow[] {
  return rows.slice(0, limit).map((row) => ({
    config: MENTION_PLATFORM_CONFIG[normalizePlatformKey(row.SOURCE_PLATFORM || row.SOCIAL_NETWORK)],
    mentionsCount: row.MENTIONS_COUNT,
    percentOfTotal: row.PERCENT_OF_TOTAL || 0,
  }));
}

/** Sentiment share rows in fixed positive → neutral → negative display order; unknown upstream values are dropped. */
export function mapSentimentRows(rows: SocialListeningSentimentDistribution[]): SocialListeningSentimentRow[] {
  const order: MentionSentiment[] = ['positive', 'neutral', 'negative'];
  return rows
    .filter((row) => Object.hasOwn(MENTION_SENTIMENT_CONFIG, row.SENTIMENT))
    .map((row) => {
      const sentiment = row.SENTIMENT as MentionSentiment;
      return {
        sentiment,
        config: MENTION_SENTIMENT_CONFIG[sentiment],
        mentionCount: row.MENTION_COUNT,
        percentOfTotal: row.PERCENT_OF_TOTAL || 0,
      };
    })
    .sort((a, b) => order.indexOf(a.sentiment) - order.indexOf(b.sentiment));
}

/**
 * Maps a server's signed change percentage to a stat-card delta: the arrow carries the numeric
 * direction, the label shows the absolute value (PCC parity), and `inverted` flips the color
 * mapping for metrics where an increase is bad (negative sentiment). Returns undefined when the
 * server suppressed the comparison (null — previous window too thin), hiding the delta line.
 */
export function buildAnalyticsDelta(changePct: number | null, inverted = false): StatCardDelta | undefined {
  if (changePct === null) return undefined;
  let direction: StatCardDeltaDirection = 'flat';
  if (changePct > 0) direction = 'up';
  else if (changePct < 0) direction = 'down';
  const sign = changePct > 0 ? '+' : '';
  return { label: `${sign}${Math.abs(changePct).toFixed(1)}% vs last period`, direction, inverted };
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

/** First two values joined, then `+N more`; the full list rides along for the pill tooltip. */
function summarizePillValues(values: string[]): { summary: string; full: string } {
  const full = values.join(', ');
  if (values.length <= 2) {
    return { summary: full, full };
  }
  return { summary: `${values.slice(0, 2).join(', ')} +${values.length - 2} more`, full };
}

/**
 * Builds the active-filter summary pills (LFXV2-3017): one `FilterPillOption` per non-default
 * predicate dimension, in predicate field order, so the pills row always matches the Filters
 * button badge (`countActiveFilters`). `id` is the `FilterPredicate` key — the page maps it back
 * to the signal it resets when a pill is clicked. `fullLabel` carries the remove affordance plus
 * the untruncated values (the pills component surfaces it as both tooltip and aria-label).
 */
export function buildActiveFilterPills(predicate: FilterPredicate): FilterPillOption[] {
  const labelFor = (options: SocialListeningOption[], value: string): string => options.find((o) => o.value === value)?.label ?? value;
  const pill = (id: string, dimension: string, summary: string, full?: string): FilterPillOption => ({
    id,
    label: `${dimension}: ${summary}`,
    fullLabel: `Remove ${dimension}: ${full ?? summary}`,
  });

  const pills: FilterPillOption[] = [];
  if (predicate.sentiment !== DEFAULT_MENTION_PREDICATE.sentiment) {
    pills.push(pill('sentiment', 'Sentiment', labelFor(MENTION_SENTIMENT_OPTIONS, predicate.sentiment)));
  }
  if (predicate.relevance !== DEFAULT_MENTION_PREDICATE.relevance) {
    pills.push(pill('relevance', 'Relevance', labelFor(MENTION_RELEVANCE_OPTIONS, predicate.relevance)));
  }
  if (predicate.language !== DEFAULT_MENTION_PREDICATE.language) {
    pills.push(pill('language', 'Language', capitalizeFirst(predicate.language)));
  }
  if (predicate.hasTitle !== DEFAULT_MENTION_PREDICATE.hasTitle) {
    pills.push(pill('hasTitle', 'Has Title', labelFor(MENTION_HAS_TITLE_OPTIONS, predicate.hasTitle)));
  }
  if (predicate.keywords.length > 0) {
    const { summary, full } = summarizePillValues(predicate.keywords);
    pills.push(pill('keywords', 'Keywords', summary, full));
  }
  if (predicate.tags.length > 0) {
    const { summary, full } = summarizePillValues(predicate.tags.map(formatTag));
    pills.push(pill('tags', 'Tags', summary, full));
  }
  if (predicate.authors.length > 0) {
    const { summary, full } = summarizePillValues(predicate.authors);
    pills.push(pill('authors', 'Authors', summary, full));
  }
  if (predicate.search !== DEFAULT_MENTION_PREDICATE.search) {
    pills.push(pill('search', 'Search', predicate.search));
  }
  return pills;
}
