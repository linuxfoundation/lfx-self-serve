// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { SocialListeningAnalyticsParams } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real constants (plain-Node safe; see packages/shared/src/constants/index.spec.ts) with this
// suite's caps pinned, so validation.helper loads for real.
vi.mock('@lfx-one/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ANALYTICS_TOP_PROJECTS_LIMIT: 5,
  DEFAULT_LFX_ONE_PLATINUM_SCHEMA: 'ANALYTICS.PLATINUM_LFX_ONE',
  MENTION_FEED_BODY_MAX_CHARS: 1000,
  MENTION_FILTER_MAX_VALUES: 200,
  MENTION_IDS_MAX_VALUES: 500,
  MENTION_READ_IDS_MAX_VALUES: 500,
  MENTION_TOP_TAGS_LIMIT: 10,
  VALKEY_CACHE: { SOCIAL_LISTENING_TTL_SECONDS: 1800, SOCIAL_LISTENING_ANALYTICS_TTL_SECONDS: 300 },
}));

// The params helper pulls in the whole shared validation surface; only its bounds and the token codec matter here.
vi.mock('../helpers/social-listening-params.helper', () => ({
  MAX_FEED_LIMIT: 100,
  MAX_ANALYTICS_LIMIT: 100,
  encodeMentionFeedPageToken: (cursor: { ts: string | null; key: string }) => Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'),
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real clampInteger and escapeSqlLikePattern run here.
vi.mock('@lfx-one/shared/utils', () => ({}));

const { execute, withSocialListeningCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  withSocialListeningCache: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./valkey.service', () => ({ withSocialListeningCache }));

const { SocialListeningService } = await import('./social-listening.service');
const { logger } = await import('./logger.service');

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

/** Decodes a page_token the service emitted, for asserting the cursor it points at. */
function decodeToken(token: string): { ts: string | null; key: string } {
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
}

/** Minimal feed row: only the columns the paging logic reads. */
function feedRow(key: string, ts: string | null): Record<string, unknown> {
  return { MENTION_ID: key, MENTION_TS: ts, COMPUTED_AT: '2026-02-01T04:00:00Z' };
}

describe('getMentionsFeed — keyset paging', () => {
  it('fetches one row past the page as the hasMore signal and keeps LIMIT a literal', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20 });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('LIMIT 21');
    expect(sql).not.toContain('LIMIT ?');
    expect(sql).not.toContain('OFFSET');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it('adds no keyset predicate on the first page', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20 });

    expect(lastCall().sql).not.toContain('TO_TIMESTAMP_NTZ');
  });

  it.each([
    { label: 'above the window size', pageSize: 5000, expected: 'LIMIT 101' },
    { label: 'below one row', pageSize: 0, expected: 'LIMIT 2' },
    { label: 'fractional', pageSize: 20.9, expected: 'LIMIT 21' },
    { label: 'not a number', pageSize: Number.NaN, expected: 'LIMIT 2' },
  ])('clamps pageSize $label before interpolating', async ({ pageSize, expected }) => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize });

    expect(normalize(lastCall().sql)).toContain(expected);
  });

  it('pages strictly after a dated cursor — NULL-ts rows sorted before it, so they stay excluded', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20, cursor: { ts: '2026-01-15 10:00:00', key: 'k9' } });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('AND (MENTION_TS < TO_TIMESTAMP_NTZ(?) OR (MENTION_TS = TO_TIMESTAMP_NTZ(?) AND _KEY < ?))');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', '2026-01-15 10:00:00', '2026-01-15 10:00:00', 'k9']);
  });

  it('pages a NULL-ts cursor into the rest of the NULL group AND every dated row — dated rows all sort after the NULL group', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, mentionIds: ['k1'], pageSize: 20, cursor: { ts: null, key: 'k5' } });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('AND ((MENTION_TS IS NULL AND _KEY < ?) OR MENTION_TS IS NOT NULL)');
    expect(binds).toEqual(['cncf', 'k1', 'k5']);
  });

  it('appends keyset binds after scope and filter binds', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20, sentiment: 'negative', cursor: { ts: '2026-01-15 10:00:00', key: 'k9' } });

    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'negative', '2026-01-15 10:00:00', '2026-01-15 10:00:00', 'k9']);
  });

  it('orders by a total order so the keyset cursor cannot duplicate or drop a row', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20 });

    expect(normalize(lastCall().sql)).toContain('ORDER BY MENTION_TS DESC NULLS FIRST, _KEY DESC');
  });

  it('trims the extra row and emits a page_token off the last KEPT row', async () => {
    execute.mockResolvedValueOnce({ rows: [feedRow('k9', '2026-01-15 10:00:00'), feedRow('k8', '2026-01-14 10:00:00'), feedRow('k7', '2026-01-13 10:00:00')] });

    const page = await service().getMentionsFeed(req, { ...SCOPE, pageSize: 2 });

    expect(page.mentions).toHaveLength(2);
    expect(page.mentions.map((m) => m.MENTION_ID)).toEqual(['k9', 'k8']);
    expect(decodeToken(page.page_token as string)).toEqual({ ts: '2026-01-14 10:00:00', key: 'k8' });
  });

  it('emits a null-ts token when the last kept row has a NULL MENTION_TS', async () => {
    execute.mockResolvedValueOnce({ rows: [feedRow('k9', null), feedRow('k8', null), feedRow('k7', '2026-01-13 10:00:00')] });

    const page = await service().getMentionsFeed(req, { ...SCOPE, mentionIds: ['k7', 'k8', 'k9'], pageSize: 2 });

    expect(decodeToken(page.page_token as string)).toEqual({ ts: null, key: 'k8' });
  });

  it('emits no page_token when the page is not full — the extra row never materialized', async () => {
    execute.mockResolvedValueOnce({ rows: [feedRow('k9', '2026-01-15 10:00:00'), feedRow('k8', '2026-01-14 10:00:00')] });

    const page = await service().getMentionsFeed(req, { ...SCOPE, pageSize: 2 });

    expect(page.page_token).toBeUndefined();
  });

  it('projects an explicit column list that renames the identity column, drops the excluded columns, and caps BODY', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20 });

    const sql = normalize(lastCall().sql);
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain('_KEY AS MENTION_ID');
    expect(sql).toContain('LEFT(BODY, 1000) AS BODY');
    expect(sql).not.toContain('BOOKMARKED');
    expect(sql).not.toContain('IS_ALL_TIME');
  });

  it('reports the newest row COMPUTED_AT as the watermark, and null for an empty page', async () => {
    execute.mockResolvedValueOnce({ rows: [{ COMPUTED_AT: '2026-02-01T04:00:00Z' }, { COMPUTED_AT: '2026-02-01T04:00:00Z' }] });
    const withRows = await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20 });
    expect(withRows.computedAt).toBe('2026-02-01T04:00:00Z');

    execute.mockResolvedValueOnce({ rows: [] });
    const empty = await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20 });
    expect(empty.computedAt).toBeNull();
    expect(empty.mentions).toEqual([]);
    expect(empty.page_token).toBeUndefined();
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

  it('caches the count under the scope + filter discriminator (count is pagination-invariant)', async () => {
    await service().getMentionsCount(req, { ...SCOPE, sentiment: 'positive' });

    expect(withSocialListeningCache).toHaveBeenCalledWith(
      'cncf',
      'mentions-count',
      ['cncf', '2026-01-01', '2026-02-01', 'positive', 'sentiment', 'positive'],
      1800,
      expect.any(Function)
    );
  });

  it('marks the discriminator per dimension so identical values under different filters cannot share an entry', async () => {
    // `keywords=['alice']`, `tags=['alice']`, and `authors=['alice']` all bind the same value but run different SQL.
    const lastDiscriminator = (): unknown => withSocialListeningCache.mock.calls.at(-1)?.[2];

    await service().getMentionsCount(req, { ...SCOPE, keywords: ['alice'] });
    const byKeywords = lastDiscriminator();

    await service().getMentionsCount(req, { ...SCOPE, tags: ['alice'] });
    expect(lastDiscriminator()).not.toEqual(byKeywords);

    await service().getMentionsCount(req, { ...SCOPE, authors: ['alice'] });
    expect(lastDiscriminator()).not.toEqual(byKeywords);

    // A source-project value equal to a platform value must not collide either.
    await service().getMentionsCount(req, { ...SCOPE, sourceProjectId: 'reddit' });
    const byProject = lastDiscriminator();

    await service().getMentionsCount(req, { ...SCOPE, platform: 'reddit' });
    expect(lastDiscriminator()).not.toEqual(byProject);
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

  it('discriminates the cache key by hasTitle — yes, no, and unset each get their own entry', async () => {
    await service().getMentionsCount(req, { ...SCOPE, hasTitle: 'yes' });
    const yes = withSocialListeningCache.mock.calls.at(-1)?.[2];

    await service().getMentionsCount(req, { ...SCOPE, hasTitle: 'no' });
    const no = withSocialListeningCache.mock.calls.at(-1)?.[2];

    await service().getMentionsCount(req, SCOPE);
    const unset = withSocialListeningCache.mock.calls.at(-1)?.[2];

    expect(yes).toEqual(['cncf', '2026-01-01', '2026-02-01', 'hasTitle=yes']);
    expect(no).toEqual(['cncf', '2026-01-01', '2026-02-01', 'hasTitle=no']);
    expect(unset).toEqual(['cncf', '2026-01-01', '2026-02-01']);
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
    expect(binds).toEqual(['cncf']);
  });

  it('binds a populated mentionIds list against the identity column', async () => {
    await service().getMentionsCount(req, { ...SCOPE, mentionIds: ['k1', 'k2'] });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('_KEY IN (?, ?)');
    expect(binds).toEqual(['cncf', 'k1', 'k2']);
  });

  it('scopes before it filters, so scope binds always precede filter binds', async () => {
    await service().getMentionsCount(req, { ...SCOPE, platform: 'Reddit', sentiment: 'negative' });

    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'reddit', 'negative']);
  });
});

