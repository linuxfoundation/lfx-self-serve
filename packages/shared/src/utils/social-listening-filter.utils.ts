// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Filter-predicate ⇄ signal ⇄ query-param codecs; `defaultPeriod` is always passed in. Multi-value
 * keys round-trip as string arrays (repeated params — commas survive). `SocialListeningQueryParams`
 * keeps `@angular/router` out of the server-consumed shared package.
 */

import {
  DEFAULT_MENTION_PREDICATE,
  DEFAULT_MENTION_SCOPE_STATE,
  DEFAULT_MENTION_VIEW_SCOPE,
  MENTION_HAS_TITLE_OPTIONS,
  MENTION_RELEVANCE_OPTIONS,
  MENTION_SEARCH_MIN_CHARS,
  MENTION_SENTIMENT_OPTIONS,
  SAVED_FILTERS_DOC_VERSION,
  SOCIAL_LISTENING_QUERY_PARAMS,
} from '../constants/social-listening.constants';
import type {
  FilterPredicate,
  SavedFilter,
  SavedFiltersDoc,
  SavedViewScope,
  ScopeState,
  SocialListeningQueryParams,
  SocialListeningScopeSignals,
  SocialListeningSignals,
} from '../interfaces/social-listening.interface';
import type { ParseResult } from '../interfaces/user-preference.interface';
import { getDefaultMarketingImpactPeriod, resolvePeriodRange } from './marketing-impact.utils';
import { normalizeKeywords } from './social-listening.utils';

export function predicateFromSignals(s: SocialListeningSignals): FilterPredicate {
  // Shallow-clone array fields so saved-view snapshots, defaults, and live signals never
  // share the same array instance (prevents cross-mutation if any caller mutates in place).
  return {
    sentiment: s.selectedSentiment(),
    relevance: s.selectedRelevance(),
    language: s.selectedLanguage(),
    hasTitle: s.selectedHasTitle(),
    bookmarkFilter: s.selectedBookmarkFilter() === 'bookmarked' ? 'bookmarked' : DEFAULT_MENTION_PREDICATE.bookmarkFilter,
    readFilter: s.selectedReadFilter() === 'unread' ? 'unread' : DEFAULT_MENTION_PREDICATE.readFilter,
    keywords: normalizeKeywords(s.selectedKeywords() ?? []),
    tags: [...(s.selectedTags() ?? [])],
    authors: [...(s.selectedAuthors() ?? [])],
    search: s.searchInput(),
  };
}

export function applyPredicateToSignals(p: FilterPredicate, s: SocialListeningSignals): void {
  s.selectedSentiment.set(p.sentiment);
  s.selectedRelevance.set(p.relevance);
  s.selectedLanguage.set(p.language);
  s.selectedHasTitle.set(p.hasTitle);
  s.selectedBookmarkFilter.set(p.bookmarkFilter);
  s.selectedReadFilter.set(p.readFilter);
  s.selectedKeywords.set(normalizeKeywords([...p.keywords]));
  s.selectedTags.set([...p.tags]);
  s.selectedAuthors.set([...p.authors]);
  s.searchInput.set(p.search);
}

/** Trims and applies the min-chars gate — below `MENTION_SEARCH_MIN_CHARS` the search is treated as absent. */
export function normalizeMentionSearch(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= MENTION_SEARCH_MIN_CHARS ? trimmed : '';
}

export function viewScopeFromSignals(s: SocialListeningScopeSignals): SavedViewScope {
  return {
    period: s.selectedPeriod(),
    sourceProjectId: s.selectedProject(),
    platform: s.selectedPlatform(),
  };
}

export function applyViewScopeToSignals(scope: SavedViewScope, s: SocialListeningScopeSignals): void {
  s.selectedPeriod.set(scope.period);
  s.selectedProject.set(scope.sourceProjectId);
  s.selectedPlatform.set(scope.platform);
}

/** Coerces unknown input into a valid SavedViewScope. Missing/invalid fields fall back to defaults. */
export function normalizeViewScope(raw: unknown, defaultPeriod: string): SavedViewScope {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_MENTION_VIEW_SCOPE, period: defaultPeriod };
  }
  const s = raw as Partial<SavedViewScope>;
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
  return {
    // Resolve like the URL decoder — an obsolete/malformed persisted period falls back instead of 400ing every request.
    period: coercePeriod(typeof s.period === 'string' ? s.period : undefined, defaultPeriod),
    sourceProjectId: str(s.sourceProjectId, DEFAULT_MENTION_VIEW_SCOPE.sourceProjectId),
    platform: str(s.platform, DEFAULT_MENTION_VIEW_SCOPE.platform),
  };
}

