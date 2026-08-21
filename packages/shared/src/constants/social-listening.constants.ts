// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Social Listening runtime constants — option lists double as server-side validation whitelists (3015). No hex colors (styling rule): Tailwind `colorClass` + `TagSeverity`. */

import type {
  FilterPredicate,
  MentionPlatform,
  MentionPlatformConfigEntry,
  MentionRelevance,
  MentionRelevanceConfigEntry,
  MentionSentiment,
  MentionSentimentConfigEntry,
  ReadStateData,
  SavedViewScope,
  ScopeState,
  SocialListeningOption,
} from '../interfaces/social-listening.interface';
import { lfxColors } from './colors.constants';

// ---------------------------------------------------------------------------
// Display config
// ---------------------------------------------------------------------------

export const MENTION_PLATFORM_CONFIG: Record<MentionPlatform, MentionPlatformConfigEntry> = {
  twitter: { icon: 'fa-brands fa-x-twitter', label: 'Twitter / X', colorClass: 'text-gray-900', barClass: 'bg-gray-900' },
  bluesky: { icon: 'fa-brands fa-bluesky', label: 'Bluesky', colorClass: 'text-sky-500', barClass: 'bg-sky-500' },
  reddit: { icon: 'fa-brands fa-reddit', label: 'Reddit', colorClass: 'text-orange-600', barClass: 'bg-orange-600' },
  youtube: { icon: 'fa-brands fa-youtube', label: 'YouTube', colorClass: 'text-red-600', barClass: 'bg-red-600' },
  facebook: { icon: 'fa-brands fa-facebook', label: 'Facebook', colorClass: 'text-blue-600', barClass: 'bg-blue-600' },
  hackernews: { icon: 'fa-brands fa-hacker-news', label: 'Hacker News', colorClass: 'text-orange-500', barClass: 'bg-orange-500' },
  dev: { icon: 'fa-brands fa-dev', label: 'DEV', colorClass: 'text-gray-900', barClass: 'bg-gray-900' },
  podcasts: { icon: 'fa-light fa-podcast', label: 'Podcasts', colorClass: 'text-purple-600', barClass: 'bg-purple-600' },
  github: { icon: 'fa-brands fa-github', label: 'GitHub', colorClass: 'text-gray-700', barClass: 'bg-gray-700' },
  linkedin: { icon: 'fa-brands fa-linkedin', label: 'LinkedIn', colorClass: 'text-blue-700', barClass: 'bg-blue-700' },
  other: { icon: 'fa-light fa-globe', label: 'Other', colorClass: 'text-gray-500', barClass: 'bg-gray-500' },
};

export const MENTION_SENTIMENT_CONFIG: Record<MentionSentiment, MentionSentimentConfigEntry> = {
  positive: { icon: 'fa-light fa-face-smile', label: 'Positive', severity: 'success', barClass: 'bg-emerald-500' },
  neutral: { icon: 'fa-light fa-face-meh', label: 'Neutral', severity: 'secondary', barClass: 'bg-amber-400' },
  negative: { icon: 'fa-light fa-thumbs-down', label: 'Negative', severity: 'danger', barClass: 'bg-red-500' },
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

export const MENTION_BOOKMARK_FILTER_OPTIONS: SocialListeningOption[] = [
  { label: 'All', value: 'all' },
  { label: 'Bookmarked', value: 'bookmarked' },
];

export const MENTION_READ_FILTER_OPTIONS: SocialListeningOption[] = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
];

// ---------------------------------------------------------------------------
// Pagination + limits
// ---------------------------------------------------------------------------

export const MENTION_PAGE_SIZE_OPTIONS: number[] = [10, 20, 50, 100];
export const DEFAULT_MENTION_PAGE_SIZE = 20;

/** Server fetch window: the client caches ±2 windows of this size around the visible page. */
export const MENTION_SERVER_WINDOW_SIZE = 100;

/** Deepest feed offset the server honors — past ~1000 windows a paginated request is a scan, not navigation. */
export const MENTION_MAX_FEED_OFFSET = 100_000;
export const MENTION_MAX_CACHED_WINDOWS = 2;

/** Cap for array-valued filters (keywords / tags / authors) — enforced at the HTTP boundary and in the SQL builder. */
export const MENTION_FILTER_MAX_VALUES = 200;

/** UI selection cap per array filter — keeps deep-link URLs within the ~8 KB budget common proxies allow; the server cap stays 200. */
export const MENTION_FILTER_UI_MAX_VALUES = 50;

/** Cap for the bookmarked-mentions filter — bounds the bookmark store, the HTTP boundary, and the SQL builder. */
export const MENTION_IDS_MAX_VALUES = 500;

/** Cap per read-state ID array (`readIds`/`unreadIds`) — same value as the bookmark cap, distinct semantic: cutoff overrides, not a query bound. */
export const MAX_READ_IDS = 500;

/** Row cap for the `mentions-tags` endpoint — serves both the tag filter dropdown and the analytics top-tags panel. */
export const MENTION_TOP_TAGS_LIMIT = 10;

/** Row cap for the analytics platform-distribution panel (client-side slice; the endpoint returns all platforms). */
export const ANALYTICS_TOP_PLATFORMS_LIMIT = 5;