describe('bookmark mode — mentionIds skip the date window', () => {
  it('omits the MENTION_TS bounds and date binds from the feed when mentionIds are present', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, mentionIds: ['k1', 'k2'], pageSize: 20 });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).not.toContain('MENTION_TS >= TO_DATE(?)');
    expect(normalized).not.toContain('MENTION_TS < TO_DATE(?)');
    expect(normalized).toContain('_KEY IN (?, ?)');
    expect(binds).toEqual(['cncf', 'k1', 'k2']);
  });

  it('omits the window from the count query too, keeping every other scope bind', async () => {
    await service().getMentionsCount(req, { ...SCOPE, mentionIds: ['k1'], platform: 'Reddit' });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).not.toContain('MENTION_TS');
    expect(binds).toEqual(['cncf', 'reddit', 'k1']);
  });

  it('keeps the half-open date window when mentionIds is absent', async () => {
    await service().getMentionsCount(req, SCOPE);

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('MENTION_TS >= TO_DATE(?)');
    expect(normalized).toContain('MENTION_TS < TO_DATE(?)');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });
});

describe('all-time mode — mark-all-as-read newest lookup', () => {
  it('omits the date window and excludes NULL-ts rows, so the page_size 1 probe lands on a dated mention', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, allTime: true, pageSize: 1 });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).not.toContain('MENTION_TS >= TO_DATE(?)');
    expect(normalized).not.toContain('MENTION_TS < TO_DATE(?)');
    // NULLS FIRST would otherwise put a NULL-ts row ahead of every dated row and the client would misread it as the newest.
    expect(normalized).toContain('MENTION_TS IS NOT NULL');
    expect(binds).toEqual(['cncf']);
  });

  it('keeps NULL-ts rows in bookmark mode — a bookmarked mention must render even with no timestamp', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, mentionIds: ['k1'], pageSize: 20 });

    expect(normalize(lastCall().sql)).not.toContain('MENTION_TS IS NOT NULL');
  });

  it('keeps NULL-ts rows in the windowed feed — NULLS FIRST paging surfaces them on the first page', async () => {
    await service().getMentionsFeed(req, { ...SCOPE, pageSize: 20 });

    expect(normalize(lastCall().sql)).not.toContain('MENTION_TS IS NOT NULL');
  });
});

