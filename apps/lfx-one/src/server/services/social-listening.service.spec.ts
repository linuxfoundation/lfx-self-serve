// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-lens-meetings.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this
// app's vitest config, so every runtime (non-type-only) import needs a stub.
vi.mock('@lfx-one/shared/constants', () => ({
  ANALYTICS_TOP_PROJECTS_LIMIT: 5,
  DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE',
  MENTION_FEED_BODY_MAX_CHARS: 1000,
  MENTION_FILTER_MAX_VALUES: 200,
  MENTION_IDS_MAX_VALUES: 500,
  MENTION_TOP_TAGS_LIMIT: 10,
  VALKEY_CACHE: { SOCIAL_LISTENING_TTL_SECONDS: 1800 },
}));

// The params helper pulls in the whole shared validation surface; only its bounds matter here.
vi.mock('../helpers/social-listening-params.helper', () => ({
  MAX_FEED_LIMIT: 100,
  MAX_FEED_OFFSET: 100_000,
  MAX_ANALYTICS_LIMIT: 100,
}));

vi.mock('../helpers/validation.helper', () => ({
  escapeSqlLikePattern: (term: string) => term.replace(/[!%_]/g, (ch: string) => `!${ch}`),
}));

const { execute, withSocialListeningCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  withSocialListeningCache: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withSocialListeningCache }));

const { SocialListeningService } = await import('./social-listening.service');

const req = {} as Request;

const SCOPE = { foundationSlug: 'cncf', startDate: '2026-01-01', endDate: '2026-02-01' };

/** Every assertion here is about the SQL text and bind array handed to Snowflake. */
function lastCall(): { sql: string; binds: unknown[] } {
  const [sql, binds] = execute.mock.calls.at(-1) as [string, unknown[]];
  return { sql, binds };
}