export function isDefaultViewScope(s: SavedViewScope, defaultPeriod: string): boolean {
  return s.period === defaultPeriod && s.sourceProjectId === DEFAULT_MENTION_VIEW_SCOPE.sourceProjectId && s.platform === DEFAULT_MENTION_VIEW_SCOPE.platform;
}

export function viewScopesEqual(a: SavedViewScope, b: SavedViewScope): boolean {
  return a.period === b.period && a.sourceProjectId === b.sourceProjectId && a.platform === b.platform;
}

/** Coerces unknown input into a valid FilterPredicate so a corrupted value can't crash applyPredicateToSignals. */
export function normalizePredicate(raw: unknown): FilterPredicate {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [] };
  }
  const p = raw as Partial<FilterPredicate>;
  const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    // Enum-backed fields coerce against the shared option sets like the URL decoder — a stale v1 value
    // (e.g. sentiment "mixed") would otherwise pass here and 400 every feed request at the BFF.
    sentiment: coerceLiteral(p.sentiment, SENTIMENT_VALUES, DEFAULT_MENTION_PREDICATE.sentiment),
    relevance: coerceLiteral(p.relevance, RELEVANCE_VALUES, DEFAULT_MENTION_PREDICATE.relevance),
    language: str(p.language, DEFAULT_MENTION_PREDICATE.language),
    hasTitle: coerceLiteral(p.hasTitle, HAS_TITLE_VALUES, DEFAULT_MENTION_PREDICATE.hasTitle),
    bookmarkFilter: p.bookmarkFilter === 'bookmarked' ? 'bookmarked' : DEFAULT_MENTION_PREDICATE.bookmarkFilter,
    readFilter: p.readFilter === 'unread' ? 'unread' : DEFAULT_MENTION_PREDICATE.readFilter,
    keywords: normalizeKeywords(strArr(p.keywords)),
    tags: strArr(p.tags),
    authors: strArr(p.authors),
    search: str(p.search, DEFAULT_MENTION_PREDICATE.search),
  };
}

export function isEmptyPredicate(p: FilterPredicate): boolean {
  return (
    p.sentiment === DEFAULT_MENTION_PREDICATE.sentiment &&
    p.relevance === DEFAULT_MENTION_PREDICATE.relevance &&
    p.language === DEFAULT_MENTION_PREDICATE.language &&
    p.hasTitle === DEFAULT_MENTION_PREDICATE.hasTitle &&
    p.bookmarkFilter === DEFAULT_MENTION_PREDICATE.bookmarkFilter &&
    p.readFilter === DEFAULT_MENTION_PREDICATE.readFilter &&
    p.keywords.length === 0 &&
    p.tags.length === 0 &&
    p.authors.length === 0 &&
    p.search === DEFAULT_MENTION_PREDICATE.search
  );
}

/** Count of active (non-default) predicate dimensions — backs the Filters button count badge. */
export function countActiveFilters(p: FilterPredicate): number {
  let count = 0;
  if (p.sentiment !== DEFAULT_MENTION_PREDICATE.sentiment) count++;
  if (p.relevance !== DEFAULT_MENTION_PREDICATE.relevance) count++;
  if (p.language !== DEFAULT_MENTION_PREDICATE.language) count++;
  if (p.hasTitle !== DEFAULT_MENTION_PREDICATE.hasTitle) count++;
  if (p.bookmarkFilter !== DEFAULT_MENTION_PREDICATE.bookmarkFilter) count++;
  if (p.readFilter !== DEFAULT_MENTION_PREDICATE.readFilter) count++;
  if (p.keywords.length > 0) count++;
  if (p.tags.length > 0) count++;
  if (p.authors.length > 0) count++;
  if (p.search !== DEFAULT_MENTION_PREDICATE.search) count++;
  return count;
}

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function predicatesEqual(a: FilterPredicate, b: FilterPredicate): boolean {
  return (
    a.sentiment === b.sentiment &&
    a.relevance === b.relevance &&
    a.language === b.language &&
    a.hasTitle === b.hasTitle &&
    a.bookmarkFilter === b.bookmarkFilter &&
    a.readFilter === b.readFilter &&
    sortedEqual(a.keywords, b.keywords) &&
    sortedEqual(a.tags, b.tags) &&
    sortedEqual(a.authors, b.authors) &&
    a.search === b.search
  );
}

