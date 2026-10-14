// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The shared barrels transitively reach Angular's partially-compiled @angular/common; under vitest
// that needs the JIT compiler, so load it before the module under test (mirrors the middleware spec).
import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceValidationError } from '../errors';
import {
  encodeMentionFeedPageToken,
  parseFoundationSlug,
  parseSocialListeningAnalyticsFilters,
  parseSocialListeningAnalyticsScope,
  parseSocialListeningAuthorFilters,
  parseSocialListeningFeedBody,
  parseSocialListeningCountBody,
  parseSocialListeningLimit,
  parseSocialListeningScope,
} from './social-listening-params.helper';

const reqWith = (query: Record<string, unknown>): Request => ({ query }) as unknown as Request;
const feedBody = (fields: Record<string, unknown>) => parseSocialListeningFeedBody({ foundationSlug: 'synthetic-foundation', ...fields }, 'op');

const catchValidation = (fn: () => unknown): ServiceValidationError | undefined => {
  try {
    fn();
  } catch (error) {
    return error as ServiceValidationError;
  }
  return undefined;
};

const expectFieldError = (fn: () => unknown, field: string): void => {
  const error = catchValidation(fn);
  expect(error).toBeInstanceOf(ServiceValidationError);
  expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  expect(error?.validationErrors[0]).toMatchObject({ field });
};

describe('parseFoundationSlug', () => {
  it('400s when foundationSlug is missing', () => {
    expectFieldError(() => parseFoundationSlug(reqWith({}), 'op'), 'foundationSlug');
  });

  it('400s when the slug has characters outside [a-z0-9-]', () => {
    expectFieldError(() => parseFoundationSlug(reqWith({ foundationSlug: 'LF_Project' }), 'op'), 'foundationSlug');
  });

  it('accepts a mixed-case slug and normalizes it to lowercase (middleware authorizes case-insensitively; the client sends project.slug verbatim)', () => {
    expect(parseFoundationSlug(reqWith({ foundationSlug: 'LF-Project' }), 'op')).toBe('lf-project');
  });

  it('400s past the 64-character cache-key ceiling', () => {
    expectFieldError(() => parseFoundationSlug(reqWith({ foundationSlug: 'a'.repeat(65) }), 'op'), 'foundationSlug');
  });

  it('returns a valid slug unchanged', () => {
    expect(parseFoundationSlug(reqWith({ foundationSlug: 'linux-foundation' }), 'op')).toBe('linux-foundation');
  });
});

describe('parseSocialListeningScope', () => {
  describe('period window', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-08-18T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('defaults to year-to-date ending at tomorrow (UTC) — the exclusive bound that includes today', () => {
      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx' }), 'op');

      expect(scope.startDate).toBe('2025-01-01');
      expect(scope.endDate).toBe('2025-08-19');
    });

    it('resolves an explicit period=ytd to the same through-today window as the default', () => {
      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: 'ytd' }), 'op');

      expect(scope.startDate).toBe('2025-01-01');
      expect(scope.endDate).toBe('2025-08-19');
    });

    it('stays non-empty in January — the month-bounded ytd preset would collapse to [Jan 1, Jan 1)', () => {
      vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: 'ytd' }), 'op');

      expect(scope.startDate).toBe('2025-01-01');
      expect(scope.endDate).toBe('2025-01-16');
    });

    it('passes an explicit month through the resolved range untouched', () => {
      const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: '2025-07' }), 'op');

      expect(scope.startDate).toBe('2025-07-01');
      expect(scope.endDate).toBe('2025-08-01');
    });

    it('400s an unresolvable period value', () => {
      expectFieldError(() => parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', period: 'bogus' }), 'op'), 'period');
    });
  });

  it.each(['all', 'ALL', 'All'])('treats platform=%s as no predicate', (platform) => {
    const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', platform }), 'op');

    expect(scope.platform).toBeUndefined();
  });

  it('treats sourceProjectId=ALL as no predicate', () => {
    const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', sourceProjectId: 'ALL' }), 'op');

    expect(scope.sourceProjectId).toBeUndefined();
  });

  it('passes a real platform value through verbatim', () => {
    const scope = parseSocialListeningScope(reqWith({ foundationSlug: 'lfx', platform: 'bluesky' }), 'op');

    expect(scope.platform).toBe('bluesky');
  });
});

