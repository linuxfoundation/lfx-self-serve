// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors org-lens-meetings.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this
// app's vitest config, so every runtime (non-type-only) import needs a stub. Values mirror
// `social-listening.constants.ts` / `valkey-cache.constants.ts`.
vi.mock('@lfx-one/shared/constants', () => ({
  SOCIAL_LISTENING_MAX_FILTER_VALUES: 200,
  SOCIAL_LISTENING_MAX_MENTION_IDS: 500,
  SOCIAL_LISTENING_TOP_TAGS_LIMIT: 20,
  VALKEY_CACHE: { SOCIAL_LISTENING_TTL_SECONDS: 1800 },
  // Unrelated to Social Listening, but `validation.helper` — the real module, since
  // `escapeSqlLikePattern` is under test through the service — derives these at module scope.
  AKRITES_STEWARD_ROLE_OPTIONS: [],
  AKRITES_ESCALATION_PATHS: [],
  AKRITES_INACTIVE_REASON_OPTIONS: [],
}));

// Also imported by `validation.helper` at module scope; nothing on this path calls into it.
vi.mock('@lfx-one/shared/utils', () => ({ resolvePeriodRange: vi.fn() }));

const { execute, withSocialListeningCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  withSocialListeningCache: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withSocialListeningCache }));

const { SocialListeningService } = await import('./social-listening.service');

const req = {} as Request;

/** A month-aligned, half-open window — `endDate` is exclusive, as `resolvePeriodRange()` returns it. */
const SCOPE = { foundationSlug: 'cncf', startDate: '2026-03-01', endDate: '2026-04-01' };

const FEED_PARAMS = { ...SCOPE, limit: 100, offset: 0 };

/** The SQL + binds the service handed to Snowflake, which is the whole contract under test. */
function lastQuery(): { sql: string; binds: (string | number)[] } {
  const [sql, binds] = execute.mock.calls.at(-1) as [string, (string | number)[]];
  return { sql, binds };
}

/** Only the filter fragment's own binds — the shared scope always contributes the first three. */
function filterBinds(): (string | number)[] {
  return lastQuery().binds.slice(3);
}

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue({ rows: [] });
  // Run the read-through factory directly so the query under test is what actually executes.
  withSocialListeningCache.mockImplementation(
    async (_slug: string, _resource: string, _discriminator: unknown, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()
  );
});

describe('SocialListeningService — scope predicate', () => {
  it('scopes on the foundation slug and a half-open MENTION_TS window', async () => {
    await new SocialListeningService().getMentionsFeed(req, FEED_PARAMS);

    const { sql, binds } = lastQuery();
    expect(sql).toContain('PROJECT_SLUG = ?');
    expect(sql).toContain('MENTION_TS >= TO_DATE(?)');
    expect(sql).toContain('MENTION_TS < TO_DATE(?)');
    expect(binds).toEqual(['cncf', '2026-03-01', '2026-04-01', 100, 0]);
  });

  it('drops the BOOKMARKED column and every fixed-range flag from the feed projection', async () => {
    await new SocialListeningService().getMentionsFeed(req, FEED_PARAMS);

    const { sql } = lastQuery();
    expect(sql).toContain('BOOKMARKED');
    expect(sql).toMatch(/EXCLUDE \([^)]*BOOKMARKED[^)]*IS_YTD[^)]*\)/);
    expect(sql).toContain('RENAME _KEY AS MENTION_ID');
  });

  it.each([
    { label: 'a sub-project id', params: { sourceProjectId: 'proj-1' }, clause: 'SOURCE_PROJECT_ID = ?', bind: 'proj-1' },
    { label: 'a platform, lowercased', params: { platform: 'Twitter' }, clause: 'LOWER(SOURCE_PLATFORM) = ?', bind: 'twitter' },
  ])('adds a predicate for $label', async ({ params, clause, bind }) => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, ...params });

    expect(lastQuery().sql).toContain(clause);
    expect(filterBinds()).toEqual([bind, 100, 0]);
  });

  it.each(['all', ''])('treats a "%s" scope select as no predicate', async (value) => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, sourceProjectId: value, platform: value });

    const { sql } = lastQuery();
    expect(sql).not.toContain('SOURCE_PROJECT_ID = ?');
    expect(sql).not.toContain('LOWER(SOURCE_PLATFORM) = ?');
  });
});

