// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Social Listening domain contracts — shared by the Angular app and the Express server.
 * Ported from PCC (lfxv2-3002-todo.md §0); types only — runtime values live in the constants file.
 */

import type { TagSeverity } from './components.interface';

// ---------------------------------------------------------------------------
// Value unions
// ---------------------------------------------------------------------------

export type MentionPlatform = 'twitter' | 'bluesky' | 'reddit' | 'youtube' | 'facebook' | 'hackernews' | 'dev' | 'podcasts' | 'github' | 'linkedin' | 'other';

export type MentionSentiment = 'positive' | 'neutral' | 'negative';

export type MentionRelevance = 'high' | 'low';

export type SocialListeningTab = 'feed' | 'analytics';

// ---------------------------------------------------------------------------
// Snowflake row shapes (UPPER_SNAKE, as returned by ANALYTICS.PLATINUM.SOCIAL_LISTENING_FEED)
// ---------------------------------------------------------------------------

/**
 * Raw feed row. PCC's `BOOKMARKED` (deferred follow-up) and `[key: string]: unknown`
 * index signature (defeats excess-property checking) are deliberately not ported.
 */
export interface SocialListeningMention {
  MENTION_ID: string;
  PROJECT_ID: string;
  PROJECT_NAME: string;
  PROJECT_SLUG: string;
  SOURCE_PROJECT_ID: string;
  SOURCE_PROJECT_NAME: string;
  TITLE: string;
  BODY: string;
  AUTHOR: string;
  AUTHOR_PROFILE_LINK: string;
  SOURCE_PLATFORM: string;
  SOCIAL_NETWORK: string;
  SENTIMENT: string | null;
  RELEVANCE_SCORE: string;
  RELEVANCE_COMMENT: string;
  URL: string;
  IMAGE_URL: string;
  SUBREDDIT: string;
  VIEW_NAME: string;
  MENTION_TS: string;
  KEYWORD: string;
  LANGUAGE: string;
  /** Comma-separated tag list — split client-side in mapRawToMention. */
  TAGS: string;
  COMPUTED_AT?: string;
}

export interface SocialListeningMentionCount {
  TOTAL: number;
}

export interface SocialListeningMentionAuthor {
  AUTHOR: string;
  PLATFORM: string;
  MENTION_COUNT: number;
}

export interface SocialListeningPlatform {
  SOURCE_PLATFORM: string;
  SOCIAL_NETWORK: string;
}

export interface SocialListeningSubProject {
  SOURCE_PROJECT_ID: string;
  SOURCE_PROJECT_NAME: string;
}

export interface SocialListeningTag {
  TAG: string | null;
}

/**
 * Tag with usage count. The single `mentions-tags` endpoint serves both the tag
 * filter dropdown (ignores the count) and the analytics top-tags panel, so the
 * planned separate `analytics-tags` endpoint from PCC was dropped.
 */
export interface SocialListeningTagCount {
  TAG: string;
  TOTAL_COUNT: number;
}

// ---------------------------------------------------------------------------
// Analytics row shapes (aggregated from SOCIAL_LISTENING_FEED at query time)
// ---------------------------------------------------------------------------

export interface SocialListeningAnalyticsOverview {
  TOTAL_MENTIONS: number;
  /** Change vs. the previous equivalent-length period; null when the previous period had no mentions. */
  TOTAL_MENTIONS_CHANGE_PCT: number | null;
  CHILD_PROJECTS_COUNT: number;
  POSITIVE_SENTIMENT_PERCENT: number;
  NEGATIVE_SENTIMENT_PERCENT: number;
  POSITIVE_SENTIMENT_CHANGE_PCT: number | null;
  NEGATIVE_SENTIMENT_CHANGE_PCT: number | null;
}

export interface SocialListeningOverTimePoint {
  SOURCE_PROJECT_ID: string;
  SOURCE_PROJECT_NAME: string;
  PERIOD_LABEL: string;
  /** DATE_TRUNC bucket start (ISO date) — drives chart ordering; replaces PCC's PERIOD_NUMBER. */
  PERIOD_START: string;
  TOTAL_MENTIONS: number;
}

export interface SocialListeningPlatformDistribution {
  SOURCE_PLATFORM: string;
  SOCIAL_NETWORK: string;
  MENTIONS_COUNT: number;
  PERCENT_OF_TOTAL: number;
}