describe('parseSocialListeningAnalyticsScope', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { query: {}, expected: 'ytd' },
    { query: { period: 'ytd' }, expected: 'ytd' },
    { query: { period: 'last-3' }, expected: 'last-3' },
    { query: { period: 'last-6' }, expected: 'last-6' },
    { query: { period: '2026-08' }, expected: '2026-08' },
    { query: { month: '2026-08' }, expected: '2026-08' },
    { query: { period: 'last-3', month: 'bogus' }, expected: 'last-3' },
  ])('resolves $query to governed period key $expected', ({ query, expected }) => {
    const scope = parseSocialListeningAnalyticsScope(reqWith({ foundationSlug: 'cncf', ...query }), 'op');

    expect(scope.periodKey).toBe(expected);
    expect(scope).not.toHaveProperty('startDate');
    expect(scope).not.toHaveProperty('endDate');
  });

  it.each(['bogus', 'last-12', '2026-00', '2026-13', '2026-11'])('400s invalid or future period=%s', (period) => {
    expectFieldError(() => parseSocialListeningAnalyticsScope(reqWith({ foundationSlug: 'cncf', period }), 'op'), 'period');
  });

  it.each(['bogus', '2026-13', '2026-11'])('400s invalid or future legacy month=%s', (month) => {
    expectFieldError(() => parseSocialListeningAnalyticsScope(reqWith({ foundationSlug: 'cncf', month }), 'op'), 'month');
  });

  it('normalizes foundation and platform casing while preserving the trimmed project identifier', () => {
    const scope = parseSocialListeningAnalyticsScope(reqWith({ foundationSlug: 'LF-Project', platform: ' Twitter ', sourceProjectId: ' Project-ABC ' }), 'op');

    expect(scope).toEqual({ foundationSlug: 'lf-project', periodKey: 'ytd', platform: 'twitter', sourceProjectId: 'Project-ABC' });
  });

  it.each(['all', 'ALL', ' All ', '   ', ''])('treats scope sentinel or blank %s as unscoped', (value) => {
    const scope = parseSocialListeningAnalyticsScope(reqWith({ foundationSlug: 'cncf', sourceProjectId: value, platform: value }), 'op');

    expect(scope.sourceProjectId).toBeUndefined();
    expect(scope.platform).toBeUndefined();
  });

  it.each(['sourceProjectId', 'platform'])('accepts the 200-character %s boundary and rejects 201 characters', (name) => {
    const scope = parseSocialListeningAnalyticsScope(reqWith({ foundationSlug: 'cncf', [name]: 'x'.repeat(200) }), 'op');

    expect(scope[name as 'sourceProjectId' | 'platform']).toHaveLength(200);
    expectFieldError(() => parseSocialListeningAnalyticsScope(reqWith({ foundationSlug: 'cncf', [name]: 'x'.repeat(201) }), 'op'), name);
  });

  it.each([undefined, 'bad_slug', 'a'.repeat(65)])('retains the foundation validation boundary for %s', (foundationSlug) => {
    expectFieldError(() => parseSocialListeningAnalyticsScope(reqWith({ foundationSlug }), 'op'), 'foundationSlug');
  });

  it('does not inspect stale or malformed content filters or feed view state', () => {
    const scope = parseSocialListeningAnalyticsScope(
      reqWith({
        foundationSlug: 'cncf',
        sentiment: 'bogus',
        relevance: 'bogus',
        hasTitle: 'bogus',
        search: 'x'.repeat(501),
        language: 'x'.repeat(201),
        authors: Array.from({ length: 201 }, () => 'alice'),
        keywords: ['x'.repeat(201)],
        tags: { malformed: true },
        mentionIds: Array.from({ length: 501 }, () => 'm1'),
        unreadOnly: 'true',
        readIds: { malformed: true },
        unreadIds: ['x'.repeat(201)],
        readBeforeTs: 'not-a-timestamp',
        allTime: 'true',
      }),
      'op'
    );

    expect(scope).toEqual({ foundationSlug: 'cncf', periodKey: 'ytd', sourceProjectId: undefined, platform: undefined });
  });
});

