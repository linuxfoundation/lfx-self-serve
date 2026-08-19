// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DEFAULT_MENTION_PREDICATE, DEFAULT_MENTION_SCOPE_STATE, SOCIAL_LISTENING_QUERY_PARAMS } from '../constants/social-listening.constants';
import type { FilterPredicate, ScopeState, SocialListeningQueryParams } from '../interfaces/social-listening.interface';
import {
  countActiveFilters,
  decodePredicateFromQueryParams,
  encodePredicateToQueryParams,
  isDefaultViewScope,
  isEmptyPredicate,
  normalizeMentionSearch,
  normalizePredicate,
  normalizeViewScope,
  predicatesEqual,
  queryParamsEqual,
  scopesEqual,
  viewScopesEqual,
} from './social-listening-filter.utils';

const q = SOCIAL_LISTENING_QUERY_PARAMS;

/** The runtime-resolved period; never the constant's placeholder `''`. */
const DEFAULT_PERIOD = '2026-08';

function predicate(overrides: Partial<FilterPredicate> = {}): FilterPredicate {
  return { ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [], ...overrides };
}

function scope(overrides: Partial<ScopeState> = {}): ScopeState {
  return { ...DEFAULT_MENTION_SCOPE_STATE, period: DEFAULT_PERIOD, ...overrides };
}