export interface SocialListeningSentimentDistribution {
  SENTIMENT: string;
  MENTION_COUNT: number;
  PERCENT_OF_TOTAL: number;
}

export interface SocialListeningTopProject {
  SOURCE_PROJECT_NAME: string;
  TOTAL_MENTIONS: number;
}

// ---------------------------------------------------------------------------
// Server query params (controller parses + validates into these)
// ---------------------------------------------------------------------------

/** Resolved scope: foundation slug + explicit MENTION_TS range (`resolvePeriodRange` output). */
export interface SocialListeningScopeParams {
  foundationSlug: string;
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  /** YYYY-MM-DD, exclusive. */
  endDate: string;
}

/** Validated feed filters. Every value is bound as a Snowflake bind parameter — never interpolated. */
export interface SocialListeningFilterParams {
  sentiment?: string;
  relevance?: string;
  platform?: string;
  sourceProjectId?: string;
  language?: string;
  hasTitle?: string;
  keywords?: string[];
  tags?: string[];
  authors?: string[];
  search?: string;
  /** Reserved for the deferred bookmarked-mentions filter (follow-up ticket). */
  mentionIds?: string[];
}

export interface SocialListeningPaginationParams {
  limit: number;
  offset: number;
}

export interface SocialListeningFeedParams extends SocialListeningScopeParams, SocialListeningFilterParams, SocialListeningPaginationParams {}

export interface SocialListeningCountParams extends SocialListeningScopeParams, SocialListeningFilterParams {}

/** Author options cascade off every other filter, but must not filter by themselves. */
export type SocialListeningAuthorsParams = Omit<SocialListeningCountParams, 'authors' | 'mentionIds'>;

/** Languages / keywords / tags option queries: scoped by range, optionally narrowed by platform + sub-project. */
export interface SocialListeningScopedOptionsParams extends SocialListeningScopeParams {
  platform?: string;
  sourceProjectId?: string;
}

/** Sub-projects / platforms option queries: scoped by foundation only. */
export interface SocialListeningOptionsParams {
  foundationSlug: string;
}

