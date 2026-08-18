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
  MENTION_SENTIMENT_OPTIONS,
  SOCIAL_LISTENING_QUERY_PARAMS,
} from '../constants/social-listening.constants';
import type {
  FilterPredicate,
  SavedViewScope,
  ScopeState,
  SocialListeningQueryParams,
  SocialListeningScopeSignals,
  SocialListeningSignals,
} from '../interfaces/social-listening.interface';
import { resolvePeriodRange } from './marketing-impact.utils';
import { normalizeKeywords } from './social-listening.utils';

export function predicateFromSignals(s: SocialListeningSignals): FilterPredicate {
  // Shallow-clone array fields so saved-view snapshots, defaults, and live signals never
  // share the same array instance (prevents cross-mutation if any caller mutates in place).
  return {
    sentiment: s.selectedSentiment(),
    relevance: s.selectedRelevance(),
    language: s.selectedLanguage(),
    hasTitle: s.selectedHasTitle(),
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
  s.selectedKeywords.set(normalizeKeywords([...p.keywords]));
  s.selectedTags.set([...p.tags]);
  s.selectedAuthors.set([...p.authors]);
  s.searchInput.set(p.search);
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
    period: str(s.period, defaultPeriod),
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
    sentiment: str(p.sentiment, DEFAULT_MENTION_PREDICATE.sentiment),
    relevance: str(p.relevance, DEFAULT_MENTION_PREDICATE.relevance),
    language: str(p.language, DEFAULT_MENTION_PREDICATE.language),
    hasTitle: str(p.hasTitle, DEFAULT_MENTION_PREDICATE.hasTitle),
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
    sortedEqual(a.keywords, b.keywords) &&
    sortedEqual(a.tags, b.tags) &&
    sortedEqual(a.authors, b.authors) &&
    a.search === b.search
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

/** Explicit `null` at DEFAULT so `queryParamsHandling: 'merge'` strips the key from the URL; 3rd-party / utm_* keys survive. */
export function encodePredicateToQueryParams(p: FilterPredicate, scope: ScopeState, defaultPeriod: string): SocialListeningQueryParams {
  const q = SOCIAL_LISTENING_QUERY_PARAMS;
  return {
    [q.tab]: scope.activeTab !== DEFAULT_MENTION_SCOPE_STATE.activeTab ? scope.activeTab : null,
    [q.period]: scope.period !== defaultPeriod ? scope.period : null,
    [q.sourceProject]: scope.sourceProjectId !== DEFAULT_MENTION_SCOPE_STATE.sourceProjectId ? scope.sourceProjectId : null,
    [q.platform]: scope.platform !== DEFAULT_MENTION_SCOPE_STATE.platform ? scope.platform : null,
    [q.sentiment]: p.sentiment !== DEFAULT_MENTION_PREDICATE.sentiment ? p.sentiment : null,
    [q.relevance]: p.relevance !== DEFAULT_MENTION_PREDICATE.relevance ? p.relevance : null,
    [q.language]: p.language !== DEFAULT_MENTION_PREDICATE.language ? p.language : null,
    [q.hasTitle]: p.hasTitle !== DEFAULT_MENTION_PREDICATE.hasTitle ? p.hasTitle : null,
    [q.keywords]: p.keywords.length > 0 ? [...p.keywords] : null,
    [q.tags]: p.tags.length > 0 ? [...p.tags] : null,
    [q.authors]: p.authors.length > 0 ? [...p.authors] : null,
    [q.search]: p.search !== DEFAULT_MENTION_PREDICATE.search ? p.search : null,
  };
}

// Derived from the shared option lists (not re-listed) so future option additions propagate.
const SENTIMENT_VALUES = new Set(MENTION_SENTIMENT_OPTIONS.map((o) => o.value));
const RELEVANCE_VALUES = new Set(MENTION_RELEVANCE_OPTIONS.map((o) => o.value));
const HAS_TITLE_VALUES = new Set(MENTION_HAS_TITLE_OPTIONS.map((o) => o.value));

function coerceLiteral(value: string | undefined, allowed: Set<string>, fallback: string): string {
  return value && allowed.has(value) ? value : fallback;
}

/** An unresolvable `?period=` falls back to the default instead of reaching the server as a 400. */
function coercePeriod(value: string | undefined, defaultPeriod: string): string {
  return value && resolvePeriodRange(value) ? value : defaultPeriod;
}

/** Falls back to DEFAULT for any missing key; coerces literals to valid union values. */
export function decodePredicateFromQueryParams(params: SocialListeningQueryParams, defaultPeriod: string): { predicate: FilterPredicate; scope: ScopeState } {
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
    keywords,
    tags,
    authors,
    search: asScalar(params[q.search]) ?? DEFAULT_MENTION_PREDICATE.search,
  };

  const scope: ScopeState = {
    activeTab,
    period: coercePeriod(asScalar(params[q.period]), defaultPeriod),
    sourceProjectId: asScalar(params[q.sourceProject]) || DEFAULT_MENTION_SCOPE_STATE.sourceProjectId,
    platform: asScalar(params[q.platform]) || DEFAULT_MENTION_SCOPE_STATE.platform,
  };

  return { predicate, scope };
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
