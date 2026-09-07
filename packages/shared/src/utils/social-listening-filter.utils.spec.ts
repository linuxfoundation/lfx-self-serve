// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MENTION_PREDICATE,
  DEFAULT_MENTION_SCOPE_STATE,
  MENTION_FILTER_UI_MAX_VALUES,
  SAVED_FILTERS_DOC_VERSION,
  SOCIAL_LISTENING_QUERY_PARAMS,
} from '../constants/social-listening.constants';
import type { FilterPredicate, SavedFilter, SavedFiltersDoc, ScopeState, SocialListeningQueryParams } from '../interfaces/social-listening.interface';
import {
  countActiveFilters,
  decodePredicateFromQueryParams,
  encodePredicateToQueryParams,
  isDefaultViewScope,
  isEmptyPredicate,
  normalizeMentionSearch,
  normalizePredicate,
  normalizeViewScope,
  parseSavedFilters,
  predicatesEqual,
  queryParamsEqual,
  sameSavedViewLabelPredicate,
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
    const params = encodePredicateToQueryParams(predicate(), scope(), null, DEFAULT_PERIOD);

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

    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(original, originalScope, null, DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate).toEqual(original);
    expect(decoded.scope).toEqual(originalScope);
  });

  it('round-trips the elided defaults back to the defaults', () => {
    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(predicate(), scope(), null, DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate).toEqual(predicate());
    expect(decoded.scope).toEqual(scope());
  });

  it('round-trips the bookmark filter and elides it at the default', () => {
    const original = predicate({ bookmarkFilter: 'bookmarked' });

    const encoded = encodePredicateToQueryParams(original, scope(), null, DEFAULT_PERIOD);
    expect(encoded[q.bookmarks]).toBe('bookmarked');
    expect(decodePredicateFromQueryParams(encoded, DEFAULT_PERIOD).predicate).toEqual(original);

    expect(encodePredicateToQueryParams(predicate(), scope(), null, DEFAULT_PERIOD)[q.bookmarks]).toBeNull();
  });

  it('round-trips the read filter and elides it at the default', () => {
    const original = predicate({ readFilter: 'unread' });

    const encoded = encodePredicateToQueryParams(original, scope(), null, DEFAULT_PERIOD);
    expect(encoded[q.read]).toBe('unread');
    expect(decodePredicateFromQueryParams(encoded, DEFAULT_PERIOD).predicate).toEqual(original);

    expect(encodePredicateToQueryParams(predicate(), scope(), null, DEFAULT_PERIOD)[q.read]).toBeNull();
  });

  it('resolves the period from the runtime default rather than the constant placeholder', () => {
    const encoded = encodePredicateToQueryParams(predicate(), scope({ period: DEFAULT_PERIOD }), null, DEFAULT_PERIOD);
    expect(encoded[q.period]).toBeNull();

    const decoded = decodePredicateFromQueryParams({}, DEFAULT_PERIOD);
    expect(decoded.scope.period).toBe(DEFAULT_PERIOD);
    expect(decoded.scope.period).not.toBe('');
  });

  it('encodes multi-value keys as arrays (the router emits repeated params)', () => {
    const encoded = encodePredicateToQueryParams(predicate({ keywords: ['a', 'b'], tags: ['x'], authors: ['@u1', '@u2'] }), scope(), null, DEFAULT_PERIOD);

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

    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(original, scope(), null, DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate.tags).toEqual(['a,b']);
    expect(decoded.predicate.authors).toEqual(['Last, First']);
  });

  it('preserves non-delimiter characters verbatim', () => {
    const original = predicate({ search: 'a=b&c #hash /slash %pct', authors: ['@user name'] });

    const decoded = decodePredicateFromQueryParams(encodePredicateToQueryParams(original, scope(), null, DEFAULT_PERIOD), DEFAULT_PERIOD);

    expect(decoded.predicate.search).toBe('a=b&c #hash /slash %pct');
    expect(decoded.predicate.authors).toEqual(['@user name']);
  });

  it('normalizes keywords on ingress, not on encode', () => {
    // Encode keeps the array verbatim — the predicate reaching it has already been through
    // predicateFromSignals/normalizePredicate. Decode is where untrusted input is canonicalized.
    expect(encodePredicateToQueryParams(predicate({ keywords: ['Kubernetes', 'cncf'] }), scope(), null, DEFAULT_PERIOD)[q.keywords]).toEqual([
      'Kubernetes',
      'cncf',
    ]);

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

  it('coerces an unknown bookmarks value back to the default', () => {
    expect(decodePredicateFromQueryParams({ [q.bookmarks]: 'everything' }, DEFAULT_PERIOD).predicate.bookmarkFilter).toBe('all');
    expect(normalizePredicate({ bookmarkFilter: 'everything' }).bookmarkFilter).toBe('all');
  });

  it('coerces an unknown read value back to the default', () => {
    expect(decodePredicateFromQueryParams({ [q.read]: 'everything' }, DEFAULT_PERIOD).predicate.readFilter).toBe('all');
    expect(normalizePredicate({ readFilter: 'everything' }).readFilter).toBe('all');
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

  it('passes the platform through verbatim — the values are live upstream SOURCE_PLATFORM strings, not config keys', () => {
    // `X` (Twitter's upstream value) must round-trip; coercing off-list values to the default silently widens the feed.
    expect(decodePredicateFromQueryParams({ [q.platform]: 'X' }, DEFAULT_PERIOD).scope.platform).toBe('X');
    expect(decodePredicateFromQueryParams({ [q.platform]: 'reddit' }, DEFAULT_PERIOD).scope.platform).toBe('reddit');
    expect(decodePredicateFromQueryParams({}, DEFAULT_PERIOD).scope.platform).toBe(DEFAULT_MENTION_SCOPE_STATE.platform);
  });

  it('falls back on a month-shaped but out-of-range period', () => {
    expect(decodePredicateFromQueryParams({ [q.period]: '2025-13' }, DEFAULT_PERIOD).scope.period).toBe(DEFAULT_PERIOD);
  });

  it('round-trips array filters at the UI selection cap', () => {
    const values = Array.from({ length: MENTION_FILTER_UI_MAX_VALUES }, (_, i) => `tag-${i}`);
    const encoded = encodePredicateToQueryParams(predicate({ tags: values }), scope(), null, DEFAULT_PERIOD);

    expect(decodePredicateFromQueryParams(encoded, DEFAULT_PERIOD).predicate.tags).toEqual(values);
  });
});

describe('queryParamsEqual', () => {
  it('ignores keys the codec does not own', () => {
    const encoded = encodePredicateToQueryParams(predicate({ sentiment: 'positive' }), scope(), null, DEFAULT_PERIOD);
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
    expect(predicatesEqual(predicate(), predicate({ readFilter: 'unread' }))).toBe(false);
  });

  it('reports emptiness and counts one per active dimension', () => {
    expect(isEmptyPredicate(predicate())).toBe(true);
    expect(countActiveFilters(predicate())).toBe(0);

    const active = predicate({ sentiment: 'positive', keywords: ['a', 'b'], tags: ['x'], search: 'mesh' });
    expect(isEmptyPredicate(active)).toBe(false);
    // Two keywords are one active dimension, not two.
    expect(countActiveFilters(active)).toBe(4);
    expect(countActiveFilters(predicate({ readFilter: 'unread' }))).toBe(1);
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

describe('saved-view codec (?view=)', () => {
  it('round-trips a view id and strips the key at null', () => {
    const encoded = encodePredicateToQueryParams(predicate(), scope(), 'view-1', DEFAULT_PERIOD);
    expect(encoded[q.view]).toBe('view-1');
    expect(decodePredicateFromQueryParams(encoded, DEFAULT_PERIOD).viewId).toBe('view-1');

    expect(encodePredicateToQueryParams(predicate(), scope(), null, DEFAULT_PERIOD)[q.view]).toBeNull();
    expect(decodePredicateFromQueryParams({}, DEFAULT_PERIOD).viewId).toBeNull();
  });

  it('collapses a repeated ?view= to its first value and treats empty as absent', () => {
    expect(decodePredicateFromQueryParams({ [q.view]: ['a', 'b'] }, DEFAULT_PERIOD).viewId).toBe('a');
    expect(decodePredicateFromQueryParams({ [q.view]: '' }, DEFAULT_PERIOD).viewId).toBeNull();
  });

  it('queryParamsEqual covers the view key (missing/null ≡ absent)', () => {
    expect(queryParamsEqual({ [q.view]: 'a' }, {})).toBe(false);
    expect(queryParamsEqual({ [q.view]: 'a' }, { [q.view]: 'a' })).toBe(true);
    expect(queryParamsEqual({ [q.view]: null }, {})).toBe(true);
  });
});

describe('sameSavedViewLabelPredicate', () => {
  it('ignores search-only drift but detects any other difference', () => {
    const base = predicate({ sentiment: 'positive', keywords: ['a'], tags: ['x'], search: 'mesh' });

    expect(sameSavedViewLabelPredicate(base, { ...base, search: 'refined' })).toBe(true);
    expect(sameSavedViewLabelPredicate(base, { ...base, search: '' })).toBe(true);
    expect(sameSavedViewLabelPredicate(base, { ...base, sentiment: 'negative' })).toBe(false);
    expect(sameSavedViewLabelPredicate(base, { ...base, keywords: ['b'] })).toBe(false);
    expect(sameSavedViewLabelPredicate(base, { ...base, readFilter: 'unread' })).toBe(false);
    expect(sameSavedViewLabelPredicate(base, { ...base })).toBe(true);
  });
});

describe('parseSavedFilters', () => {
  const validScope = { period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' };

  function savedFilter(overrides: Partial<SavedFilter> = {}): SavedFilter {
    return { id: 'v1', name: 'Crisis', predicate: predicate(), scope: { ...validScope }, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
  }

  it('parses a stringified doc and re-normalizes each row', () => {
    const doc: SavedFiltersDoc = {
      version: SAVED_FILTERS_DOC_VERSION,
      filters: [savedFilter({ predicate: { ...predicate(), sentiment: 'negative', keywords: ['Kubernetes', 'KUBERNETES'] } })],
    };

    const result = parseSavedFilters(JSON.stringify(doc));

    expect(result.readOnly).toBeUndefined();
    expect(result.data).toEqual([savedFilter({ predicate: predicate({ sentiment: 'negative', keywords: ['kubernetes'] }) })]);
  });

  it('accepts an already-parsed doc object', () => {
    const doc: SavedFiltersDoc = { version: SAVED_FILTERS_DOC_VERSION, filters: [savedFilter()] };

    expect(parseSavedFilters(doc)).toEqual({ data: [savedFilter()] });
  });

  it('returns read-only for an unknown or missing version so a newer doc is never clobbered', () => {
    expect(parseSavedFilters({ version: SAVED_FILTERS_DOC_VERSION + 1, filters: [] })).toEqual({ data: [], readOnly: true });
    expect(parseSavedFilters({ filters: [] })).toEqual({ data: [], readOnly: true });
    expect(parseSavedFilters(JSON.stringify({ version: 'one', filters: [] }))).toEqual({ data: [], readOnly: true });
  });

  it('returns read-only when filters is not an array', () => {
    expect(parseSavedFilters({ version: SAVED_FILTERS_DOC_VERSION, filters: 'nope' })).toEqual({ data: [], readOnly: true });
  });

  it('salvages valid rows — drops entries without string id/name and backfills createdAt', () => {
    const doc = {
      version: SAVED_FILTERS_DOC_VERSION,
      filters: [
        savedFilter(),
        { name: 'no id' },
        { id: 42, name: 'bad id' },
        null,
        savedFilter({ id: 'v2', name: 'No date', createdAt: undefined as unknown as string }),
      ],
    };

    const result = parseSavedFilters(doc);

    expect(result.readOnly).toBeUndefined();
    expect(result.data.map((f) => f.id)).toEqual(['v1', 'v2']);
    expect(result.data[1]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('normalizes a partial scope against the runtime default period', () => {
    const result = parseSavedFilters({ version: SAVED_FILTERS_DOC_VERSION, filters: [savedFilter({ scope: { platform: 'X' } as SavedFilter['scope'] })] });

    expect(result.data[0]?.scope.platform).toBe('X');
    expect(result.data[0]?.scope.period).not.toBe('');
    expect(result.data[0]?.scope.sourceProjectId).toBe('all');
  });

  it('returns read-only on a JSON throw', () => {
    expect(parseSavedFilters('{not json')).toEqual({ data: [], readOnly: true });
  });
});