export interface SocialListeningAnalyticsParams extends SocialListeningScopeParams {
  platform?: string;
  sourceProjectId?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Client request params (Angular service → REST query string; period token, not dates)
// ---------------------------------------------------------------------------

/**
 * Client-side filter fragment. Values are camelCase and already stripped of
 * `'all'`/empty sentinels by `buildMentionFilters`.
 */
export interface MentionFilters {
  sentiment?: string;
  relevance?: string;
  platform?: string;
  keywords?: string[];
  tags?: string[];
  authors?: string[];
  sourceProjectId?: string;
  language?: string;
  hasTitle?: string;
  search?: string;
}

export interface SocialListeningFeedRequest extends MentionFilters {
  foundationSlug: string;
  /** Marketing-impact period token (`ytd`, `last-3`, `YYYY-MM`); server resolves via `getValidatedPeriod`. */
  period?: string;
  limit?: number;
  offset?: number;
}

export interface SocialListeningCountRequest extends MentionFilters {
  foundationSlug: string;
  period?: string;
}

/** Intentionally omits `authors` — a multiselect must not filter its own options. */
export type SocialListeningAuthorsRequest = Omit<SocialListeningCountRequest, 'authors'>;

export interface SocialListeningScopedOptionsRequest {
  foundationSlug: string;
  period?: string;
  platform?: string;
  sourceProjectId?: string;
}

export interface SocialListeningOptionsRequest {
  foundationSlug: string;
}

export interface SocialListeningAnalyticsRequest {
  foundationSlug: string;
  period?: string;
  platform?: string;
  sourceProjectId?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Feed page. `total` deliberately lives on the separate count endpoint
 * (`SocialListeningCountResponse`) so the feed never claims a total it doesn't compute.
 */
export interface SocialListeningFeedResponse {
  mentions: SocialListeningMention[];
  /** Watermark from MAX(COMPUTED_AT) — surfaced as "Data as of". */
  computedAt: string | null;
}

export interface SocialListeningCountResponse {
  total: number;
}

// ---------------------------------------------------------------------------
// View models (client-side)
// ---------------------------------------------------------------------------

/** UI-ready mention, mapped from `SocialListeningMention` by `mapRawToMention`. */
export interface Mention {
  id: string;
  platform: MentionPlatform;
  keyword: string;
  timestamp: string;
  authorName: string;
  authorProfileLink: string;
  title: string;
  content: string;
  analysis: string;
  sentiment: MentionSentiment;
  relevance: MentionRelevance;
  tags: string[];
  originalUrl: string;
  imageUrl: string;
  subreddit: string;
  language: string;
  /** Raw Snowflake row — preserves any columns added upstream. */
  raw: SocialListeningMention;
}

/** Label/value pair for select + multiselect wrappers. */
export interface SocialListeningOption {
  label: string;
  value: string;
}

/** Display config for a mention platform (see `MENTION_PLATFORM_CONFIG`). */
export interface MentionPlatformConfigEntry {
  icon: string;
  label: string;
  /** Tailwind text-color class (no hex — repo styling rule). */
  colorClass: string;
}

/** Display config for a sentiment value (see `MENTION_SENTIMENT_CONFIG`). */
export interface MentionSentimentConfigEntry {
  icon: string;
  label: string;
  severity: TagSeverity;
}

/** Display config for a relevance value (see `MENTION_RELEVANCE_CONFIG`). */
export interface MentionRelevanceConfigEntry {
  label: string;
  severity: TagSeverity;
}

/** Author row with platform icon pre-resolved for the filters multiselect. */
export interface AuthorOption extends SocialListeningMentionAuthor {
  platformIcon: string;
  /** Tailwind text-color class (no hex — repo styling rule). */
  platformIconClass: string;
}

/** Declarative fetch state for the toSignal pipelines. */
export interface LoadableState<T> {
  loading: boolean;
  error: string | null;
  data: T;
}

// ---------------------------------------------------------------------------
// Filter predicate + URL-synced scope
// ---------------------------------------------------------------------------

/**
 * URL-synced filter state. PCC's `bookmarkFilter` / `readFilter` keys are dropped
 * (deferred to the follow-up ticket); everything else round-trips through query params.
 */
export interface FilterPredicate {
  sentiment: string;
  relevance: string;
  language: string;
  hasTitle: string;
  keywords: string[];
  tags: string[];
  authors: string[];
  search: string;
}

/** Scope captured by a saved view. PCC's `range` became `period` (marketing-impact period token). */
export interface SavedViewScope {
  period: string;
  sourceProjectId: string;
  platform: string;
}

/**
 * URL-tracked state that lives outside FilterPredicate: it changes the data the
 * user sees but is independent of saved views, so applying a view never
 * overwrites the user's current scope.
 */
export interface ScopeState {
  activeTab: SocialListeningTab;
  period: string;
  sourceProjectId: string;
  platform: string;
}

/**
 * Reserved for the deferred saved-views follow-up ticket. Kept now so the
 * query-param encode/decode round-trip stays stable and saved views become
 * "persist a predicate" rather than a re-architecture.
 */
export interface SavedFilter {
  /** UUID v4, client-generated; stable for URL ?view= sharing. */
  id: string;
  name: string;
  predicate: FilterPredicate;
  scope: SavedViewScope;
  /** ISO timestamp. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Signal bundles consumed by the filter utils
// ---------------------------------------------------------------------------

/**
 * Structural subset of Angular's `WritableSignal` (`()` read + `set`). Keeps
 * `@angular/core` out of the shared package the Express server also consumes.
 */
export interface WritableSignalLike<T> {
  (): T;
  set(value: T): void;
}

export interface SocialListeningSignals {
  selectedSentiment: WritableSignalLike<string>;
  selectedRelevance: WritableSignalLike<string>;
  selectedLanguage: WritableSignalLike<string>;
  selectedHasTitle: WritableSignalLike<string>;
  selectedKeywords: WritableSignalLike<string[]>;
  selectedTags: WritableSignalLike<string[]>;
  selectedAuthors: WritableSignalLike<string[]>;
  searchInput: WritableSignalLike<string>;
}

export interface SocialListeningScopeSignals {
  selectedPeriod: WritableSignalLike<string>;
  selectedProject: WritableSignalLike<string>;
  selectedPlatform: WritableSignalLike<string>;
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export type SocialListeningQueryParamValue = string | string[] | null | undefined;

/** Local stand-in for Angular's `Params` — keeps `@angular/router` out of the server-consumed shared package. */
export type SocialListeningQueryParams = Record<string, SocialListeningQueryParamValue>;