describe('encode / decode round-trip', () => {
  it('elides every default to null so merge-handling strips them from the URL', () => {
    const params = encodePredicateToQueryParams(predicate(), scope(), DEFAULT_PERIOD);

    expect(Object.values(params).every((value) => value === null)).toBe(true);
  });

  it('round-trips a fully populated predicate and scope', () => {
    const original = predicate({
      sentiment: 'positive',
      relevance: 'high',
      language: 'en',
      hasTitle: 'yes',
      keywords: ['kubernetes', 'cncf'],
      tags: ['ai', 'ai_agents'],
      authors: ['@alice', '@bob'],
      search: 'service mesh',
    });
    const originalScope = scope({ activeTab: 'analytics', period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' });

    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(original, originalScope, DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate).toEqual(original);
    expect(decoded.scope).toEqual(originalScope);
  });

  it('round-trips the elided defaults back to the defaults', () => {
    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(predicate(), scope(), DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate).toEqual(predicate());
    expect(decoded.scope).toEqual(scope());
  });

  it('resolves the period from the runtime default rather than the constant placeholder', () => {
    const encoded = encodePredicateToQueryParams(predicate(), scope({ period: DEFAULT_PERIOD }), DEFAULT_PERIOD);
    expect(encoded[q.period]).toBeNull();

    const decoded = decodePredicateFromQueryParams({}, DEFAULT_PERIOD);
    expect(decoded.scope.period).toBe(DEFAULT_PERIOD);
    expect(decoded.scope.period).not.toBe('');
  });

  it('encodes multi-value keys as arrays (the router emits repeated params)', () => {
    const encoded = encodePredicateToQueryParams(predicate({ keywords: ['a', 'b'], tags: ['x'], authors: ['@u1', '@u2'] }), scope(), DEFAULT_PERIOD);

    expect(encoded[q.keywords]).toEqual(['a', 'b']);
    expect(encoded[q.tags]).toEqual(['x']);
    expect(encoded[q.authors]).toEqual(['@u1', '@u2']);
  });

  it('drops empty entries in a multi-value param', () => {
    const decoded = decodePredicateFromQueryParams({ [q.tags]: ['', 'ai', 'kubernetes'], [q.keywords]: [''], [q.authors]: ['@alice', ''] }, DEFAULT_PERIOD);

    expect(decoded.predicate.tags).toEqual(['ai', 'kubernetes']);
    expect(decoded.predicate.keywords).toEqual([]);
    expect(decoded.predicate.authors).toEqual(['@alice']);
  });

  it('round-trips a value containing a comma — repeated params carry it verbatim', () => {
    // Regression: the old comma-joined codec split `a,b` back into two bogus selections.
    const original = predicate({ tags: ['a,b'], authors: ['Last, First'] });

    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(original, scope(), DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate.tags).toEqual(['a,b']);
    expect(decoded.predicate.authors).toEqual(['Last, First']);
  });

  it('preserves non-delimiter characters verbatim', () => {
    const original = predicate({ search: 'a=b&c #hash /slash %pct', authors: ['@user name'] });

    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(original, scope(), DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate.search).toBe('a=b&c #hash /slash %pct');
    expect(decoded.predicate.authors).toEqual(['@user name']);
  });

  it('normalizes keywords on ingress, not on encode', () => {
    // Encode keeps the array verbatim — the predicate reaching it has already been through
    // predicateFromSignals/normalizePredicate. Decode is where untrusted input is canonicalized.
    expect(encodePredicateToQueryParams(predicate({ keywords: ['Kubernetes', 'cncf'] }), scope(), DEFAULT_PERIOD)[q.keywords]).toEqual(['Kubernetes', 'cncf']);

    expect(decodePredicateFromQueryParams({ [q.keywords]: ['Kubernetes', 'KUBERNETES', 'cncf'] }, DEFAULT_PERIOD).predicate.keywords).toEqual([
      'kubernetes',
      'cncf',
    ]);
    expect(normalizePredicate({ keywords: ['Kubernetes', 'KUBERNETES'] }).keywords).toEqual(['kubernetes']);
  });
});

describe('decode coercion', () => {
  it.each([
    { key: q.sentiment, field: 'sentiment' as const, valid: 'negative', invalid: 'furious' },
    { key: q.relevance, field: 'relevance' as const, valid: 'high', invalid: 'medium' },
    { key: q.hasTitle, field: 'hasTitle' as const, valid: 'no', invalid: 'maybe' },
  ])('coerces an off-list $field literal back to the default', ({ key, field, valid, invalid }) => {
    expect(decodePredicateFromQueryParams({ [key]: valid }, DEFAULT_PERIOD).predicate[field]).toBe(valid);
    expect(decodePredicateFromQueryParams({ [key]: invalid }, DEFAULT_PERIOD).predicate[field]).toBe(DEFAULT_MENTION_PREDICATE[field]);
  });

  it('only recognizes the analytics tab, defaulting anything else to feed', () => {
    expect(decodePredicateFromQueryParams({ [q.tab]: 'analytics' }, DEFAULT_PERIOD).scope.activeTab).toBe('analytics');
    expect(decodePredicateFromQueryParams({ [q.tab]: 'nonsense' }, DEFAULT_PERIOD).scope.activeTab).toBe('feed');
    expect(decodePredicateFromQueryParams({}, DEFAULT_PERIOD).scope.activeTab).toBe('feed');
  });

  it('takes the first value of a repeated scalar param but keeps every element of a multi-value param', () => {
    const decoded = decodePredicateFromQueryParams({ [q.sentiment]: ['positive', 'negative'], [q.tags]: ['ai,ml', 'ignored'] }, DEFAULT_PERIOD);

    expect(decoded.predicate.sentiment).toBe('positive');
    expect(decoded.predicate.tags).toEqual(['ai,ml', 'ignored']);
  });

  it('falls back to the defaults for empty-string values', () => {
    const decoded = decodePredicateFromQueryParams({ [q.period]: '', [q.language]: '', [q.platform]: '', [q.sourceProject]: '' }, DEFAULT_PERIOD);

    expect(decoded.scope).toEqual(scope());
    expect(decoded.predicate.language).toBe(DEFAULT_MENTION_PREDICATE.language);
  });
});

describe('queryParamsEqual', () => {
  it('ignores keys the codec does not own', () => {
    const encoded = encodePredicateToQueryParams(predicate({ sentiment: 'positive' }), scope(), DEFAULT_PERIOD);
    // Live router params carry `project` (projectQueryParamGuard) and any utm_* the visitor arrived with.
    const live: SocialListeningQueryParams = { ...encoded, project: 'cncf', utm_source: 'newsletter' };

    expect(queryParamsEqual(encoded, live)).toBe(true);
  });

  it('treats missing, null, and empty-string as the same absence', () => {
    expect(queryParamsEqual({}, { [q.sentiment]: null })).toBe(true);
    expect(queryParamsEqual({ [q.sentiment]: '' }, {})).toBe(true);
    expect(queryParamsEqual({ [q.tags]: null }, { [q.tags]: '' })).toBe(true);
  });

  it('still detects a real difference on a codec-owned key', () => {
    expect(queryParamsEqual({ [q.sentiment]: 'positive' }, { [q.sentiment]: 'negative' })).toBe(false);
    expect(queryParamsEqual({ [q.search]: 'mesh' }, {})).toBe(false);
  });

  it('compares multi-value params as sets, regardless of order or collapse to a scalar', () => {
    expect(queryParamsEqual({ [q.sentiment]: ['positive'] }, { [q.sentiment]: 'positive' })).toBe(true);
    expect(queryParamsEqual({ [q.sentiment]: ['positive'] }, { [q.sentiment]: 'negative' })).toBe(false);
    expect(queryParamsEqual({ [q.tags]: ['a', 'b'] }, { [q.tags]: ['b', 'a'] })).toBe(true);
    expect(queryParamsEqual({ [q.tags]: ['a', 'b'] }, { [q.tags]: 'a' })).toBe(false);
    expect(queryParamsEqual({ [q.tags]: ['a,b'] }, { [q.tags]: ['a', 'b'] })).toBe(false);
  });
});

describe('predicate helpers', () => {
  it('treats array order as insignificant but membership as significant', () => {
    expect(predicatesEqual(predicate({ tags: ['a', 'b'] }), predicate({ tags: ['b', 'a'] }))).toBe(true);
    expect(predicatesEqual(predicate({ tags: ['a', 'b'] }), predicate({ tags: ['a'] }))).toBe(false);
    expect(predicatesEqual(predicate({ authors: ['@a'] }), predicate({ authors: ['@b'] }))).toBe(false);
  });

  it('detects a scalar difference', () => {
    expect(predicatesEqual(predicate(), predicate())).toBe(true);
    expect(predicatesEqual(predicate(), predicate({ search: 'x' }))).toBe(false);
  });

  it('reports emptiness and counts one per active dimension', () => {
    expect(isEmptyPredicate(predicate())).toBe(true);
    expect(countActiveFilters(predicate())).toBe(0);

    const active = predicate({ sentiment: 'positive', keywords: ['a', 'b'], tags: ['x'], search: 'mesh' });
    expect(isEmptyPredicate(active)).toBe(false);
    // Two keywords are one active dimension, not two.
    expect(countActiveFilters(active)).toBe(4);
  });

  it('coerces a corrupted stored predicate rather than throwing', () => {
    expect(normalizePredicate(null)).toEqual(predicate());
    expect(normalizePredicate('not an object')).toEqual(predicate());
    expect(normalizePredicate([])).toEqual(predicate());
    expect(normalizePredicate({ sentiment: 42, tags: ['ai', 7, null], keywords: 'nope' })).toEqual(predicate({ tags: ['ai'] }));
  });

  it('normalizeMentionSearch trims and enforces the min-chars gate', () => {
    expect(normalizeMentionSearch('  mesh  ')).toBe('mesh');
    expect(normalizeMentionSearch('ab')).toBe('');
    expect(normalizeMentionSearch('   ')).toBe('');
    expect(normalizeMentionSearch('')).toBe('');
  });
});

describe('view scope helpers', () => {
  it('uses the runtime default period, never the static placeholder', () => {
    expect(normalizeViewScope(null, DEFAULT_PERIOD).period).toBe(DEFAULT_PERIOD);
    expect(normalizeViewScope({}, DEFAULT_PERIOD).period).toBe(DEFAULT_PERIOD);
    expect(normalizeViewScope({ period: 42 }, DEFAULT_PERIOD).period).toBe(DEFAULT_PERIOD);
  });

  it('agrees with isDefaultViewScope on a coerced default', () => {
    // Regression: a coerced scope that fell back to '' would fail its own default check.
    expect(isDefaultViewScope(normalizeViewScope(undefined, DEFAULT_PERIOD), DEFAULT_PERIOD)).toBe(true);
    expect(isDefaultViewScope(normalizeViewScope({ platform: 'reddit' }, DEFAULT_PERIOD), DEFAULT_PERIOD)).toBe(false);
  });

  it('keeps valid string fields and compares field-wise', () => {
    const normalized = normalizeViewScope({ period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' }, DEFAULT_PERIOD);

    expect(normalized).toEqual({ period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' });
    expect(viewScopesEqual(normalized, { ...normalized })).toBe(true);
    expect(viewScopesEqual(normalized, { ...normalized, platform: 'youtube' })).toBe(false);
  });

  it('compares scope state including the active tab', () => {
    expect(scopesEqual(scope(), scope())).toBe(true);
    expect(scopesEqual(scope(), scope({ activeTab: 'analytics' }))).toBe(false);
    expect(scopesEqual(scope(), scope({ period: '2026-03' }))).toBe(false);
  });
});