describe('parseSocialListeningLimit', () => {
  it('leaves an absent cap to the service default', () => {
    expect(parseSocialListeningLimit(reqWith({}), 'op')).toBeUndefined();
  });

  it.each([
    ['0', 1],
    ['5', 5],
    ['100', 100],
    ['101', 100],
  ])('bounds top-project limit=%s to %s', (limit, expected) => {
    expect(parseSocialListeningLimit(reqWith({ limit }), 'op')).toBe(expected);
  });

  it.each(['bogus', '1.5', 'Infinity'])('400s non-integer limit=%s', (limit) => {
    expectFieldError(() => parseSocialListeningLimit(reqWith({ limit }), 'op'), 'limit');
  });
});

describe('parseSocialListeningFilters', () => {
  it.each(['sentiment', 'relevance', 'hasTitle'])('400s an out-of-whitelist %s value', (name) => {
    expectFieldError(() => feedBody({ [name]: 'bogus' }), name);
  });

  it('normalizes enum value "all" to undefined (no predicate)', () => {
    expect(feedBody({ sentiment: 'all' }).sentiment).toBeUndefined();
  });

  it('still 400s enum value "ALL" — the whitelist itself stays case-sensitive', () => {
    expectFieldError(() => feedBody({ sentiment: 'ALL' }), 'sentiment');
  });

  it.each(['keywords', 'tags', 'authors'])('400s over 200 %s values', (name) => {
    const values = Array.from({ length: 201 }, (_, i) => `value-${i}`);

    expectFieldError(() => feedBody({ [name]: values }), name);
  });

  it('400s over 500 mentionIds values', () => {
    const mentionIds = Array.from({ length: 501 }, (_, i) => `mention-${i}`);

    expectFieldError(() => feedBody({ mentionIds }), 'mentionIds');
  });

  it('400s a single value past the 200-character cap', () => {
    expectFieldError(() => feedBody({ keywords: ['a'.repeat(201)] }), 'keywords');
  });

  it('400s a search term past 500 characters', () => {
    expectFieldError(() => feedBody({ search: 'a'.repeat(501) }), 'search');
  });

  it.each([['mentionIds'], ['keywords']])('normalizes empty %s arrays to no predicate', (name) => {
    const filters = feedBody({ [name]: ['', '  '] }) as unknown as Record<string, unknown>;

    expect(filters[name]).toBeUndefined();
  });

  it('keeps a repeated-key list as parsed values', () => {
    expect(feedBody({ tags: [' ai ', 'linux'] }).tags).toEqual(['ai', 'linux']);
  });
});

describe('parseSocialListeningAnalyticsFilters', () => {
  it('omits mentionIds while keeping every other feed filter', () => {
    const filters = parseSocialListeningAnalyticsFilters(reqWith({ mentionIds: ['k1'], authors: ['alice'], sentiment: 'negative' }), 'op');

    expect(filters).toEqual({ sentiment: 'negative', authors: ['alice'] });
    expect(filters).not.toHaveProperty('mentionIds');
  });

  it('ignores an over-cap mentionIds list rather than 400ing — the boundary never reads it', () => {
    const mentionIds = Array.from({ length: 501 }, (_, i) => `mention-${i}`);

    expect(parseSocialListeningAnalyticsFilters(reqWith({ mentionIds }), 'op')).toEqual({});
  });
});

