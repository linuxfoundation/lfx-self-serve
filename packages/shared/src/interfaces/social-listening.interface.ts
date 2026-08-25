// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Social Listening domain contracts — shared by the Angular app and the Express server (PCC port). Types only; runtime values live in the constants file. */

import type { SOCIAL_LISTENING_PREFERENCE_NAME_PREFIXES } from '../constants/social-listening.constants';
import type { TagSeverity } from './components.interface';

// ---------------------------------------------------------------------------
// Value unions
// ---------------------------------------------------------------------------

export type MentionPlatform = 'twitter' | 'bluesky' | 'reddit' | 'youtube' | 'facebook' | 'hackernews' | 'dev' | 'podcasts' | 'github' | 'linkedin' | 'other';

export type MentionSentiment = 'positive' | 'neutral' | 'negative';

export type MentionRelevance = 'high' | 'low';

export type SocialListeningTab = 'feed' | 'analytics';

/** Bookmark filter: `bookmarked` restricts the feed to the user's persisted bookmark IDs — all-time, so the server skips the date window. */
export type SocialListeningBookmarkFilter = 'all' | 'bookmarked';

/** Read filter: `unread` narrows the loaded feed window to mentions the user hasn't read — a client-side view filter, never a request param. */
export type SocialListeningReadFilter = 'all' | 'unread';

/** Preference-name prefixes the BFF proxy accepts — derived from the constants tuple so the two can never drift. */
export type SocialListeningPreferenceNamePrefix = (typeof SOCIAL_LISTENING_PREFERENCE_NAME_PREFIXES)[number];

// ---------------------------------------------------------------------------
// Snowflake row shapes (UPPER_SNAKE, as returned by ANALYTICS.PLATINUM.SOCIAL_LISTENING_FEED)
// ---------------------------------------------------------------------------

/**
 * Raw feed row. PCC's `BOOKMARKED` (deferred follow-up) and index signature (defeats excess-property checking) are deliberately not ported.
 * Columns `mapRawToMention` absorbs with `|| ''` are typed nullable — Snowflake emits NULLs (e.g. `TITLE IS NULL` is a supported filter).
 */
export interface SocialListeningMention {
  MENTION_ID: string;
  PROJECT_ID: string;
  PROJECT_NAME: string;
  PROJECT_SLUG: string;
  SOURCE_PROJECT_ID: string;
  SOURCE_PROJECT_NAME: string;
  TITLE: string | null;
  BODY: string | null;
  AUTHOR: string | null;
  AUTHOR_PROFILE_LINK: string | null;
  SOURCE_PLATFORM: string | null;
  SOCIAL_NETWORK: string | null;
  SENTIMENT: string | null;
  RELEVANCE_SCORE: string | null;
  RELEVANCE_COMMENT: string | null;
  URL: string | null;
  IMAGE_URL: string | null;
  SUBREDDIT: string | null;
  VIEW_NAME: string;
  MENTION_TS: string | null;
  KEYWORD: string | null;
  LANGUAGE: string | null;
  /** Comma-separated tag list — split client-side in mapRawToMention. */
  TAGS: string | null;
  COMPUTED_AT?: string;
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

/** Tag with usage count. The single `mentions-tags` endpoint serves both the tag filter dropdown and the analytics top-tags panel (PCC's separate `analytics-tags` was dropped). */
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
  /** Bookmark mode: restrict to these mention IDs (feed + count only — analytics and option queries omit it). */
  mentionIds?: string[];
  /** Unread view: apply the per-user read-state exclusion (feed + count only — analytics and option queries omit these). */
  unreadOnly?: boolean;
  /** Read-state overrides: explicit reads newer than the cutoff. */
  readIds?: string[];
  /** Read-state overrides: explicit unreads at or before the cutoff. */
  unreadIds?: string[];
  /** Mark-all-as-read cutoff: mentions at or before it are read unless in `unreadIds`. */
  readBeforeTs?: string;
}

export interface SocialListeningPaginationParams {
  limit: number;
  offset: number;
}

export interface SocialListeningFeedParams extends SocialListeningScopeParams, SocialListeningFilterParams, SocialListeningPaginationParams {}

export interface SocialListeningCountParams extends SocialListeningScopeParams, SocialListeningFilterParams {}

/** Tag options: same predicate as the count query, plus a caller-chosen cap (analytics wants the top N, the filter panel wants the full list). */
export interface SocialListeningTagsParams extends SocialListeningCountParams {
  limit?: number;
}

/** Author options cascade off every other filter, but must not filter by themselves — nor by per-user bookmark/read state. */
export type SocialListeningAuthorsParams = Omit<SocialListeningCountParams, 'authors' | 'mentionIds' | 'unreadOnly' | 'readIds' | 'unreadIds' | 'readBeforeTs'>;

/** Languages / keywords / tags option queries: scoped by range, optionally narrowed by platform + sub-project. */
export interface SocialListeningScopedOptionsParams extends SocialListeningScopeParams {
  platform?: string;
  sourceProjectId?: string;
}

/** Sub-projects / platforms option queries: scoped by foundation only. */
export interface SocialListeningOptionsParams {
  foundationSlug: string;
}

export interface SocialListeningAnalyticsParams extends SocialListeningScopeParams, SocialListeningFilterParams {
  limit?: number;
}

// ---------------------------------------------------------------------------
// Client request params (Angular service → REST query string; period token, not dates)
// ---------------------------------------------------------------------------