describe('SocialListeningService — filter predicates', () => {
  it.each([
    { field: 'sentiment', value: 'Positive', clause: 'LOWER(SENTIMENT) = ?', bind: 'positive' },
    { field: 'relevance', value: 'High', clause: 'LOWER(RELEVANCE_SCORE) = ?', bind: 'high' },
    { field: 'language', value: 'EN', clause: 'LOWER(LANGUAGE) = ?', bind: 'en' },
  ])('binds $field lowercased', async ({ field, value, clause, bind }) => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, [field]: value });

    expect(lastQuery().sql).toContain(clause);
    expect(filterBinds()).toEqual([bind, 100, 0]);
  });

  it.each([
    { hasTitle: 'yes', clause: "TITLE IS NOT NULL AND TITLE != ''" },
    { hasTitle: 'no', clause: "(TITLE IS NULL OR TITLE = '')" },
  ])('renders has-title=$hasTitle as a literal predicate with no bind', async ({ hasTitle, clause }) => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, hasTitle });

    expect(lastQuery().sql).toContain(clause);
    expect(filterBinds()).toEqual([100, 0]);
  });

  it('binds keywords as a lowercased IN list', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, keywords: ['Kubernetes', 'Argo'] });

    expect(lastQuery().sql).toContain('LOWER(KEYWORD) IN (?, ?)');
    expect(filterBinds()).toEqual(['kubernetes', 'argo', 100, 0]);
  });

  it('ANDs one escaped substring match per selected tag', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, tags: ['Release', '100%_win'] });

    const { sql } = lastQuery();
    expect(sql.match(/LOWER\(TAGS\) LIKE \? ESCAPE '!'/g)).toHaveLength(2);
    // The user's own `%` and `_` are escaped so they match literally rather than as wildcards.
    expect(filterBinds()).toEqual(['%release%', '%100!%!_win%', 100, 0]);
  });

  it('binds authors verbatim — handles are case-sensitive upstream', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, authors: ['@LinuxFoundation'] });

    expect(lastQuery().sql).toContain('AUTHOR IN (?)');
    expect(filterBinds()).toEqual(['@LinuxFoundation', 100, 0]);
  });

  it('searches title and body with the same escaped pattern', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, search: '50%_off' });

    expect(lastQuery().sql).toContain("(TITLE ILIKE ? ESCAPE '!' OR BODY ILIKE ? ESCAPE '!')");
    expect(filterBinds()).toEqual(['%50!%!_off%', '%50!%!_off%', 100, 0]);
  });

  it('trims filter values and drops blanks', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, keywords: ['  argo  ', '', '   '] });

    expect(lastQuery().sql).toContain('LOWER(KEYWORD) IN (?)');
    expect(filterBinds()).toEqual(['argo', 100, 0]);
  });

  it('omits a filter entirely when its value list is empty', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, keywords: [], tags: [], authors: [] });

    const { sql } = lastQuery();
    expect(sql).not.toContain('LOWER(KEYWORD) IN');
    expect(sql).not.toContain('LOWER(TAGS) LIKE');
    expect(sql).not.toContain('AUTHOR IN');
  });
});

describe('SocialListeningService — mention id selection', () => {
  it('binds an explicit id selection', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, mentionIds: ['a', 'b'] });

    expect(lastQuery().sql).toContain('_KEY IN (?, ?)');
    expect(filterBinds()).toEqual(['a', 'b', 100, 0]);
  });

  it('matches nothing when the id list is present but empty — "nothing selected", not "no filter"', async () => {
    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, mentionIds: [] });

    const { sql } = lastQuery();
    expect(sql).toContain('1 = 0');
    expect(sql).not.toContain('_KEY IN');
    expect(filterBinds()).toEqual([100, 0]);
  });

  it('applies no id predicate at all when the list is absent', async () => {
    await new SocialListeningService().getMentionsFeed(req, FEED_PARAMS);

    const { sql } = lastQuery();
    expect(sql).not.toContain('1 = 0');
    expect(sql).not.toContain('_KEY IN');
  });
});

describe('SocialListeningService — filter caps', () => {
  it.each([
    { field: 'keywords', cap: 200, requested: 250, clause: 'LOWER(KEYWORD) IN' },
    { field: 'authors', cap: 200, requested: 250, clause: 'AUTHOR IN' },
    { field: 'mentionIds', cap: 500, requested: 600, clause: '_KEY IN' },
  ])('caps $field at $cap values', async ({ field, cap, requested, clause }) => {
    const values = Array.from({ length: requested }, (_, index) => `v${index}`);

    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, [field]: values });

    const { sql } = lastQuery();
    expect(sql).toContain(clause);
    expect(sql.match(/\?/g)?.length).toBeGreaterThanOrEqual(cap);
    // Scope (3) + the capped list + limit/offset (2).
    expect(lastQuery().binds).toHaveLength(3 + cap + 2);
  });

  it('caps tags at 200 individual LIKE predicates', async () => {
    const tags = Array.from({ length: 250 }, (_, index) => `t${index}`);

    await new SocialListeningService().getMentionsFeed(req, { ...FEED_PARAMS, tags });

    expect(lastQuery().sql.match(/LOWER\(TAGS\) LIKE \? ESCAPE '!'/g)).toHaveLength(200);
  });
});