/** Asymmetric with `predicatesEqual`: `search` is a refinement the user can change without losing the active saved-view label (PCC port). */
export function sameSavedViewLabelPredicate(a: FilterPredicate, b: FilterPredicate): boolean {
  return (
    a.sentiment === b.sentiment &&
    a.relevance === b.relevance &&
    a.language === b.language &&
    a.hasTitle === b.hasTitle &&
    a.bookmarkFilter === b.bookmarkFilter &&
    a.readFilter === b.readFilter &&
    sortedEqual(a.keywords, b.keywords) &&
    sortedEqual(a.tags, b.tags) &&
    sortedEqual(a.authors, b.authors)
  );
}

function asScalar(value: string | string[] | null | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value;
  return undefined;
}

/** Multi-valued keys arrive as a string array from the router (repeated params); a lone value collapses to a scalar. */
function asMultiValue(value: string | string[] | null | undefined): string[] {
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && v !== '');
}

/** Explicit `null` at DEFAULT (or no active view) so `queryParamsHandling: 'merge'` strips the key from the URL; 3rd-party / utm_* keys survive. */
export function encodePredicateToQueryParams(p: FilterPredicate, scope: ScopeState, viewId: string | null, defaultPeriod: string): SocialListeningQueryParams {
  const q = SOCIAL_LISTENING_QUERY_PARAMS;
  return {
    [q.tab]: scope.activeTab === DEFAULT_MENTION_SCOPE_STATE.activeTab ? null : scope.activeTab,
    [q.period]: scope.period === defaultPeriod ? null : scope.period,
    [q.sourceProject]: scope.sourceProjectId === DEFAULT_MENTION_SCOPE_STATE.sourceProjectId ? null : scope.sourceProjectId,
    [q.platform]: scope.platform === DEFAULT_MENTION_SCOPE_STATE.platform ? null : scope.platform,
    [q.sentiment]: p.sentiment === DEFAULT_MENTION_PREDICATE.sentiment ? null : p.sentiment,
    [q.relevance]: p.relevance === DEFAULT_MENTION_PREDICATE.relevance ? null : p.relevance,
    [q.language]: p.language === DEFAULT_MENTION_PREDICATE.language ? null : p.language,
    [q.hasTitle]: p.hasTitle === DEFAULT_MENTION_PREDICATE.hasTitle ? null : p.hasTitle,
    [q.bookmarks]: p.bookmarkFilter === DEFAULT_MENTION_PREDICATE.bookmarkFilter ? null : p.bookmarkFilter,
    [q.read]: p.readFilter === DEFAULT_MENTION_PREDICATE.readFilter ? null : p.readFilter,
    [q.keywords]: p.keywords.length > 0 ? [...p.keywords] : null,
    [q.tags]: p.tags.length > 0 ? [...p.tags] : null,
    [q.authors]: p.authors.length > 0 ? [...p.authors] : null,
    [q.search]: p.search === DEFAULT_MENTION_PREDICATE.search ? null : p.search,
    [q.view]: viewId ?? null,
  };
}

// Derived from the shared option lists (not re-listed) so future option additions propagate.
const SENTIMENT_VALUES = new Set(MENTION_SENTIMENT_OPTIONS.map((o) => o.value));
const RELEVANCE_VALUES = new Set(MENTION_RELEVANCE_OPTIONS.map((o) => o.value));
const HAS_TITLE_VALUES = new Set(MENTION_HAS_TITLE_OPTIONS.map((o) => o.value));

function coerceLiteral(value: unknown, allowed: Set<string>, fallback: string): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

/** An unresolvable `?period=` falls back to the default instead of reaching the server as a 400. */
function coercePeriod(value: string | undefined, defaultPeriod: string): string {
  return value && resolvePeriodRange(value) ? value : defaultPeriod;
}