/** Client-side filter fragment: camelCase values already stripped of `'all'`/empty sentinels by `buildMentionFilters`. */
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
  /** Bookmark mode: restrict to these mention IDs (feed + count only — the page strips it before analytics). */
  mentionIds?: string[];
  /** Unread view: server-side read-state exclusion (feed + count only — the page strips these before analytics). */
  unreadOnly?: boolean;
  readIds?: string[];
  unreadIds?: string[];
  readBeforeTs?: string;
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

/** Analytics panels take the same feed predicate as the feed/count endpoints, so the two tabs agree. */
export interface SocialListeningAnalyticsRequest extends MentionFilters {
  foundationSlug: string;
  period?: string;
  limit?: number;
}

/** Tags back two callers: the filter panel (scope only, explicit cap) and the analytics panel (full predicate, default cap). */
export type SocialListeningTagsRequest = SocialListeningAnalyticsRequest;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** Feed page. `total` deliberately lives on the separate count endpoint so the feed never claims a total it doesn't compute. */
export interface SocialListeningFeedResponse {
  mentions: SocialListeningMention[];
  /** dbt rebuild timestamp carried on every row, read off the newest one — surfaced as "Data as of". */
  computedAt: string | null;
}

export interface SocialListeningCountResponse {
  total: number;
}

/** A cached feed window. `complete` distinguishes a fully filled window from one phase 2 has not finished (or never finished) filling. */
export interface SocialListeningWindowCacheEntry extends SocialListeningFeedResponse {
  complete: boolean;
  /** Phase 2 failed past its one automatic retry — the partial window is kept so the list can offer a manual retry. */
  phase2Failed?: boolean;
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
  /** Tailwind bg-color class for the analytics platform-distribution bar (no hex — repo styling rule). */
  barClass: string;
}

/** Display config for a sentiment value (see `MENTION_SENTIMENT_CONFIG`). */
export interface MentionSentimentConfigEntry {
  icon: string;
  label: string;
  severity: TagSeverity;
  /** Tailwind bg-color class for the analytics sentiment-distribution bar segment (no hex — repo styling rule). */
  barClass: string;
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

/** Analytics platform-distribution row with display config pre-resolved (built by `mapPlatformDistributionRows`). */
export interface SocialListeningPlatformRow {
  config: MentionPlatformConfigEntry;
  mentionsCount: number;
  /** 0–100 share of in-scope mentions, one decimal (server-rounded). */
  percentOfTotal: number;
}

/** Analytics sentiment-distribution row with display config pre-resolved (built by `mapSentimentRows`). */
export interface SocialListeningSentimentRow {
  sentiment: MentionSentiment;
  config: MentionSentimentConfigEntry;
  mentionCount: number;
  /** 0–100 share of in-scope mentions, one decimal (server-rounded). */
  percentOfTotal: number;
}

/** Declarative fetch state for the toSignal pipelines. */
export interface LoadableState<T> {
  loading: boolean;
  error: string | null;
  data: T;
}

// ---------------------------------------------------------------------------
// Per-user preference payloads (LFXV2-3002)
// ---------------------------------------------------------------------------

/** Persisted read-state doc (preference `Social Listening Read State - <projectId>`): the mark-all cutoff plus explicit per-mention overrides on either side of it. */
export interface ReadStateData {
  /** Newest loaded `MENTION_TS` at mark-all-as-read time — never wall-clock, so backfilled mentions aren't silently hidden. */
  readBeforeTs: string | null;
  readIds: string[];
  unreadIds: string[];
}

// ---------------------------------------------------------------------------
// Filter predicate + URL-synced scope
// ---------------------------------------------------------------------------

/** URL-synced filter state. `readFilter` round-trips through query params like the rest; in unread mode the page snapshots the persisted read state onto the feed/count requests as the `unreadOnly` fragment (analytics and option queries stay read-state-blind). */
export interface FilterPredicate {
  sentiment: string;
  relevance: string;
  language: string;
  hasTitle: string;
  bookmarkFilter: SocialListeningBookmarkFilter;
  readFilter: SocialListeningReadFilter;
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

/** URL-tracked state outside FilterPredicate: it changes the visible data but is independent of saved views, so applying a view never overwrites the current scope. */
export interface ScopeState {
  activeTab: SocialListeningTab;
  period: string;
  sourceProjectId: string;
  platform: string;
}

/** Per-user saved view (LFXV2-3002 Block 3, PCC parity) — the unit saved views persist and `?view=` deep-links reference. */
export interface SavedFilter {
  /** UUID v4, client-generated; stable for URL ?view= sharing. */
  id: string;
  name: string;
  predicate: FilterPredicate;
  scope: SavedViewScope;
  /** ISO timestamp. */
  createdAt: string;
}

/** Persisted preference doc for saved views — `version` gates future migrations; an unknown version parses read-only. */
export interface SavedFiltersDoc {
  version: number;
  filters: SavedFilter[];
}

// ---------------------------------------------------------------------------
// Signal bundles consumed by the filter utils
// ---------------------------------------------------------------------------

/** Structural subset of Angular's `WritableSignal` (`()` read + `set`) — keeps `@angular/core` out of the server-consumed shared package. */
export interface WritableSignalLike<T> {
  (): T;
  set(value: T): void;
}

export interface SocialListeningSignals {
  selectedSentiment: WritableSignalLike<string>;
  selectedRelevance: WritableSignalLike<string>;
  selectedLanguage: WritableSignalLike<string>;
  selectedHasTitle: WritableSignalLike<string>;
  selectedBookmarkFilter: WritableSignalLike<string>;
  selectedReadFilter: WritableSignalLike<string>;
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