describe('unread mode — read-state exclusion predicate', () => {
  it('excludes explicitly-read ids and emits no cutoff clause when readBeforeTs is absent', async () => {
    await service().getMentionsCount(req, { ...SCOPE, unreadOnly: true, readIds: ['k2', 'k1'] });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('_KEY NOT IN (?, ?)');
    expect(normalized).not.toContain('TO_TIMESTAMP_NTZ');
    // Sorted for an order-stable cache discriminator.
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'k1', 'k2']);
  });

  it('combines the cutoff with the unread overrides — newer than the cutoff, NULL timestamp, or explicitly unread', async () => {
    await service().getMentionsCount(req, { ...SCOPE, unreadOnly: true, readIds: ['k1'], unreadIds: ['k9', 'k8'], readBeforeTs: '2026-01-15 10:00:00' });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('_KEY NOT IN (?)');
    expect(normalized).toContain('((MENTION_TS > TO_TIMESTAMP_NTZ(?) OR MENTION_TS IS NULL) OR _KEY IN (?, ?))');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'k1', '2026-01-15 10:00:00', 'k8', 'k9']);
  });

  it('degrades to the bare cutoff comparison when the unread-override list is empty — NULL timestamps stay unread, matching isReadInState', async () => {
    await service().getMentionsCount(req, { ...SCOPE, unreadOnly: true, readBeforeTs: '2026-01-15 10:00:00' });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('AND (MENTION_TS > TO_TIMESTAMP_NTZ(?) OR MENTION_TS IS NULL)');
    expect(normalized).not.toContain('_KEY IN');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', '2026-01-15 10:00:00']);
  });

  it('keeps the half-open date window in unread mode — unlike all-time bookmark mode', async () => {
    await service().getMentionsCount(req, { ...SCOPE, unreadOnly: true, readIds: ['k1'] });

    const normalized = normalize(lastCall().sql);
    expect(normalized).toContain('MENTION_TS >= TO_DATE(?)');
    expect(normalized).toContain('MENTION_TS < TO_DATE(?)');
  });

  it('emits no unread clause at all when unreadOnly is absent', async () => {
    await service().getMentionsCount(req, { ...SCOPE, readIds: ['k1'], unreadIds: ['k2'], readBeforeTs: '2026-01-15 10:00:00' });

    const normalized = normalize(lastCall().sql);
    expect(normalized).not.toContain('NOT IN');
    expect(normalized).not.toContain('TO_TIMESTAMP_NTZ');
    expect(lastCall().binds).toEqual(['cncf', '2026-01-01', '2026-02-01']);
  });

  it('discriminates the cache by unread state — reordered inputs share an entry, empty and absent states do not', async () => {
    const lastDiscriminator = (): unknown => withSocialListeningCache.mock.calls.at(-1)?.[2];

    await service().getMentionsCount(req, { ...SCOPE, unreadOnly: true, readIds: ['k2', 'k1'], unreadIds: ['k9'], readBeforeTs: '2026-01-15 10:00:00' });
    const first = lastDiscriminator();

    // Sorted canonicalization makes the discriminator order-stable.
    await service().getMentionsCount(req, { ...SCOPE, unreadOnly: true, readIds: ['k1', 'k2'], unreadIds: ['k9'], readBeforeTs: '2026-01-15 10:00:00' });
    expect(lastDiscriminator()).toEqual(first);

    // Unread with an empty read-state doc must not share the unfiltered entry.
    await service().getMentionsCount(req, { ...SCOPE, unreadOnly: true });
    const emptyUnread = lastDiscriminator();

    await service().getMentionsCount(req, SCOPE);
    expect(lastDiscriminator()).not.toEqual(emptyUnread);
    expect(emptyUnread).not.toEqual(first);
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

  it('keys the language and keyword caches on the scope discriminator', async () => {
    await service().getMentionsLanguages(req, SCOPE);
    expect(withSocialListeningCache).toHaveBeenCalledWith('cncf', 'languages', ['cncf', '2026-01-01', '2026-02-01'], 1800, expect.any(Function));

    await service().getMentionsKeywords(req, { ...SCOPE, platform: 'reddit' });
    expect(withSocialListeningCache).toHaveBeenLastCalledWith(
      'cncf',
      'keywords',
      ['cncf', '2026-01-01', '2026-02-01', 'reddit', 'platform', 'reddit'],
      1800,
      expect.any(Function)
    );
  });
});