/** Falls back to DEFAULT for any missing key; coerces literals to valid union values. `viewId` is the raw `?view=` scalar, `null` when absent. */
export function decodePredicateFromQueryParams(
  params: SocialListeningQueryParams,
  defaultPeriod: string
): { predicate: FilterPredicate; scope: ScopeState; viewId: string | null } {
  const q = SOCIAL_LISTENING_QUERY_PARAMS;

  const activeTab: ScopeState['activeTab'] = asScalar(params[q.tab]) === 'analytics' ? 'analytics' : 'feed';

  const keywords = normalizeKeywords(asMultiValue(params[q.keywords]));
  const tags = asMultiValue(params[q.tags]);
  const authors = asMultiValue(params[q.authors]);

  const predicate: FilterPredicate = {
    sentiment: coerceLiteral(asScalar(params[q.sentiment]), SENTIMENT_VALUES, DEFAULT_MENTION_PREDICATE.sentiment),
    relevance: coerceLiteral(asScalar(params[q.relevance]), RELEVANCE_VALUES, DEFAULT_MENTION_PREDICATE.relevance),
    language: asScalar(params[q.language]) || DEFAULT_MENTION_PREDICATE.language,
    hasTitle: coerceLiteral(asScalar(params[q.hasTitle]), HAS_TITLE_VALUES, DEFAULT_MENTION_PREDICATE.hasTitle),
    // Anything but the exact active value coerces to the default — a crafted `?bookmarks=` can't wedge the predicate.
    bookmarkFilter: asScalar(params[q.bookmarks]) === 'bookmarked' ? 'bookmarked' : DEFAULT_MENTION_PREDICATE.bookmarkFilter,
    readFilter: asScalar(params[q.read]) === 'unread' ? 'unread' : DEFAULT_MENTION_PREDICATE.readFilter,
    keywords,
    tags,
    authors,
    search: asScalar(params[q.search]) ?? DEFAULT_MENTION_PREDICATE.search,
  };

  const scope: ScopeState = {
    activeTab,
    period: coercePeriod(asScalar(params[q.period]), defaultPeriod),
    sourceProjectId: asScalar(params[q.sourceProject]) || DEFAULT_MENTION_SCOPE_STATE.sourceProjectId,
    // Platform values are live upstream SOURCE_PLATFORM strings (e.g. `X`), not config keys — pass through like sourceProjectId.
    platform: asScalar(params[q.platform]) || DEFAULT_MENTION_SCOPE_STATE.platform,
  };

  return { predicate, scope, viewId: asScalar(params[q.view]) || null };
}

export function scopesEqual(a: ScopeState, b: ScopeState): boolean {
  return a.activeTab === b.activeTab && a.period === b.period && a.sourceProjectId === b.sourceProjectId && a.platform === b.platform;
}

/**
 * Compares only the codec-owned keys (live router params also carry `project` / `utm_*`);
 * multi-value keys compare as sets, and missing/null/empty-string are equivalent absences.
 */
export function queryParamsEqual(a: SocialListeningQueryParams, b: SocialListeningQueryParams): boolean {
  for (const key of Object.values(SOCIAL_LISTENING_QUERY_PARAMS)) {
    if (!sortedEqual(asMultiValue(a[key]), asMultiValue(b[key]))) return false;
  }
  return true;
}

/**
 * Parses the persisted saved-filters doc (PCC port): an unknown version, a non-array `filters`, or an
 * unparseable input yields a read-only fallback so a newer/foreign doc is never clobbered; malformed rows are salvaged past.
 */
export function parseSavedFilters(raw: unknown): ParseResult<SavedFilter[]> {
  const defaultPeriod = getDefaultMarketingImpactPeriod();
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<SavedFiltersDoc> | null;
    if (typeof parsed?.version !== 'number' || parsed.version !== SAVED_FILTERS_DOC_VERSION) {
      return { data: [], readOnly: true };
    }
    if (!Array.isArray(parsed.filters)) return { data: [], readOnly: true };
    const filters: SavedFilter[] = [];
    for (const entry of parsed.filters as unknown[]) {
      const f = entry as Partial<SavedFilter> | null;
      if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') continue;
      filters.push({
        id: f.id,
        name: f.name,
        predicate: normalizePredicate(f.predicate),
        scope: normalizeViewScope(f.scope, defaultPeriod),
        createdAt: typeof f.createdAt === 'string' ? f.createdAt : new Date().toISOString(),
      });
    }
    return { data: filters };
  } catch {
    return { data: [], readOnly: true };
  }
}