describe('SocialListeningService — feed and count responses', () => {
  it('surfaces the dbt rebuild timestamp from the first row', async () => {
    execute.mockResolvedValue({ rows: [{ COMPUTED_AT: '2026-03-31T10:00:00Z' }, { COMPUTED_AT: '2026-03-31T10:00:00Z' }] });

    const response = await new SocialListeningService().getMentionsFeed(req, FEED_PARAMS);

    expect(response.mentions).toHaveLength(2);
    expect(response.computedAt).toBe('2026-03-31T10:00:00Z');
  });

  it('returns a null timestamp and an empty page when the window holds no mentions', async () => {
    execute.mockResolvedValue({ rows: undefined });

    const response = await new SocialListeningService().getMentionsFeed(req, FEED_PARAMS);

    expect(response).toEqual({ mentions: [], computedAt: null });
  });

  it.each([
    { rows: [{ TOTAL: 42 }], expected: 42 },
    // Snowflake can hand back a numeric as a string.
    { rows: [{ TOTAL: '42' }], expected: 42 },
    { rows: [], expected: 0 },
  ])('coerces the count to $expected', async ({ rows, expected }) => {
    execute.mockResolvedValue({ rows });

    await expect(new SocialListeningService().getMentionsCount(req, SCOPE)).resolves.toBe(expected);
  });

  it('counts against the same scope and filters as the feed', async () => {
    await new SocialListeningService().getMentionsCount(req, { ...SCOPE, sentiment: 'negative' });

    const { sql, binds } = lastQuery();
    expect(sql).toContain('SELECT COUNT(*) AS TOTAL');
    expect(sql).toContain('LOWER(SENTIMENT) = ?');
    expect(binds).toEqual(['cncf', '2026-03-01', '2026-04-01', 'negative']);
  });
});

describe('SocialListeningService — tag aggregation', () => {
  it('qualifies the scope with the join alias and groups by the expression, not the alias', async () => {
    await new SocialListeningService().getMentionsTags(req, SCOPE);

    const { sql, binds } = lastQuery();
    expect(sql).toContain('m.PROJECT_SLUG = ?');
    expect(sql).toContain('m.MENTION_TS >= TO_DATE(?)');
    expect(sql).toContain("LATERAL FLATTEN(input => SPLIT(m.TAGS, ','))");
    // Grouping by the `TAG` alias would silently group by a real column of that name.
    expect(sql).toContain('GROUP BY TRIM(f.VALUE::STRING)');
    expect(binds).toEqual(['cncf', '2026-03-01', '2026-04-01', 20]);
  });

  it('honors a caller-supplied row cap', async () => {
    await new SocialListeningService().getMentionsTags(req, { ...SCOPE, limit: 5 });

    expect(lastQuery().binds.at(-1)).toBe(5);
  });
});

describe('SocialListeningService — author options', () => {
  it('cascades off the active filters and caps the option list', async () => {
    await new SocialListeningService().getMentionsAuthors(req, { ...SCOPE, sentiment: 'positive' });

    const { sql, binds } = lastQuery();
    expect(sql).toContain('WHERE PLATFORM_RANK = 1');
    expect(sql).toContain('LOWER(SENTIMENT) = ?');
    expect(binds).toEqual(['cncf', '2026-03-01', '2026-04-01', 'positive', 200]);
  });
});