/** Row cap requested for the analytics top-projects panel (mirrors the server's `TOP_PROJECTS_LIMIT` default). */
export const ANALYTICS_TOP_PROJECTS_LIMIT = 5;

/**
 * Series colors for the analytics charts (LFXV2-3018) — `lfxColors` scales only (styling rule).
 * Index 0 is the "Total" line; other series cycle from index 1 (500s first, then 300s).
 */
export const SOCIAL_LISTENING_CHART_PALETTE: string[] = [
  lfxColors.gray[900],
  lfxColors.blue[500],
  lfxColors.emerald[500],
  lfxColors.amber[500],
  lfxColors.red[500],
  lfxColors.violet[500],
  lfxColors.blue[300],
  lfxColors.emerald[300],
  lfxColors.amber[300],
  lfxColors.violet[300],
];

/** Interval for refreshing relative timestamps ("2h ago") on rendered mention cards. */
export const MENTION_TIME_TICK_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const MENTION_SEARCH_DEBOUNCE_MS = 500;
export const MENTION_SEARCH_MIN_CHARS = 3;

/** Server-side feed `BODY` cap (`LEFT(BODY, n)`) — 2× the forward-by-email excerpt budget below, bounding feed payloads; expanded cards truncate past this (product-visible). */
export const MENTION_FEED_BODY_MAX_CHARS = 1000;

/** Plain-text body cap for the forward-by-email mailto: keeps the href under the ~2000-char URL limit mail clients enforce. */
export const MENTION_FORWARD_EMAIL_BODY_MAX_CHARS = 500;

/** Encoded-length cap for the same body — CJK/emoji expand ~3–9× under `encodeURIComponent`, so the raw cap alone can't bound the href. */
export const MENTION_FORWARD_EMAIL_BODY_MAX_ENCODED_CHARS = 1200;

/** Tab-cycle candidates for the filters panel's focus trap — the interactive elements PrimeNG wrappers actually render. */
export const FILTERS_PANEL_FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ---------------------------------------------------------------------------
// Query-param keys + defaults
// ---------------------------------------------------------------------------

/**
 * URL query-param keys for the predicate + scope round-trip; PCC's `view` key is dropped (Block 3) and `range` is renamed to `period`.
 * This page must own its route — before any embedded-shell composition, namespace the generic keys (`tab`, `q`, e.g. `slTab`).
 */
export const SOCIAL_LISTENING_QUERY_PARAMS = {
  tab: 'tab',
  period: 'period',
  // `?project=` is reserved app-wide (projectQueryParamGuard / ProjectContextService rewrite it for
  // the foundation context), so the sub-project filter — a Snowflake SOURCE_PROJECT_ID — gets its own key.
  sourceProject: 'sourceProject',
  platform: 'platform',
  sentiment: 'sentiment',
  relevance: 'relevance',
  language: 'language',
  hasTitle: 'hasTitle',
  bookmarks: 'bookmarks',
  read: 'read',
  keywords: 'keywords',
  tags: 'tags',
  authors: 'authors',
  search: 'q',
} as const;

/** Default predicate. Consumers must clone the array fields before mutating — `predicateFromSignals`/`applyPredicateToSignals` already do. */
export const DEFAULT_MENTION_PREDICATE: FilterPredicate = {
  sentiment: 'all',
  relevance: 'all',
  language: 'all',
  hasTitle: 'all',
  bookmarkFilter: 'all',
  readFilter: 'all',
  keywords: [],
  tags: [],
  authors: [],
  search: '',
};

/** `period` is deliberately `''` — the real default resolves at runtime via `getDefaultMarketingImpactPeriod()`, so codec helpers take `defaultPeriod` as an argument. */
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

// ---------------------------------------------------------------------------
// Per-user preference names (v1 user-service, LFXV2-3002 Block 0)
// ---------------------------------------------------------------------------

/** Kept as `'PCC'` so preferences written by PCC Social Listening resolve in Self Serve verbatim. */
export const SOCIAL_LISTENING_PREFERENCE_APP_NAME = 'PCC';

// Exact PCC name strings — upstream uniqueness is case-insensitive, so the builder must not paraphrase them.
export const SOCIAL_LISTENING_BOOKMARKS_PREFERENCE_PREFIX = 'Social Listening Bookmarks';
export const SOCIAL_LISTENING_READ_STATE_PREFERENCE_PREFIX = 'Social Listening Read State';
export const SOCIAL_LISTENING_SAVED_FILTERS_PREFERENCE_PREFIX = 'Social Listening Saved Filters';

/** Allowlist the BFF preference proxy validates `:name` against. */
export const SOCIAL_LISTENING_PREFERENCE_NAME_PREFIXES = [
  SOCIAL_LISTENING_BOOKMARKS_PREFERENCE_PREFIX,
  SOCIAL_LISTENING_READ_STATE_PREFERENCE_PREFIX,
  SOCIAL_LISTENING_SAVED_FILTERS_PREFERENCE_PREFIX,
] as const;

/** Empty read-state doc — mark-all-as-unread writes it (no DELETE) and corrupt docs parse to it. */
export const EMPTY_READ_STATE: ReadStateData = { readBeforeTs: null, readIds: [], unreadIds: [] };