describe('analytics', () => {
  const analyticsScope: SocialListeningAnalyticsParams = { foundationSlug: 'cncf', periodKey: 'ytd' };
  const panels = [
    {
      method: 'getAnalyticsOverview',
      relation: 'OVERVIEW',
      resource: 'overview',
      suffix: 'LIMIT 1',
    },
    {
      method: 'getAnalyticsOverTime',
      relation: 'OVER_TIME',
      resource: 'over-time',
      suffix: 'AND SOURCE_PROJECT_ID IS NOT NULL AND SOURCE_PROJECT_NAME IS NOT NULL ORDER BY BUCKET_START_DATE, SOURCE_PROJECT_NAME',
    },
    {
      method: 'getAnalyticsPlatformDistribution',
      relation: 'PLATFORM_DISTRIBUTION',
      resource: 'platform-distribution',
      suffix: 'ORDER BY MENTIONS_COUNT DESC, SOURCE_PLATFORM',
    },
    {
      method: 'getAnalyticsSentimentDistribution',
      relation: 'SENTIMENT_DISTRIBUTION',
      resource: 'sentiment-distribution',
      suffix: 'ORDER BY MENTION_COUNT DESC, SENTIMENT',
    },
    {
      method: 'getAnalyticsTopProjects',
      relation: 'TOP_PROJECTS',
      resource: 'top-projects',
      suffix: 'AND PROJECT_RANK <= ? ORDER BY PROJECT_RANK',
    },
  ] as const;

  /** Model the real read-through boundary: only a fulfilled fetcher writes an entry. */
  function useReadThroughCache(): Map<string, unknown> {
    const entries = new Map<string, unknown>();
    withSocialListeningCache.mockImplementation(
      async (slug: string, resource: string, discriminator: readonly unknown[], _ttl: number, fetcher: () => Promise<unknown>) => {
        const key = JSON.stringify([slug, resource, discriminator]);
        if (entries.has(key)) {
          return entries.get(key);
        }
        const result = await fetcher();
        entries.set(key, result);
        return result;
      }
    );
    return entries;
  }

  it.each(panels)('$method queries governed relations with aligned scope binds and the dedicated TTL', async (panel) => {
    await service()[panel.method](req, analyticsScope);

    const { sql, binds } = lastCall();
    const expectedBinds = ['cncf', 'ytd', 'all', 'all', ...(panel.method === 'getAnalyticsTopProjects' ? [5] : [])];
    expect(sql).toContain(`FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_LISTENING_ANALYTICS_${panel.relation}`);
    expect(normalize(sql)).toContain('WHERE PROJECT_SLUG = ? AND PERIOD_KEY = ? AND SOURCE_PROJECT_SCOPE = ? AND PLATFORM_SCOPE = ?');
    expect(normalize(sql)).toContain(panel.suffix);
    expect(binds).toEqual(expectedBinds);
    expect(sql.match(/\?/g)).toHaveLength(expectedBinds.length);
    expect(withSocialListeningCache).toHaveBeenLastCalledWith('cncf', `governed-analytics-${panel.resource}`, expectedBinds, 300, expect.any(Function));
  });

  it.each(panels)('$method binds opaque scope values without putting them or stale content filters in SQL', async (panel) => {
    const params = {
      foundationSlug: "cncf' OR 1=1 --",
      periodKey: "2026-08' OR 1=1 --",
      sourceProjectId: "project' OR 1=1 --",
      platform: "Reddit' OR 1=1 --",
      sentiment: 'negative',
      search: 'mesh',
      keywords: ['Kubernetes'],
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    };
    await service()[panel.method](req, params);

    const { sql, binds } = lastCall();
    expect(binds).toEqual([
      params.foundationSlug,
      params.periodKey,
      params.sourceProjectId,
      params.platform.toLowerCase(),
      ...(panel.method === 'getAnalyticsTopProjects' ? [5] : []),
    ]);
    expect(sql.match(/\?/g)).toHaveLength(binds.length);
    for (const value of [params.foundationSlug, params.periodKey, params.sourceProjectId, params.platform, params.search, params.keywords[0]]) {
      expect(sql).not.toContain(value);
    }
    expect(sql).not.toMatch(/SOCIAL_LISTENING_FEED|MENTION_TS|ILIKE|COUNT\(|SUM\(|ROUND\(|GROUP BY/);
  });

  it.each([{ rows: [] }, {}])('never caches a missing overview, then serves and caches the newly materialized row', async (emptyResult) => {
    const entries = useReadThroughCache();
    const analytics = service();
    execute.mockResolvedValue(emptyResult);

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await analytics.getAnalyticsOverview(req, analyticsScope)).toEqual({
        TOTAL_MENTIONS: 0,
        TOTAL_MENTIONS_CHANGE_PCT: null,
        CHILD_PROJECTS_COUNT: 0,
        POSITIVE_SENTIMENT_PERCENT: 0,
        NEGATIVE_SENTIMENT_PERCENT: 0,
        POSITIVE_SENTIMENT_CHANGE_PCT: null,
        NEGATIVE_SENTIMENT_CHANGE_PCT: null,
        COMPUTED_AT: null,
      });
      expect(entries.size).toBe(0);
    }
    expect(execute).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(req, 'social_listening_analytics_overview', expect.any(String), { foundation_slug: 'cncf' });
    expect(logger.warning).not.toHaveBeenCalled();

    execute.mockResolvedValue({
      rows: [
        {
          TOTAL_MENTIONS: 37,
          TOTAL_MENTIONS_CHANGE_PCT: null,
          CHILD_PROJECTS_COUNT: 2,
          POSITIVE_SENTIMENT_PERCENT: 70.3,
          NEGATIVE_SENTIMENT_PERCENT: 8.1,
          POSITIVE_SENTIMENT_CHANGE_PCT: null,
          NEGATIVE_SENTIMENT_CHANGE_PCT: null,
          COMPUTED_AT: '2026-08-01T04:00:00Z',
        },
      ],
    });
    const materialized = await analytics.getAnalyticsOverview(req, analyticsScope);
    expect(materialized.TOTAL_MENTIONS).toBe(37);
    expect(materialized.COMPUTED_AT).toBe('2026-08-01T04:00:00Z');
    expect(materialized.TOTAL_MENTIONS_CHANGE_PCT).toBeNull();
    expect(materialized.POSITIVE_SENTIMENT_CHANGE_PCT).toBeNull();
    expect(materialized.NEGATIVE_SENTIMENT_CHANGE_PCT).toBeNull();
    expect(await analytics.getAnalyticsOverview(req, analyticsScope)).toEqual(materialized);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(entries.size).toBe(1);
  });

  it.each(panels)('$method propagates warehouse failures without caching a fallback', async (panel) => {
    const entries = useReadThroughCache();
    const error = new Error('warehouse unavailable');
    execute.mockRejectedValue(error);

    await expect(service()[panel.method](req, analyticsScope)).rejects.toBe(error);
    await expect(service()[panel.method](req, analyticsScope)).rejects.toBe(error);
    expect(entries.size).toBe(0);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('propagates a cache failure instead of serving a zeroed overview', async () => {
    const error = new Error('cache unavailable');
    withSocialListeningCache.mockRejectedValueOnce(error);

    await expect(service().getAnalyticsOverview(req, analyticsScope)).rejects.toBe(error);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(panels)('$method ignores content changes but isolates every scope dimension and old live-analytics entries', async (panel) => {
    const entries = useReadThroughCache();
    const analytics = service();
    execute.mockResolvedValue({ rows: [{}] });
    const discriminator = ['cncf', 'ytd', 'all', 'all', ...(panel.method === 'getAnalyticsTopProjects' ? [5] : [])];
    entries.set(JSON.stringify(['cncf', `analytics-${panel.resource}`, discriminator]), 'stale live value');

    await analytics[panel.method](req, analyticsScope);
    const staleClientParams = { ...analyticsScope, sentiment: 'negative', search: 'mesh' };
    await analytics[panel.method](req, staleClientParams);
    expect(execute).toHaveBeenCalledTimes(1);

    for (const changedScope of [
      { ...analyticsScope, foundationSlug: 'lf' },
      { ...analyticsScope, periodKey: 'last-3' },
      { ...analyticsScope, sourceProjectId: 'project-1' },
      { ...analyticsScope, platform: 'Reddit' },
    ]) {
      await analytics[panel.method](req, changedScope);
    }
    expect(execute).toHaveBeenCalledTimes(5);
    await analytics[panel.method](req, { ...analyticsScope, platform: 'reddit' });
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('keeps different governed panels in separate cache entries for an identical scope', async () => {
    const entries = useReadThroughCache();
    const analytics = service();
    execute.mockResolvedValue({ rows: [{}] });

    for (const panel of panels) {
      await analytics[panel.method](req, analyticsScope);
      await analytics[panel.method](req, analyticsScope);
    }
    expect(execute).toHaveBeenCalledTimes(5);
    expect(entries.size).toBe(5);
  });

  it.each([
    { limit: undefined, expected: 5 },
    { limit: 9999, expected: 100 },
    { limit: 0, expected: 1 },
    { limit: -10, expected: 1 },
    { limit: 3.9, expected: 3 },
    { limit: NaN, expected: 1 },
  ])('binds the bounded top-project rank for limit $limit', async ({ limit, expected }) => {
    await service().getAnalyticsTopProjects(req, { ...analyticsScope, limit });

    const { sql, binds } = lastCall();
    expect(normalize(sql)).toContain('AND PROJECT_RANK <= ? ORDER BY PROJECT_RANK');
    expect(sql).not.toContain('LIMIT');
    expect(binds).toEqual(['cncf', 'ytd', 'all', 'all', expected]);
    expect(sql.match(/\?/g)).toHaveLength(5);
    expect(withSocialListeningCache).toHaveBeenLastCalledWith('cncf', 'governed-analytics-top-projects', binds, 300, expect.any(Function));
  });

  it('isolates top-project limits but reuses an entry for overrides with the same clamped rank', async () => {
    useReadThroughCache();
    const analytics = service();

    await analytics.getAnalyticsTopProjects(req, analyticsScope);
    await analytics.getAnalyticsTopProjects(req, { ...analyticsScope, limit: 1 });
    await analytics.getAnalyticsTopProjects(req, { ...analyticsScope, limit: 0 });
    await analytics.getAnalyticsTopProjects(req, { ...analyticsScope, limit: 9999 });
    await analytics.getAnalyticsTopProjects(req, { ...analyticsScope, limit: 100 });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls.map(([, binds]) => binds.at(-1))).toEqual([5, 1, 100]);
  });

  it('filters the tags endpoint too, aliasing the columns so the LATERAL FLATTEN join stays unambiguous', async () => {
    await service().getMentionsTags(req, { ...SCOPE, tags: ['ai'], authors: ['@alice'] });

    const { sql, binds } = lastCall();
    const normalized = normalize(sql);
    expect(normalized).toContain('SPLIT(REGEXP_REPLACE(LOWER(TRIM(m.TAGS))');
    expect(normalized).toContain('m.AUTHOR IN (?)');
    expect(binds).toEqual(['cncf', '2026-01-01', '2026-02-01', 'ai', '@alice']);
    // The filter discriminator (binds + dimension markers) keys the cache entry alongside the row cap.
    expect(withSocialListeningCache).toHaveBeenLastCalledWith(
      'cncf',
      'tags',
      ['cncf', '2026-01-01', '2026-02-01', 'ai', '@alice', 'tags', 'ai', 'authors', '@alice', 10],
      1800,
      expect.any(Function)
    );
  });
});