describe('SocialListeningService — analytics windows', () => {
  it.each([
    // Month-aligned windows shift back by whole months so February compares against all of January.
    { label: 'a single calendar month', startDate: '2026-03-01', endDate: '2026-04-01', prevStart: '2026-02-01' },
    { label: 'a trailing 3-month window', startDate: '2026-01-01', endDate: '2026-04-01', prevStart: '2025-10-01' },
    { label: 'a 7-month YTD window', startDate: '2026-01-01', endDate: '2026-08-01', prevStart: '2025-06-01' },
    // A window that isn't month-aligned falls back to an equal-length day shift.
    { label: 'a 10-day window', startDate: '2026-03-10', endDate: '2026-03-20', prevStart: '2026-02-28' },
  ])('compares $label against the window immediately before it', async ({ startDate, endDate, prevStart }) => {
    await new SocialListeningService().getAnalyticsOverview(req, { ...SCOPE, startDate, endDate });

    const { binds } = lastQuery();
    // The base CTE spans previous-start → current-end so both windows are read in one pass.
    expect(binds.slice(0, 3)).toEqual(['cncf', prevStart, endDate]);
    expect(binds.slice(-4)).toEqual([startDate, endDate, prevStart, startDate]);
  });

  it('serves a zeroed overview when the query returns no rows', async () => {
    execute.mockResolvedValue({ rows: [] });

    const overview = await new SocialListeningService().getAnalyticsOverview(req, SCOPE);

    expect(overview).toEqual({
      TOTAL_MENTIONS: 0,
      TOTAL_MENTIONS_CHANGE_PCT: null,
      CHILD_PROJECTS_COUNT: 0,
      POSITIVE_SENTIMENT_PERCENT: 0,
      NEGATIVE_SENTIMENT_PERCENT: 0,
      POSITIVE_SENTIMENT_CHANGE_PP: null,
      NEGATIVE_SENTIMENT_CHANGE_PP: null,
    });
  });

  it.each([
    { label: 'a single month', startDate: '2026-03-01', endDate: '2026-04-01', unit: 'DAY', labelFormat: 'MON DD' },
    { label: 'exactly the 62-day threshold', startDate: '2026-01-01', endDate: '2026-03-04', unit: 'DAY', labelFormat: 'MON DD' },
    { label: 'one day past the threshold', startDate: '2026-01-01', endDate: '2026-03-05', unit: 'MONTH', labelFormat: 'MON YYYY' },
    { label: 'a YTD window', startDate: '2026-01-01', endDate: '2026-08-01', unit: 'MONTH', labelFormat: 'MON YYYY' },
  ])('buckets $label by $unit', async ({ startDate, endDate, unit, labelFormat }) => {
    await new SocialListeningService().getAnalyticsOverTime(req, { ...SCOPE, startDate, endDate });

    const { sql } = lastQuery();
    expect(sql).toContain(`DATE_TRUNC('${unit}', MENTION_TS)`);
    expect(sql).toContain(`'${labelFormat}'`);
    // Grouping by the expression, not the `PERIOD_START` alias.
    expect(sql).toContain(`GROUP BY DATE_TRUNC('${unit}', MENTION_TS)`);
  });

  it('defaults the top-projects row cap and binds it last', async () => {
    await new SocialListeningService().getAnalyticsTopProjects(req, SCOPE);

    expect(lastQuery().binds).toEqual(['cncf', '2026-03-01', '2026-04-01', 10]);
  });
});

describe('SocialListeningService — caching', () => {
  it.each([
    { method: 'getMentionsProjects', resource: 'projects' },
    { method: 'getMentionsPlatforms', resource: 'platforms' },
    { method: 'getMentionsLanguages', resource: 'languages' },
    { method: 'getMentionsKeywords', resource: 'keywords' },
    { method: 'getMentionsTags', resource: 'tags' },
    { method: 'getAnalyticsOverview', resource: 'analytics-overview' },
    { method: 'getAnalyticsPlatformDistribution', resource: 'analytics-platform-distribution' },
    { method: 'getAnalyticsSentimentDistribution', resource: 'analytics-sentiment-distribution' },
    { method: 'getAnalyticsTopProjects', resource: 'analytics-top-projects' },
  ])('reads $method through the "$resource" cache namespace', async ({ method, resource }) => {
    const service = new SocialListeningService() as unknown as Record<string, (req: Request, params: unknown) => Promise<unknown>>;

    await service[method](req, SCOPE);

    expect(withSocialListeningCache).toHaveBeenCalledWith('cncf', resource, expect.any(Array), 1800, expect.any(Function));
  });

  it('discriminates the over-time entry by grain so a day and a month rollup cannot collide', async () => {
    const service = new SocialListeningService();

    await service.getAnalyticsOverTime(req, SCOPE);
    await service.getAnalyticsOverTime(req, { ...SCOPE, startDate: '2026-01-01', endDate: '2026-08-01' });

    expect(withSocialListeningCache.mock.calls.map((call) => call[1])).toEqual(['analytics-over-time-DAY', 'analytics-over-time-MONTH']);
  });

  it('discriminates cache entries by the query binds', async () => {
    const service = new SocialListeningService();

    await service.getMentionsLanguages(req, SCOPE);
    await service.getMentionsLanguages(req, { ...SCOPE, platform: 'reddit' });

    const [first, second] = withSocialListeningCache.mock.calls.map((call) => call[2]);
    expect(first).not.toEqual(second);
  });

  it('never caches the feed or the count — their filter cardinality makes the hit rate near zero', async () => {
    const service = new SocialListeningService();

    await service.getMentionsFeed(req, FEED_PARAMS);
    await service.getMentionsCount(req, SCOPE);
    await service.getMentionsAuthors(req, SCOPE);

    expect(withSocialListeningCache).not.toHaveBeenCalled();
  });
});