/** Collapses the template literal's indentation so clause assertions can be written inline. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function service(): InstanceType<typeof SocialListeningService> {
  return new SocialListeningService();
}

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue({ rows: [] });
  // Run the read-through factory directly so the query under test actually executes.
  withSocialListeningCache.mockImplementation(
    async (_slug: string, _resource: string, _discriminator: readonly unknown[], _ttl: number, fetcher: () => Promise<unknown>) => fetcher()
  );
});

describe('getMentionsFeed — LIMIT/OFFSET are literals, not binds', () => {
  it('interpolates the clamped limit and offset and keeps them out of the bind array', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, limit: 20, offset: 40 });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('LIMIT 20 OFFSET 40');
    expect(sql).not.toContain('LIMIT ?');
    expect(sql).not.toContain('OFFSET ?');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it.each([
    { label: 'above the window size', limit: 5000, offset: 0, expected: 'LIMIT 100 OFFSET 0' },
    { label: 'below one row', limit: 0, offset: 0, expected: 'LIMIT 1 OFFSET 0' },
    { label: 'negative offset', limit: 20, offset: -10, expected: 'LIMIT 20 OFFSET 0' },
    { label: 'past the offset ceiling', limit: 20, offset: 500_000, expected: 'LIMIT 20 OFFSET 100000' },
    { label: 'fractional', limit: 20.9, offset: 40.9, expected: 'LIMIT 20 OFFSET 40' },
    { label: 'not a number', limit: Number.NaN, offset: Number.NaN, expected: 'LIMIT 1 OFFSET 0' },
  ])('clamps $label before interpolating', async ({ limit, offset, expected }) => {
    await service().getMentionsFeed(req, { ...SCOPE, limit, offset });

    expect(normalize(lastCall().sql)).toContain(expected);
  });

  it('orders by a total order so OFFSET paging cannot duplicate or drop a row', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, limit: 20, offset: 0 });

    expect(normalize(lastCall().sql)).toContain('ORDER BY MENTION_TS DESC, _KEY DESC');
  });

  it('projects an explicit column list that renames the identity column, drops the excluded columns, and caps BODY', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, limit: 20, offset: 0 });

    const sql = normalize(lastCall().sql);
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain('_KEY AS MENTION_ID');
    expect(sql).toContain('LEFT(BODY, 1000) AS BODY');
    expect(sql).not.toContain('BOOKMARKED');
    expect(sql).not.toContain('IS_ALL_TIME');
  });

  it('reports the newest row COMPUTED_AT as the watermark, and null for an empty page', async () => {
    execute.mockResolvedValueOnce({ rows: [{ COMPUTED_AT: '2026-02-01T04:00:00Z' }, { COMPUTED_AT: '2026-02-01T04:00:00Z' }] });
    const withRows = await service().getMentionsFeed(req, { ...SCOPE, limit: 20, offset: 0 });
    expect(withRows.computedAt).toBe('2026-02-01T04:00:00Z');

    execute.mockResolvedValueOnce({ rows: [] });
    const empty = await service().getMentionsFeed(req, { ...SCOPE, limit: 20, offset: 0 });
    expect(empty.computedAt).toBeNull();
    expect(empty.mentions).toEqual([]);
  });
});

describe('scope clause', () => {
  it('binds the foundation slug and a half-open date range in order', async () => {
    await service().getMentionsCount(req, SCOPE);

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('PROJECT_SLUG = ?');
    expect(normalized).toContain('MENTION_TS >= TO_DATE(?)');
    expect(normalized).toContain('MENTION_TS < TO_DATE(?)');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it('treats "all" as no sub-project or platform narrowing', async () => {
    await service().getMentionsCount(req, { ...SCOPE, sourceProjectId: 'all', platform: 'all' });

    const { sql, binds } = lastCall();
    expect(sql).not.toContain('SOURCE_PROJECT_ID = ?');
    expect(sql).not.toContain('LOWER(SOURCE_PLATFORM) = ?');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it('lowercases the platform bind and appends scope binds after the date range', async () => {
    await service().getMentionsCount(req, { ...SCOPE, sourceProjectId: 'proj-1', platform: 'Reddit' });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('LOWER(SOURCE_PLATFORM) = ?');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'proj-1', 'reddit']);
  });

  it('caches the count under the scope + filter binds (count is pagination-invariant)', async () => {
    await service().getMentionsCount(req, { ...SCOPE, sentiment: 'positive' });

    expect(withSocialListeningCache).toHaveBeenCalledWith(
      'cncf',
      'mentions-count',
      ['cncf', '2026-01-01', '2026-02-01', 'positive'],
      1800,
      expect.any(Function)
    );
  });
});

describe('tag filter — exact token match, not substring', () => {
  it('splits the comma-joined TAGS column instead of matching a LIKE pattern', async () => {
    await service().getMentionsCount(req, { ...SCOPE, tags: ['AI'] });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain("ARRAY_CONTAINS(?::VARIANT, SPLIT(REGEXP_REPLACE(LOWER(TRIM(TAGS)), '[[:space:]]*,[[:space:]]*', ','), ','))");
    expect(normalized).not.toContain('TAGS LIKE');
    expect(normalized).not.toContain('LOWER(TAGS) LIKE');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'ai']);
  });

  it('ANDs one clause per selected tag', async () => {
    await service().getMentionsCount(req, { ...SCOPE, tags: ['ai', 'Kubernetes'] });

    const { sql, binds } = lastCall();
    expect(normalize(sql).match(/ARRAY_CONTAINS/g)).toHaveLength(2);
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'ai', 'kubernetes']);
  });

  it('drops blank tags and caps the list at MENTION_FILTER_MAX_VALUES', async () => {
    await service().getMentionsCount(req, { ...SCOPE, tags: [' ai ', '', '   '] });
    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'ai']);

    await service().getMentionsCount(req, { ...SCOPE, tags: Array.from({ length: 250 }, (_, i) => `tag-${i}`) });
    expect(normalize(lastCall().sql).match(/ARRAY_CONTAINS/g)).toHaveLength(200);
  });
});

describe('buildFilters', () => {
  it('binds the simple equality filters lowercased and skips "all"', async () => {
    await service().getMentionsCount(req, { ...SCOPE, sentiment: 'Positive', relevance: 'High', language: 'EN' });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('LOWER(TRIM(SENTIMENT)) = ?');
    expect(normalized).toContain('LOWER(RELEVANCE_SCORE) = ?');
    expect(normalized).toContain('LOWER(LANGUAGE) = ?');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'positive', 'high', 'en']);

    await service().getMentionsCount(req, { ...SCOPE, sentiment: 'all', relevance: 'all', language: 'all' });
    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it('renders hasTitle as a literal predicate with no bind', async () => {
    await service().getMentionsCount(req, { ...SCOPE, hasTitle: 'yes' });
    expect(normalize(lastCall().sql)).toContain("TITLE IS NOT NULL AND TITLE != ''");
    expect(lastCall().binds).toHaveLength(3);

    await service().getMentionsCount(req, { ...SCOPE, hasTitle: 'no' });
    expect(normalize(lastCall().sql)).toContain("(TITLE IS NULL OR TITLE = '')");
  });

  it('builds one placeholder per keyword and author', async () => {
    await service().getMentionsCount(req, { ...SCOPE, keywords: ['Kubernetes', 'CNCF'], authors: ['@alice', '@bob'] });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('LOWER(KEYWORD) IN (?, ?)');
    // Author handles are matched verbatim — the column is not lowercased.
    expect(normalized).toContain('AUTHOR IN (?, ?)');
    // Keywords lowercase + sort for a canonical cache key; authors sort but keep their case.
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'cncf', 'kubernetes', '@alice', '@bob']);
  });

  it('canonicalizes array binds so key order and casing produce one cache entry', async () => {
    await service().getMentionsCount(req, { ...SCOPE, tags: ['Kubernetes', 'AI'], keywords: ['B', 'a'], authors: ['@bob', '@Alice'] });

    // Clause order is keywords → tags → authors; within each, values are sorted (lowercased where the predicate is case-insensitive).
    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'a', 'b', 'ai', 'kubernetes', '@Alice', '@bob']);
  });

  it('escapes the caller wildcards in the search pattern and binds it twice', async () => {
    await service().getMentionsCount(req, { ...SCOPE, search: '100%_off!' });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain("(TITLE ILIKE ? ESCAPE '!' OR BODY ILIKE ? ESCAPE '!')");
    expect(binds.slice(3)).toEqual(['%100!%!_off!!%', '%100!%!_off!!%']);
  });

  it('lowercases the search pattern — ILIKE is case-insensitive, so this only canonicalizes the cache key', async () => {
    await service().getMentionsCount(req, { ...SCOPE, search: 'Mesh' });

    expect(lastCall().binds.slice(3)).toEqual(['%mesh%', '%mesh%']);
  });

  it('treats an explicitly empty mentionIds list as "nothing selected"', async () => {
    await service().getMentionsCount(req, { ...SCOPE, mentionIds: [] });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('AND 1 = 0');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it('binds a populated mentionIds list against the identity column', async () => {
    await service().getMentionsCount(req, { ...SCOPE, mentionIds: ['k1', 'k2'] });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('_KEY IN (?, ?)');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'k1', 'k2']);
  });

  it('scopes before it filters, so scope binds always precede filter binds', async () => {
    await service().getMentionsCount(req, { ...SCOPE, platform: 'Reddit', sentiment: 'negative' });

    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'reddit', 'negative']);
  });
});

describe('option queries', () => {
  it('leaves sub-project and platform options unscoped by date so paging back cannot empty them', async () => {
    await service().getMentionsProjects(req, { foundationSlug: 'cncf' });
    expect(lastCall().binds).toEqual(['cncf']);
    expect(lastCall().sql).not.toContain('MENTION_TS');

    await service().getMentionsPlatforms(req, { foundationSlug: 'cncf' });
    expect(lastCall().binds).toEqual(['cncf']);
    expect(lastCall().sql).not.toContain('MENTION_TS');
  });

  it('interpolates the top-tags cap and still discriminates the cache entry by it', async () => {
    await service().getMentionsTags(req, SCOPE);

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('LIMIT 10');
    expect(sql).not.toContain('LIMIT ?');
    // The cap is a compile-time literal, so it must never reach the bind array...
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
    // ...but it still has to key the cache entry.
    expect(withSocialListeningCache).toHaveBeenCalledWith('cncf', 'tags', ['cncf', '2026-01-01', '2026-02-01', 10], 1800, expect.any(Function));
  });

  it('honors a caller-supplied tags limit and clamps it to the filter-value cap', async () => {
    await service().getMentionsTags(req, { ...SCOPE, limit: 200 });
    expect(normalize(lastCall().sql)).toContain('LIMIT 200');

    await service().getMentionsTags(req, { ...SCOPE, limit: 5000 });
    expect(normalize(lastCall().sql)).toContain('LIMIT 200');

    await service().getMentionsTags(req, { ...SCOPE, limit: 0 });
    expect(normalize(lastCall().sql)).toContain('LIMIT 1');
  });

  it('aliases the tags scope so the LATERAL FLATTEN join is unambiguous', async () => {
    await service().getMentionsTags(req, SCOPE);

    const normalized = normalize(lastCall().sql);
    expect(normalized).toContain('m.PROJECT_SLUG = ?');
    expect(normalized).toContain("LATERAL FLATTEN(input => SPLIT(m.TAGS, ',')) AS f");
  });

  it('folds the tag vocabulary to lowercase so a listed option maps to the case-insensitive tag predicate', async () => {
    await service().getMentionsTags(req, SCOPE);

    const normalized = normalize(lastCall().sql);
    expect(normalized).toContain('SELECT LOWER(TRIM(f.VALUE::STRING)) AS TAG');
    expect(normalized).toContain('GROUP BY LOWER(TRIM(f.VALUE::STRING))');
  });

  it('interpolates the author option cap rather than binding it', async () => {
    await service().getMentionsAuthors(req, SCOPE);

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('LIMIT 200');
    expect(sql).not.toContain('LIMIT ?');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it('guards author options against null platforms, breaks platform ties deterministically, and caches the result', async () => {
    await service().getMentionsAuthors(req, SCOPE);

    const normalized = normalize(lastCall().sql);
    expect(normalized).toContain("SOURCE_PLATFORM IS NOT NULL AND SOURCE_PLATFORM != ''");
    expect(normalized).toContain('ROW_NUMBER() OVER (PARTITION BY AUTHOR ORDER BY COUNT(*) DESC, SOURCE_PLATFORM)');
    expect(withSocialListeningCache).toHaveBeenCalledWith('cncf', 'mentions-authors', ['cncf', '2026-01-01', '2026-02-01'], 1800, expect.any(Function));
  });

  it('keys the language and keyword caches on the scope binds', async () => {
    await service().getMentionsLanguages(req, SCOPE);
    expect(withSocialListeningCache).toHaveBeenCalledWith('cncf', 'languages', ['cncf', '2026-01-01', '2026-02-01'], 1800, expect.any(Function));

    await service().getMentionsKeywords(req, { ...SCOPE, platform: 'reddit' });
    expect(withSocialListeningCache).toHaveBeenLastCalledWith('cncf', 'keywords', ['cncf', '2026-01-01', '2026-02-01', 'reddit'], 1800, expect.any(Function));
  });
});

describe('analytics', () => {
  it('shifts a month-aligned window back by whole months', async () => {
    // February is 28 days; the comparison window must be all of January, not 28 days of it.
    await service().getAnalyticsOverview(req, { foundationSlug: 'cncf', startDate: '2026-02-01', endDate: '2026-03-01' });

    const { binds } = lastCall();
    // Base CTE spans previous-start → current-end, then the two window ranges.
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-03-01', '2026-02-01', '2026-03-01', '2026-01-01', '2026-02-01']);
  });

  it('shifts a multi-month window back by its own month span', async () => {
    await service().getAnalyticsOverview(req, { foundationSlug: 'cncf', startDate: '2026-01-01', endDate: '2026-04-01' });

    expect(lastCall().binds).toEqual(['cncf', '2025-10-01', '2026-04-01', '2026-01-01', '2026-04-01', '2025-10-01', '2026-01-01']);
  });

  it('falls back to a day shift when the window is not month-aligned', async () => {
    await service().getAnalyticsOverview(req, { foundationSlug: 'cncf', startDate: '2026-01-10', endDate: '2026-01-20' });

    expect(lastCall().binds).toEqual(['cncf', '2025-12-31', '2026-01-20', '2026-01-10', '2026-01-20', '2025-12-31', '2026-01-10']);
  });

  it('serves a zeroed overview when the query returns no rows', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    const overview = await service().getAnalyticsOverview(req, SCOPE);

    expect(overview).toEqual({
      TOTAL_MENTIONS: 0,
      TOTAL_MENTIONS_CHANGE_PCT: null,
      CHILD_PROJECTS_COUNT: 0,
      POSITIVE_SENTIMENT_PERCENT: 0,
      NEGATIVE_SENTIMENT_PERCENT: 0,
      POSITIVE_SENTIMENT_CHANGE_PCT: null,
      NEGATIVE_SENTIMENT_CHANGE_PCT: null,
    });
  });

  it('never caches the zeroed overview — the fetcher rejects, so the read-through write is skipped', async () => {
    execute.mockResolvedValue({ rows: [] });

    await service().getAnalyticsOverview(req, SCOPE);

    const fetcher = withSocialListeningCache.mock.calls.at(-1)?.at(-1) as () => Promise<unknown>;
    await expect(fetcher()).rejects.toThrow();
  });

  it.each([
    { label: 'a single month', startDate: '2026-01-01', endDate: '2026-02-01', unit: 'DAY', format: 'MON DD' },
    { label: 'exactly the day-grain ceiling', startDate: '2026-01-01', endDate: '2026-03-04', unit: 'DAY', format: 'MON DD' },
    { label: 'one day past the ceiling', startDate: '2026-01-01', endDate: '2026-03-05', unit: 'MONTH', format: 'MON YYYY' },
    { label: 'a full year', startDate: '2026-01-01', endDate: '2027-01-01', unit: 'MONTH', format: 'MON YYYY' },
  ])('buckets $label by $unit', async ({ startDate, endDate, unit, format }) => {
    await service().getAnalyticsOverTime(req, { foundationSlug: 'cncf', startDate, endDate });

    const normalized = normalize(lastCall().sql);
    expect(normalized).toContain(`DATE_TRUNC('${unit}', MENTION_TS), '${format}'`);
    // The grain is part of the cache key — a day and a month rollup of the same scope differ.
    expect(withSocialListeningCache).toHaveBeenLastCalledWith('cncf', `analytics-over-time-${unit}`, ['cncf', startDate, endDate], 1800, expect.any(Function));
  });

  it('defaults the top-projects cap, clamps a caller override, and keys the cache on it', async () => {
    await service().getAnalyticsTopProjects(req, SCOPE);
    expect(normalize(lastCall().sql)).toContain('LIMIT 5');
    expect(withSocialListeningCache).toHaveBeenLastCalledWith(
      'cncf',
      'analytics-top-projects',
      ['cncf', '2026-01-01', '2026-02-01', 5],
      1800,
      expect.any(Function)
    );

    await service().getAnalyticsTopProjects(req, { ...SCOPE, limit: 9999 });
    expect(normalize(lastCall().sql)).toContain('LIMIT 100');
    expect(lastCall().sql).not.toContain('LIMIT ?');
    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
    expect(withSocialListeningCache).toHaveBeenLastCalledWith(
      'cncf',
      'analytics-top-projects',
      ['cncf', '2026-01-01', '2026-02-01', 100],
      1800,
      expect.any(Function)
    );
  });

  it('applies the feed predicate to every analytics panel, with scope binds preceding filter binds', async () => {
    const filters = { sentiment: 'Negative', keywords: ['Kubernetes'], search: 'mesh' };

    await service().getAnalyticsOverview(req, { ...SCOPE, platform: 'Reddit', ...filters });
    // Overview's base CTE spans the previous window, so scope dates are [prevStart, endDate]; the
    // filter binds follow, then the two window ranges.
    expect(lastCall().binds).toEqual([
      'cncf',
      '2025-12-01',
      '2026-02-01',
      'reddit',
      'negative',
      'kubernetes',
      '%mesh%',
      '%mesh%',
      '2026-01-01',
      '2026-02-01',
      '2025-12-01',
      '2026-01-01',
    ]);
    expect(normalize(lastCall().sql)).toContain('WITH base AS');

    for (const run of [
      () => service().getAnalyticsOverTime(req, { ...SCOPE, ...filters }),
      () => service().getAnalyticsPlatformDistribution(req, { ...SCOPE, ...filters }),
      () => service().getAnalyticsSentimentDistribution(req, { ...SCOPE, ...filters }),
      () => service().getAnalyticsTopProjects(req, { ...SCOPE, ...filters }),
    ]) {
      await run();
      expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'negative', 'kubernetes', '%mesh%', '%mesh%']);
    }
  });

  it('buckets off-list sentiment values as neutral so the distribution shares sum to 100%', async () => {
    await service().getAnalyticsSentimentDistribution(req, SCOPE);

    expect(normalize(lastCall().sql)).toContain("CASE WHEN LOWER(TRIM(SENTIMENT)) IN ('positive', 'negative') THEN LOWER(TRIM(SENTIMENT)) ELSE 'neutral' END");
  });

  it('filters the tags endpoint too, aliasing the columns so the LATERAL FLATTEN join stays unambiguous', async () => {
    await service().getMentionsTags(req, { ...SCOPE, tags: ['ai'], authors: ['@alice'] });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('SPLIT(REGEXP_REPLACE(LOWER(TRIM(m.TAGS))');
    expect(normalized).toContain('m.AUTHOR IN (?)');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'ai', '@alice']);
    // The filter binds discriminate the cache entry alongside the row cap.
    expect(withSocialListeningCache).toHaveBeenLastCalledWith(
      'cncf',
      'tags',
      ['cncf', '2026-01-01', '2026-02-01', 'ai', '@alice', 10],
      1800,
      expect.any(Function)
    );
  });
});