describe('unread read-state params (feed + count only)', () => {
  it('parses the unread flag, both read-state id arrays, and the cutoff', () => {
    const filters = feedBody({ unreadOnly: true, readIds: ['k1', 'k2'], unreadIds: ['k9'], readBeforeTs: '2026-01-15 10:00:00' });

    expect(filters.unreadOnly).toBe(true);
    expect(filters.readIds).toEqual(['k1', 'k2']);
    expect(filters.unreadIds).toEqual(['k9']);
    expect(filters.readBeforeTs).toBe('2026-01-15 10:00:00');
  });

  it('treats absent and false unreadOnly as unset', () => {
    expect(feedBody({}).unreadOnly).toBeUndefined();
    expect(feedBody({ unreadOnly: false }).unreadOnly).toBeUndefined();
  });

  it('accepts both cutoff shapes the client persists — ISO 8601 and space-separated Snowflake', () => {
    for (const readBeforeTs of ['2026-01-15T10:00:00Z', '2026-01-15T10:00:00.123Z', '2026-01-15 10:00:00', '2026-01-15 10:00:00.123']) {
      expect(feedBody({ unreadOnly: true, readBeforeTs }).readBeforeTs).toBe(readBeforeTs);
    }
  });

  // The Feb-30 cases are regex-shaped but calendar-impossible — `Date.parse` normalizes them into March
  // instead of rejecting, so only the round-trip compare keeps them from binding a shifted instant.
  it.each([
    'not-a-timestamp',
    '2026-13-40T99:99:99Z',
    '2026-02-30T00:00:00Z',
    '2026-02-30 10:00:00',
    '2026-01-15 24:00:00',
    '2026-01-15',
    '01/15/2026 10:00 AM',
  ])('400s a malformed readBeforeTs (%s) instead of 500ing in Snowflake', (readBeforeTs) => {
    expectFieldError(() => feedBody({ unreadOnly: true, readBeforeTs }), 'readBeforeTs');
  });

  it.each(['readIds', 'unreadIds'])('400s over 500 %s values', (name) => {
    const values = Array.from({ length: 501 }, (_, i) => `mention-${i}`);

    expectFieldError(() => feedBody({ [name]: values }), name);
  });

  it('omits the unread params from the analytics and author-option filter subsets', () => {
    const query = { unreadOnly: 'true', readIds: ['k1'], unreadIds: ['k2'], readBeforeTs: '2026-01-15 10:00:00', sentiment: 'negative' };
    const analytics = parseSocialListeningAnalyticsFilters(reqWith(query), 'op');
    const author = parseSocialListeningAuthorFilters(reqWith(query), 'op');

    for (const parsed of [analytics, author]) {
      expect(parsed).not.toHaveProperty('unreadOnly');
      expect(parsed).not.toHaveProperty('readIds');
      expect(parsed).not.toHaveProperty('unreadIds');
      expect(parsed).not.toHaveProperty('readBeforeTs');
      expect(parsed.sentiment).toBe('negative');
    }
  });

  it('ignores an over-cap read-state list in analytics rather than 400ing — the boundary never reads it', () => {
    const readIds = Array.from({ length: 501 }, (_, i) => `mention-${i}`);

    expect(parseSocialListeningAnalyticsFilters(reqWith({ readIds }), 'op')).toEqual({});
  });
});

describe('parseSocialListeningPagination', () => {
  it('defaults to a full server window on the first page', () => {
    expect(feedBody({})).toMatchObject({ pageSize: 100, cursor: undefined, allTime: false });
  });

  it.each(['abc', '1.5', 1.5])('400s a non-integer page_size=%s', (pageSize) => {
    expectFieldError(() => feedBody({ page_size: pageSize }), 'page_size');
  });

  it('clamps page_size=0 up to the 1 minimum', () => {
    expect(feedBody({ page_size: 0 }).pageSize).toBe(1);
  });

  it('clamps a page_size past the server window size down to it', () => {
    expect(feedBody({ page_size: 5000 }).pageSize).toBe(100);
  });

  it('round-trips a cursor through encode + parse', () => {
    const cursor = { ts: '2026-01-15 10:00:00', key: 'mention-42' };
    const pageToken = encodeMentionFeedPageToken(cursor);

    expect(feedBody({ page_token: pageToken }).cursor).toEqual(cursor);
  });

  it('round-trips a null-ts cursor — the bookmark/allTime NULL group pages by key alone', () => {
    const cursor = { ts: null, key: 'mention-7' };

    expect(feedBody({ page_token: encodeMentionFeedPageToken(cursor) }).cursor).toEqual(cursor);
  });

  it.each([null, '2026-01-15 10:00:00.123'])('preserves an opaque 200-character cursor key with timestamp %s and rejects 201 characters', (ts) => {
    const cursor = { ts, key: ' Key,+/=雪\u0000'.padEnd(199, 'x') + ' ' };
    expect(feedBody({ page_token: encodeMentionFeedPageToken(cursor) }).cursor).toEqual(cursor);
    expectFieldError(() => feedBody({ page_token: encodeMentionFeedPageToken({ ...cursor, key: cursor.key + 'x' }) }), 'page_token');
  });

  it('accepts a 4096-character token and rejects a decodable token one character over the limit', () => {
    const cursor = { ts: null, key: 'synthetic-key' };
    const json = JSON.stringify(cursor);
    const token = Buffer.from(json + ' '.repeat(3072 - Buffer.byteLength(json)), 'utf8').toString('base64url');

    expect(token).toHaveLength(4096);
    expect(feedBody({ page_token: token }).cursor).toEqual(cursor);
    expectFieldError(() => feedBody({ page_token: token + ' ' }), 'page_token');
  });

  it.each([
    { label: 'not JSON', page_token: Buffer.from('not json at all', 'utf8').toString('base64url') },
    { label: 'JSON without a key', encoded: { ts: '2026-01-15T10:00:00Z' } },
    { label: 'empty key', encoded: { ts: '2026-01-15T10:00:00Z', key: '' } },
    { label: 'non-string ts', encoded: { ts: 42, key: 'k1' } },
    { label: 'unparseable ts', encoded: { ts: 'not-a-timestamp', key: 'k1' } },
    // Date.parse accepts this, but TO_TIMESTAMP_NTZ would 500 — the shape check rejects it first.
    { label: 'exotic-shape ts', encoded: { ts: 'March 5, 2026', key: 'k1' } },
    // Right shape, but Feb 30 rolls into March under Date.parse — the round-trip compare catches it.
    { label: 'calendar-impossible ts', encoded: { ts: '2026-02-30T10:00:00Z', key: 'k1' } },
    { label: 'missing ts', encoded: { key: 'k1' } },
  ])('400s a malformed page_token ($label)', ({ page_token: rawToken, encoded }) => {
    const token = rawToken ?? Buffer.from(JSON.stringify(encoded), 'utf8').toString('base64url');

    expectFieldError(() => feedBody({ page_token: token }), 'page_token');
  });

  it.each(['page_size', 'page_token'])('400s a repeated %s key instead of treating it as absent', (name) => {
    expectFieldError(() => feedBody({ [name]: ['a', 'b'] }), name);
  });

  it('ignores a legacy offset param outright — the migrated endpoint no longer pages by position', () => {
    expect(feedBody({ offset: '40' })).toMatchObject({ pageSize: 100, cursor: undefined });
  });
});

