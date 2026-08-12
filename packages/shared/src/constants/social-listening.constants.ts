// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Social Listening runtime constants — option lists double as server-side validation
 * whitelists (3015). No hex colors (styling rule): Tailwind `colorClass` + `TagSeverity`.
 */

import type {
  FilterPredicate,
  MentionPlatform,
  MentionPlatformConfigEntry,
  MentionRelevance,
  MentionRelevanceConfigEntry,
  MentionSentiment,
  MentionSentimentConfigEntry,
  SavedViewScope,
  ScopeState,
  SocialListeningOption,
} from '../interfaces/social-listening.interface';

// ---------------------------------------------------------------------------
// Display config
// ---------------------------------------------------------------------------

export const MENTION_PLATFORM_CONFIG: Record<MentionPlatform, MentionPlatformConfigEntry> = {
  twitter: { icon: 'fa-brands fa-x-twitter', label: 'Twitter / X', colorClass: 'text-gray-900' },
  bluesky: { icon: 'fa-brands fa-bluesky', label: 'Bluesky', colorClass: 'text-sky-500' },
  reddit: { icon: 'fa-brands fa-reddit', label: 'Reddit', colorClass: 'text-orange-600' },
  youtube: { icon: 'fa-brands fa-youtube', label: 'YouTube', colorClass: 'text-red-600' },
  facebook: { icon: 'fa-brands fa-facebook', label: 'Facebook', colorClass: 'text-blue-600' },
  hackernews: { icon: 'fa-brands fa-hacker-news', label: 'Hacker News', colorClass: 'text-orange-500' },
  dev: { icon: 'fa-brands fa-dev', label: 'DEV', colorClass: 'text-gray-900' },
  podcasts: { icon: 'fa-light fa-podcast', label: 'Podcasts', colorClass: 'text-purple-600' },
  github: { icon: 'fa-brands fa-github', label: 'GitHub', colorClass: 'text-gray-700' },
  linkedin: { icon: 'fa-brands fa-linkedin', label: 'LinkedIn', colorClass: 'text-blue-700' },
  other: { icon: 'fa-light fa-globe', label: 'Other', colorClass: 'text-gray-500' },
};

export const MENTION_SENTIMENT_CONFIG: Record<MentionSentiment, MentionSentimentConfigEntry> = {
  positive: { icon: 'fa-light fa-face-smile', label: 'Positive', severity: 'success' },
  neutral: { icon: 'fa-light fa-face-meh', label: 'Neutral', severity: 'secondary' },
  negative: { icon: 'fa-light fa-thumbs-down', label: 'Negative', severity: 'danger' },
};

export const MENTION_RELEVANCE_CONFIG: Record<MentionRelevance, MentionRelevanceConfigEntry> = {
  high: { label: 'High', severity: 'info' },
  low: { label: 'Low', severity: 'secondary' },
};

// ---------------------------------------------------------------------------
// Filter option lists (also used server-side to derive validation whitelists)
// ---------------------------------------------------------------------------

export const MENTION_SENTIMENT_OPTIONS: SocialListeningOption[] = [
  { label: 'All', value: 'all' },
  { label: 'Positive', value: 'positive' },
  { label: 'Neutral', value: 'neutral' },
  { label: 'Negative', value: 'negative' },
];

export const MENTION_RELEVANCE_OPTIONS: SocialListeningOption[] = [
  { label: 'All', value: 'all' },
  { label: 'High', value: 'high' },
  { label: 'Low', value: 'low' },
];

export const MENTION_HAS_TITLE_OPTIONS: SocialListeningOption[] = [
  { label: 'All', value: 'all' },
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

// ---------------------------------------------------------------------------
// Pagination + limits
// ---------------------------------------------------------------------------

export const MENTION_PAGE_SIZE_OPTIONS: number[] = [10, 20, 50, 100];
export const DEFAULT_MENTION_PAGE_SIZE = 20;

/** Server fetch window: the client caches ±2 windows of this size around the visible page. */
export const MENTION_SERVER_WINDOW_SIZE = 100;
export const MENTION_MAX_CACHED_WINDOWS = 2;

/** Cap for array-valued filters (keywords / tags / authors) — enforced at the HTTP boundary and in the SQL builder. */
export const MENTION_FILTER_MAX_VALUES = 200;

/** Reserved for the deferred bookmarked-mentions filter (follow-up ticket). */
export const MENTION_IDS_MAX_VALUES = 500;

/** Interval for refreshing relative timestamps ("2h ago") on rendered mention cards. */
export const MENTION_TIME_TICK_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const MENTION_SEARCH_DEBOUNCE_MS = 500;
export const MENTION_SEARCH_MIN_CHARS = 3;

// ---------------------------------------------------------------------------
// Query-param keys + defaults
// ---------------------------------------------------------------------------

/**
 * URL query-param keys for the filter predicate + scope round-trip. PCC's
 * `bookmarks` / `read` / `view` keys are dropped (deferred); `range` is renamed
 * to `period` to match the marketing-impact period vocabulary.
 */
export const SOCIAL_LISTENING_QUERY_PARAMS = {
  tab: 'tab',
  period: 'period',
  // `?project=` is reserved app-wide: projectQueryParamGuard consumes it to seed the foundation
  // context and ProjectContextService rewrites it on every context change. The sub-project filter
  // (a Snowflake SOURCE_PROJECT_ID, not a foundation slug) must use its own key.
  sourceProject: 'sourceProject',
  platform: 'platform',
  sentiment: 'sentiment',
  relevance: 'relevance',
  language: 'language',
  hasTitle: 'hasTitle',
  keywords: 'keywords',
  tags: 'tags',
  authors: 'authors',
  search: 'q',
} as const;

/**
 * Default predicate. Consumers must clone the array fields before mutating —
 * `predicateFromSignals` / `applyPredicateToSignals` already do.
 */
export const DEFAULT_MENTION_PREDICATE: FilterPredicate = {
  sentiment: 'all',
  relevance: 'all',
  language: 'all',
  hasTitle: 'all',
  keywords: [],
  tags: [],
  authors: [],
  search: '',
};

/**
 * `period` is deliberately `''` — the real default is resolved at runtime by
 * `getDefaultMarketingImpactPeriod()`, so every encode/decode/compare helper in
 * `utils/social-listening-filter.utils.ts` takes `defaultPeriod` as an argument
 * rather than baking in a stale month.
 */
export const DEFAULT_MENTION_VIEW_SCOPE: SavedViewScope = {
  period: '',
  sourceProjectId: 'all',
  platform: 'all',
};

export const DEFAULT_MENTION_SCOPE_STATE: ScopeState = {
  activeTab: 'feed',
  period: '',
  sourceProjectId: 'all',
  platform: 'all',
};