describe('JSON feed/count contract', () => {
  it.each([null, undefined, [], 'body', 42])('rejects a non-object body %s', (body) => {
    for (const parse of [parseSocialListeningFeedBody, parseSocialListeningCountBody]) {
      expectFieldError(() => parse(body, 'op'), 'body');
    }
  });
  it.each(['foundationSlug', 'period', 'sourceProjectId', 'platform', 'sentiment', 'relevance', 'hasTitle', 'language', 'search', 'readBeforeTs'])(
    'rejects incorrectly typed %s',
    (name) => {
      expectFieldError(() => feedBody({ [name]: 42 }), name);
    }
  );
  it.each(['keywords', 'tags', 'authors', 'mentionIds', 'readIds', 'unreadIds'])('rejects malformed %s arrays', (name) => {
    for (const value of ['id', [42], null]) expectFieldError(() => feedBody({ [name]: value }), name);
  });
  it.each(['allTime', 'unreadOnly'])('rejects string boolean %s', (name) => {
    expectFieldError(() => feedBody({ [name]: 'true' }), name);
  });
  it('preserves saturated opaque overrides in feed and count', () => {
    const readIds = Array.from({ length: 500 }, (_, i) => `Read-${i}`.padEnd(200, 'x'));
    const unreadIds = Array.from({ length: 500 }, (_, i) => `Unread-${i}`.padEnd(200, 'x'));
    for (const parse of [parseSocialListeningFeedBody, parseSocialListeningCountBody]) {
      expect(parse({ foundationSlug: 'Synthetic-Foundation', readIds, unreadIds }, 'op')).toMatchObject({
        foundationSlug: 'synthetic-foundation',
        readIds,
        unreadIds,
      });
    }
    expectFieldError(() => feedBody({ readIds: ['x'.repeat(201)] }), 'readIds');
    expectFieldError(() => feedBody({ unreadIds: ['x'.repeat(201)] }), 'unreadIds');
  });
  it('uses through-today YTD for missing, empty and explicit period and supports all-time lookup', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    try {
      for (const period of [undefined, '', 'ytd']) expect(feedBody({ period })).toMatchObject({ startDate: '2026-01-01', endDate: '2026-01-16' });
      expect(feedBody({ allTime: true })).toMatchObject({ allTime: true, pageSize: 100 });
    } finally {
      vi.useRealTimers();
    }
  });
});
