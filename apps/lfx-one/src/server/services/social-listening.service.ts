// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ANALYTICS_TOP_PROJECTS_LIMIT,
  MENTION_FEED_BODY_MAX_CHARS,
  MENTION_FILTER_MAX_VALUES,
  MENTION_IDS_MAX_VALUES,
  MENTION_MAX_FEED_OFFSET,
  MENTION_READ_IDS_MAX_VALUES,
  MENTION_TOP_TAGS_LIMIT,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import {
  SocialListeningAnalyticsOverview,
  SocialListeningAnalyticsParams,
  SocialListeningAuthorsParams,
  SocialListeningCountParams,
  SocialListeningFeedParams,
  SocialListeningFeedResponse,
  SocialListeningFilterParams,
  SocialListeningMention,
  SocialListeningMentionAuthor,
  SocialListeningOptionsParams,
  SocialListeningOverTimePoint,
  SocialListeningPlatform,
  SocialListeningPlatformDistribution,
  SocialListeningScopedOptionsParams,
  SocialListeningSentimentDistribution,
  SocialListeningSubProject,
  SocialListeningTagCount,
  SocialListeningTagsParams,
  SocialListeningTopProject,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { socialListeningFeedTable } from '../helpers/snowflake-schema.helper';
import { MAX_ANALYTICS_LIMIT, MAX_FEED_LIMIT } from '../helpers/social-listening-params.helper';
import { escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withSocialListeningCache } from './valkey.service';

/**
 * Explicit feed projection: renames `_KEY`, drops `SOURCE_ID`/`BOOKMARKED` (deferred) and the `IS_*`
 * window flags (this app resolves its own range), and caps `BODY` so a page of blog-length posts
 * can't balloon the response.
 */
const FEED_COLUMNS = [
  '_KEY AS MENTION_ID',
  'PROJECT_ID',
  'PROJECT_NAME',
  'PROJECT_SLUG',
  'SOURCE_PROJECT_ID',
  'SOURCE_PROJECT_NAME',
  'TITLE',
  `LEFT(BODY, ${MENTION_FEED_BODY_MAX_CHARS}) AS BODY`,
  'AUTHOR',
  'AUTHOR_PROFILE_LINK',
  'SOURCE_PLATFORM',
  'SOCIAL_NETWORK',
  'SENTIMENT',
  'URL',
  'RELEVANCE_SCORE',
  'RELEVANCE_COMMENT',
  'IMAGE_URL',
  'LANGUAGE',
  'SUBREDDIT',
  'VIEW_NAME',
  'MENTION_TS',
  'KEYWORD',
  'TAGS',
  'COMPUTED_AT',
].join(', ');

/** Day-grain buckets stay readable up to roughly two months; anything longer rolls up to months. */
const DAY_GRAIN_MAX_DAYS = 62;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `LIKE`/`ILIKE` escape char — must stay in sync with `escapeSqlLikePattern()`. `!` not `\`: the SQL literal needs no backslash doubling. */
const LIKE_ESCAPE_CHAR = '!';

/** Comma delimiter plus surrounding whitespace, normalized away before `TAGS` is split. POSIX classes, not `\s`, so the SQL literal needs no backslash doubling. */
const TAG_DELIMITER_PATTERN = '[[:space:]]*,[[:space:]]*';

/** Only ever `string | number` — every user-supplied value reaches Snowflake as a bind, never as SQL text. */
type QueryBind = string | number;

interface SqlFragment {
  clause: string;
  binds: QueryBind[];
  /** Cache-key discriminator: binds plus per-dimension markers, so predicates with identical values (or no bind) can't share one cache entry. */
  discriminator: QueryBind[];
}

/** Aggregates without GROUP BY always emit one row, so an empty overview result is a driver-level anomaly — thrown through the cache wrapper so the zeroed fallback is never cached for the full TTL. */
class OverviewNoRowsError extends Error {}

/** Whitelisted `DATE_TRUNC` grain + `TO_CHAR` label format. Never derived from user input. */
interface TimeGrain {
  unit: 'DAY' | 'MONTH';
  labelFormat: string;
}

const TIME_GRAINS: Record<'day' | 'month', TimeGrain> = {
  day: { unit: 'DAY', labelFormat: 'MON DD' },
  month: { unit: 'MONTH', labelFormat: 'MON YYYY' },
};

/**
 * Snowflake reads for the Social Listening page (LFXV2-3002, PCC port): explicit `PROJECT_SLUG` +
 * half-open `MENTION_TS` range instead of PCC's `IS_*` flags; analytics computed from the feed table.
 */
export class SocialListeningService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** One page of mentions, newest first; `computedAt` rides the newest row — safe because the backing dbt model is a full-refresh `table` (hourly rebuild stamps every row with the same `COMPUTED_AT`). Null for an empty page. */
  public async getMentionsFeed(req: Request, params: SocialListeningFeedParams): Promise<SocialListeningFeedResponse> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(req, params);
    const limit = this.clampInteger(params.limit, 1, MAX_FEED_LIMIT);
    const offset = this.clampInteger(params.offset, 0, MENTION_MAX_FEED_OFFSET);

    const sql = `
      SELECT ${FEED_COLUMNS}
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}${filters.clause}
      -- MENTION_TS is not unique, so _KEY breaks ties into a total order OFFSET paging can rely on.
      ORDER BY MENTION_TS DESC, _KEY DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    logger.debug(req, 'social_listening_mentions_feed', 'Querying mentions feed', {
      foundation_slug: params.foundationSlug,
      limit,
      offset,
    });

    const result = await this.snowflakeService.execute<SocialListeningMention>(sql, [...scope.binds, ...filters.binds]);
    const mentions = result.rows ?? [];

    return { mentions, computedAt: mentions[0]?.COMPUTED_AT ?? null };
  }

  /** Total rows matching the same scope + filters as the feed, for the paginator. Count is pagination-invariant, so caching it keeps paging from re-running the same full scan. */
  public async getMentionsCount(req: Request, params: SocialListeningCountParams): Promise<number> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(req, params);

    const sql = `
      SELECT COUNT(*) AS TOTAL
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}${filters.clause}
    `;

    return this.cached(req, params.foundationSlug, 'mentions-count', [...scope.discriminator, ...filters.discriminator], async () => {
      const result = await this.snowflakeService.execute<{ TOTAL: number }>(sql, [...scope.binds, ...filters.binds]);
      return Number(result.rows?.[0]?.TOTAL ?? 0);
    });
  }

  /** Sub-project options, deliberately date-unscoped: narrowing by the current window would make options disappear as the user pages back. */
  public async getMentionsProjects(req: Request, params: SocialListeningOptionsParams): Promise<SocialListeningSubProject[]> {
    const sql = `
      SELECT DISTINCT SOURCE_PROJECT_ID, SOURCE_PROJECT_NAME
      FROM ${socialListeningFeedTable()}
      WHERE PROJECT_SLUG = ?
        AND SOURCE_PROJECT_ID IS NOT NULL
        AND SOURCE_PROJECT_NAME IS NOT NULL
      ORDER BY SOURCE_PROJECT_NAME
    `;

    return this.cached(req, params.foundationSlug, 'projects', [], async () => {
      const result = await this.snowflakeService.execute<SocialListeningSubProject>(sql, [params.foundationSlug]);
      return result.rows ?? [];
    });
  }

  /** Platform options — also date-unscoped, for the same reason as sub-projects. */
  public async getMentionsPlatforms(req: Request, params: SocialListeningOptionsParams): Promise<SocialListeningPlatform[]> {
    const sql = `
      SELECT DISTINCT SOURCE_PLATFORM, SOCIAL_NETWORK
      FROM ${socialListeningFeedTable()}
      WHERE PROJECT_SLUG = ?
        AND SOURCE_PLATFORM IS NOT NULL
        AND SOURCE_PLATFORM != ''
      ORDER BY SOCIAL_NETWORK
    `;

    return this.cached(req, params.foundationSlug, 'platforms', [], async () => {
      const result = await this.snowflakeService.execute<SocialListeningPlatform>(sql, [params.foundationSlug]);
      return result.rows ?? [];
    });
  }

  public async getMentionsLanguages(req: Request, params: SocialListeningScopedOptionsParams): Promise<string[]> {
    const scope = this.buildScope(params);

    const sql = `
      SELECT DISTINCT LOWER(LANGUAGE) AS LANGUAGE
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}
        AND LANGUAGE IS NOT NULL
        AND LANGUAGE != ''
      ORDER BY LANGUAGE
    `;

    return this.cached(req, params.foundationSlug, 'languages', scope.discriminator, async () => {
      const result = await this.snowflakeService.execute<{ LANGUAGE: string }>(sql, scope.binds);
      return (result.rows ?? []).map((row) => row.LANGUAGE);
    });
  }

  public async getMentionsKeywords(req: Request, params: SocialListeningScopedOptionsParams): Promise<string[]> {
    const scope = this.buildScope(params);

    const sql = `
      SELECT DISTINCT LOWER(KEYWORD) AS KEYWORD
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}
        AND KEYWORD IS NOT NULL
        AND KEYWORD != ''
      ORDER BY KEYWORD
    `;

    return this.cached(req, params.foundationSlug, 'keywords', scope.discriminator, async () => {
      const result = await this.snowflakeService.execute<{ KEYWORD: string }>(sql, scope.binds);
      return (result.rows ?? []).map((row) => row.KEYWORD);
    });
  }

  /** Tags with mention volume, highest first; the comma-joined upstream `TAGS` is exploded via `LATERAL FLATTEN`. Folded to lowercase because the tag filter matches case-insensitively — one listed option must map to one predicate. Serves the tag filter and the analytics top-tags panel. */
  public async getMentionsTags(req: Request, params: SocialListeningTagsParams): Promise<SocialListeningTagCount[]> {
    const scope = this.buildScope(params, 'm');
    const filters = this.buildFilters(req, params, 'm');
    // Analytics wants the top slice; the filter panel asks for the whole vocabulary it lets users select from.
    const limit = this.clampInteger(params.limit ?? MENTION_TOP_TAGS_LIMIT, 1, MENTION_FILTER_MAX_VALUES);

    const sql = `
      SELECT LOWER(TRIM(f.VALUE::STRING)) AS TAG, COUNT(*) AS TOTAL_COUNT
      FROM ${socialListeningFeedTable()} AS m,
        LATERAL FLATTEN(input => SPLIT(m.TAGS, ',')) AS f
      WHERE ${scope.clause}${filters.clause}
        AND m.TAGS IS NOT NULL
        AND m.TAGS != ''
        AND TRIM(f.VALUE::STRING) != ''
      GROUP BY LOWER(TRIM(f.VALUE::STRING))
      ORDER BY TOTAL_COUNT DESC, TAG
      LIMIT ${limit}
    `;

    // The row cap is interpolated, not bound, so it has to discriminate the cache entry itself.
    const cacheBinds: QueryBind[] = [...scope.discriminator, ...filters.discriminator, limit];

    return this.cached(req, params.foundationSlug, 'tags', cacheBinds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningTagCount>(sql, [...scope.binds, ...filters.binds]);
      return result.rows ?? [];
    });
  }

  /** Author options cascading off every other filter; a multi-platform author is attributed to their busiest one (`PLATFORM_RANK = 1`), ties broken on the platform name so the icon is stable across runs. */
  public async getMentionsAuthors(req: Request, params: SocialListeningAuthorsParams): Promise<SocialListeningMentionAuthor[]> {
    const scope = this.buildScope(params);
    // `authors` and `mentionIds` are absent from this param type by construction — a multiselect
    // must never filter its own option list.
    const filters = this.buildFilters(req, params);

    const sql = `
      SELECT AUTHOR, PLATFORM, MENTION_COUNT
      FROM (
        SELECT AUTHOR,
               SOURCE_PLATFORM AS PLATFORM,
               SUM(COUNT(*)) OVER (PARTITION BY AUTHOR) AS MENTION_COUNT,
               ROW_NUMBER() OVER (PARTITION BY AUTHOR ORDER BY COUNT(*) DESC, SOURCE_PLATFORM) AS PLATFORM_RANK
        FROM ${socialListeningFeedTable()}
        WHERE ${scope.clause}
          AND AUTHOR IS NOT NULL
          AND AUTHOR != ''
          AND SOURCE_PLATFORM IS NOT NULL
          AND SOURCE_PLATFORM != ''${filters.clause}
        GROUP BY AUTHOR, SOURCE_PLATFORM
      )
      WHERE PLATFORM_RANK = 1
      ORDER BY MENTION_COUNT DESC
      LIMIT ${MENTION_FILTER_MAX_VALUES}
    `;

    return this.cached(req, params.foundationSlug, 'mentions-authors', [...scope.discriminator, ...filters.discriminator], async () => {
      const result = await this.snowflakeService.execute<SocialListeningMentionAuthor>(sql, [...scope.binds, ...filters.binds]);
      return result.rows ?? [];
    });
  }

  /**
   * Headline KPIs plus change vs. the preceding equal-length window; the change figure is suppressed
   * (null) when the previous window holds < 20% of the current volume (PCC's partial-backfill guard).
   */
  public async getAnalyticsOverview(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningAnalyticsOverview> {
    const previous = this.previousWindow(params.startDate, params.endDate);
    // The base CTE spans previous-start → current-end so both windows are read in a single pass.
    const base = this.buildScope({ ...params, startDate: previous.startDate, endDate: params.endDate });
    const filters = this.buildFilters(req, params);

    const sql = `
      WITH base AS (
        SELECT SENTIMENT, SOURCE_PROJECT_ID, MENTION_TS
        FROM ${socialListeningFeedTable()}
        WHERE ${base.clause}${filters.clause}
      ),
      current_window AS (
        SELECT COUNT(*) AS TOTAL,
               COUNT(DISTINCT SOURCE_PROJECT_ID) AS CHILD_PROJECTS,
               COUNT_IF(LOWER(TRIM(SENTIMENT)) = 'positive') AS POSITIVE,
               COUNT_IF(LOWER(TRIM(SENTIMENT)) = 'negative') AS NEGATIVE
        FROM base
        WHERE MENTION_TS >= TO_DATE(?) AND MENTION_TS < TO_DATE(?)
      ),
      previous_window AS (
        SELECT COUNT(*) AS TOTAL,
               COUNT_IF(LOWER(TRIM(SENTIMENT)) = 'positive') AS POSITIVE,
               COUNT_IF(LOWER(TRIM(SENTIMENT)) = 'negative') AS NEGATIVE
        FROM base
        WHERE MENTION_TS >= TO_DATE(?) AND MENTION_TS < TO_DATE(?)
      )
      SELECT c.TOTAL AS TOTAL_MENTIONS,
             c.CHILD_PROJECTS AS CHILD_PROJECTS_COUNT,
             CASE WHEN c.TOTAL = 0 THEN 0 ELSE ROUND(c.POSITIVE / c.TOTAL::FLOAT * 100, 1) END AS POSITIVE_SENTIMENT_PERCENT,
             CASE WHEN c.TOTAL = 0 THEN 0 ELSE ROUND(c.NEGATIVE / c.TOTAL::FLOAT * 100, 1) END AS NEGATIVE_SENTIMENT_PERCENT,
             CASE WHEN p.TOTAL = 0 OR p.TOTAL < c.TOTAL * 0.2 THEN NULL
                  ELSE ROUND((c.TOTAL - p.TOTAL) / p.TOTAL::FLOAT * 100, 1) END AS TOTAL_MENTIONS_CHANGE_PCT,
             CASE WHEN c.TOTAL = 0 OR p.TOTAL = 0 OR p.TOTAL < c.TOTAL * 0.2 THEN NULL
                  ELSE ROUND(c.POSITIVE / c.TOTAL::FLOAT * 100 - p.POSITIVE / p.TOTAL::FLOAT * 100, 1) END AS POSITIVE_SENTIMENT_CHANGE_PCT,
             CASE WHEN c.TOTAL = 0 OR p.TOTAL = 0 OR p.TOTAL < c.TOTAL * 0.2 THEN NULL
                  ELSE ROUND(c.NEGATIVE / c.TOTAL::FLOAT * 100 - p.NEGATIVE / p.TOTAL::FLOAT * 100, 1) END AS NEGATIVE_SENTIMENT_CHANGE_PCT
      FROM current_window c
      CROSS JOIN previous_window p
    `;

    const binds: QueryBind[] = [...base.binds, ...filters.binds, params.startDate, params.endDate, previous.startDate, previous.endDate];
    const discriminator: QueryBind[] = [
      ...base.discriminator,
      ...filters.discriminator,
      params.startDate,
      params.endDate,
      previous.startDate,
      previous.endDate,
    ];

    return this.cached(req, params.foundationSlug, 'analytics-overview', discriminator, async () => {
      const result = await this.snowflakeService.execute<SocialListeningAnalyticsOverview>(sql, binds);
      const row = result.rows?.[0];

      if (!row) {
        throw new OverviewNoRowsError();
      }

      return row;
    }).catch((error: unknown) => {
      if (!(error instanceof OverviewNoRowsError)) {
        throw error;
      }

      logger.warning(req, 'social_listening_analytics_overview', 'Overview query returned no rows — serving zeroed overview', {
        foundation_slug: params.foundationSlug,
      });

      return {
        TOTAL_MENTIONS: 0,
        TOTAL_MENTIONS_CHANGE_PCT: null,
        CHILD_PROJECTS_COUNT: 0,
        POSITIVE_SENTIMENT_PERCENT: 0,
        NEGATIVE_SENTIMENT_PERCENT: 0,
        POSITIVE_SENTIMENT_CHANGE_PCT: null,
        NEGATIVE_SENTIMENT_CHANGE_PCT: null,
      };
    });
  }

  /** Mention volume bucketed by day (windows up to ~2 months) or month (anything longer), split per sub-project. */
  public async getAnalyticsOverTime(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningOverTimePoint[]> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(req, params);
    const grain = this.resolveGrain(params.startDate, params.endDate);

    const sql = `
      SELECT TO_CHAR(DATE_TRUNC('${grain.unit}', MENTION_TS), 'YYYY-MM-DD') AS PERIOD_START,
             TO_CHAR(DATE_TRUNC('${grain.unit}', MENTION_TS), '${grain.labelFormat}') AS PERIOD_LABEL,
             SOURCE_PROJECT_ID,
             SOURCE_PROJECT_NAME,
             COUNT(*) AS TOTAL_MENTIONS
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}${filters.clause}
        AND SOURCE_PROJECT_ID IS NOT NULL
        AND SOURCE_PROJECT_NAME IS NOT NULL
      GROUP BY DATE_TRUNC('${grain.unit}', MENTION_TS), SOURCE_PROJECT_ID, SOURCE_PROJECT_NAME
      ORDER BY DATE_TRUNC('${grain.unit}', MENTION_TS)
    `;

    return this.cached(req, params.foundationSlug, `analytics-over-time-${grain.unit}`, [...scope.discriminator, ...filters.discriminator], async () => {
      const result = await this.snowflakeService.execute<SocialListeningOverTimePoint>(sql, [...scope.binds, ...filters.binds]);
      return result.rows ?? [];
    });
  }

  public async getAnalyticsPlatformDistribution(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningPlatformDistribution[]> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(req, params);

    const sql = `
      SELECT SOURCE_PLATFORM,
             MAX(SOCIAL_NETWORK) AS SOCIAL_NETWORK,
             COUNT(*) AS MENTIONS_COUNT,
             ROUND(COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0)::FLOAT * 100, 1) AS PERCENT_OF_TOTAL
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}${filters.clause}
        AND SOURCE_PLATFORM IS NOT NULL
        AND SOURCE_PLATFORM != ''
      GROUP BY SOURCE_PLATFORM
      ORDER BY MENTIONS_COUNT DESC
    `;

    return this.cached(req, params.foundationSlug, 'analytics-platform-distribution', [...scope.discriminator, ...filters.discriminator], async () => {
      const result = await this.snowflakeService.execute<SocialListeningPlatformDistribution>(sql, [...scope.binds, ...filters.binds]);
      return result.rows ?? [];
    });
  }

  /** Off-list upstream values (null, blank, mixed, unknown) bucket as neutral, matching the feed's normalizeSentiment. */
  public async getAnalyticsSentimentDistribution(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningSentimentDistribution[]> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(req, params);

    const sql = `
      SELECT CASE WHEN LOWER(TRIM(SENTIMENT)) IN ('positive', 'negative') THEN LOWER(TRIM(SENTIMENT)) ELSE 'neutral' END AS SENTIMENT,
             COUNT(*) AS MENTION_COUNT,
             ROUND(COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0)::FLOAT * 100, 1) AS PERCENT_OF_TOTAL
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}${filters.clause}
      GROUP BY CASE WHEN LOWER(TRIM(SENTIMENT)) IN ('positive', 'negative') THEN LOWER(TRIM(SENTIMENT)) ELSE 'neutral' END
      ORDER BY MENTION_COUNT DESC
    `;

    return this.cached(req, params.foundationSlug, 'analytics-sentiment-distribution', [...scope.discriminator, ...filters.discriminator], async () => {
      const result = await this.snowflakeService.execute<SocialListeningSentimentDistribution>(sql, [...scope.binds, ...filters.binds]);
      return result.rows ?? [];
    });
  }

  public async getAnalyticsTopProjects(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningTopProject[]> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(req, params);
    const limit = this.clampInteger(params.limit ?? ANALYTICS_TOP_PROJECTS_LIMIT, 1, MAX_ANALYTICS_LIMIT);

    const sql = `
      SELECT SOURCE_PROJECT_NAME, COUNT(*) AS TOTAL_MENTIONS
      FROM ${socialListeningFeedTable()}
      WHERE ${scope.clause}${filters.clause}
        AND SOURCE_PROJECT_NAME IS NOT NULL
        AND SOURCE_PROJECT_NAME != ''
      GROUP BY SOURCE_PROJECT_NAME
      ORDER BY TOTAL_MENTIONS DESC
      LIMIT ${limit}
    `;

    // `limit` is interpolated rather than bound, so it has to stay in the cache key explicitly.
    const cacheBinds: QueryBind[] = [...scope.discriminator, ...filters.discriminator, limit];

    return this.cached(req, params.foundationSlug, 'analytics-top-projects', cacheBinds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningTopProject>(sql, [...scope.binds, ...filters.binds]);
      return result.rows ?? [];
    });
  }

  /** Foundation + half-open date window + the two shared scope selects; `alias` prefixes columns for the one joining query (`getMentionsTags`). */
  private buildScope(params: SocialListeningScopedOptionsParams & { mentionIds?: string[] }, alias?: string): SqlFragment {
    const col = (name: string): string => (alias ? `${alias}.${name}` : name);
    // Bookmark mode (`mentionIds` present): bookmarks are all-time — a date window would hide any older than the current period.
    // `allTime` (mark-all-as-read newest lookup): same all-time span so the cutoff is foundation-global across every period.
    const windowed = params.mentionIds === undefined && !params.allTime;
    const clauses = windowed
      ? [`${col('PROJECT_SLUG')} = ?`, `${col('MENTION_TS')} >= TO_DATE(?)`, `${col('MENTION_TS')} < TO_DATE(?)`]
      : [`${col('PROJECT_SLUG')} = ?`];
    const binds: QueryBind[] = windowed ? [params.foundationSlug, params.startDate, params.endDate] : [params.foundationSlug];
    const markers: QueryBind[] = [];

    if (params.sourceProjectId && params.sourceProjectId !== 'all') {
      clauses.push(`${col('SOURCE_PROJECT_ID')} = ?`);
      binds.push(params.sourceProjectId);
      markers.push('project', params.sourceProjectId);
    }

    if (params.platform && params.platform !== 'all') {
      clauses.push(`LOWER(${col('SOURCE_PLATFORM')}) = ?`);
      binds.push(params.platform.toLowerCase());
      markers.push('platform', params.platform.toLowerCase());
    }

    return { clause: clauses.join('\n        AND '), binds, discriminator: [...binds, ...markers] };
  }

  /**
   * Feed filters as a fragment appended to an existing `WHERE`; every user value is a bind, arrays are
   * capped, `LIKE` wildcards escaped. `sourceProjectId`/`platform` stay in `buildScope` (applied once).
   * Binds are canonicalized — arrays sorted, values lowercased only where the predicate is
   * case-insensitive — so the Valkey discriminator derived from them is order/case-stable.
   */
  private buildFilters(req: Request, filters: SocialListeningFilterParams, alias?: string): SqlFragment {
    const col = (name: string): string => (alias ? `${alias}.${name}` : name);
    const clauses: string[] = [];
    const binds: QueryBind[] = [];
    // Dimension markers keep the cache key predicate-aware: identical values under different filters
    // (`keywords=['a']` vs `authors=['a']`) hash identically without them, and literal clauses carry no bind.
    const markers: QueryBind[] = [];

    if (filters.sentiment && filters.sentiment !== 'all') {
      clauses.push(`LOWER(TRIM(${col('SENTIMENT')})) = ?`);
      binds.push(filters.sentiment.toLowerCase());
      markers.push('sentiment', filters.sentiment.toLowerCase());
    }

    if (filters.relevance && filters.relevance !== 'all') {
      clauses.push(`LOWER(${col('RELEVANCE_SCORE')}) = ?`);
      binds.push(filters.relevance.toLowerCase());
      markers.push('relevance', filters.relevance.toLowerCase());
    }

    if (filters.language && filters.language !== 'all') {
      clauses.push(`LOWER(${col('LANGUAGE')}) = ?`);
      binds.push(filters.language.toLowerCase());
      markers.push('language', filters.language.toLowerCase());
    }

    if (filters.hasTitle === 'yes') {
      clauses.push(`${col('TITLE')} IS NOT NULL AND ${col('TITLE')} != ''`);
      markers.push('hasTitle=yes');
    } else if (filters.hasTitle === 'no') {
      clauses.push(`(${col('TITLE')} IS NULL OR ${col('TITLE')} = '')`);
      markers.push('hasTitle=no');
    }

    const keywords = this.capValues(req, filters.keywords, MENTION_FILTER_MAX_VALUES)
      .map((keyword) => keyword.toLowerCase())
      .sort();
    if (keywords.length > 0) {
      clauses.push(`LOWER(${col('KEYWORD')}) IN (${this.placeholders(keywords.length)})`);
      binds.push(...keywords);
      markers.push('keywords', ...keywords);
    }

    // TAGS is a comma-joined string upstream, so it is split into exact tokens before comparing —
    // a substring match would let `ai` select mentions tagged `email` or `retail`. ANDed per tag.
    const tags = this.capValues(req, filters.tags, MENTION_FILTER_MAX_VALUES)
      .map((tag) => tag.toLowerCase())
      .sort();
    for (const tag of tags) {
      clauses.push(`ARRAY_CONTAINS(?::VARIANT, SPLIT(REGEXP_REPLACE(LOWER(TRIM(${col('TAGS')})), '${TAG_DELIMITER_PATTERN}', ','), ','))`);
      binds.push(tag);
    }
    if (tags.length > 0) {
      markers.push('tags', ...tags);
    }

    // Authors match verbatim (the predicate is case-sensitive), so they sort but never lowercase.
    const authors = this.capValues(req, filters.authors, MENTION_FILTER_MAX_VALUES).sort();
    if (authors.length > 0) {
      clauses.push(`${col('AUTHOR')} IN (${this.placeholders(authors.length)})`);
      binds.push(...authors);
      markers.push('authors', ...authors);
    }

    if (filters.search) {
      clauses.push(`(${col('TITLE')} ILIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}' OR ${col('BODY')} ILIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}')`);
      // ILIKE is case-insensitive, so lowering the pattern only canonicalizes the cache key.
      const pattern = `%${escapeSqlLikePattern(filters.search.toLowerCase())}%`;
      binds.push(pattern, pattern);
      markers.push('search', pattern);
    }

    if (filters.mentionIds) {
      const mentionIds = this.capValues(req, filters.mentionIds, MENTION_IDS_MAX_VALUES).sort();
      if (mentionIds.length > 0) {
        clauses.push(`${col('_KEY')} IN (${this.placeholders(mentionIds.length)})`);
        binds.push(...mentionIds);
        markers.push('mentionIds', ...mentionIds);
      } else {
        // An explicitly empty id list means "nothing selected", not "no filter".
        clauses.push('1 = 0');
        markers.push('mentionIds=empty');
      }
    }

    // Unread view: `isReadInState` negated — a mention is unread iff it is not explicitly read AND
    // (no mark-all cutoff exists OR it is newer than the cutoff OR explicitly marked unread).
    // With a null cutoff the cutoff clause drops out: every non-readIds mention is already unread.
    // A NULL MENTION_TS can never satisfy `>` — but the client's `new Date(ts)` NaN-compare also
    // never satisfies `<=` there, so NULL stays unread here to keep the two predicates in agreement.
    if (filters.unreadOnly) {
      markers.push('unreadOnly');
      // Ids match verbatim (they are opaque Snowflake keys), so they sort but never lowercase.
      const readIds = this.capValues(req, filters.readIds, MENTION_READ_IDS_MAX_VALUES).sort();
      if (readIds.length > 0) {
        clauses.push(`${col('_KEY')} NOT IN (${this.placeholders(readIds.length)})`);
        binds.push(...readIds);
        markers.push('readIds', ...readIds);
      }

      if (filters.readBeforeTs) {
        const unreadIds = this.capValues(req, filters.unreadIds, MENTION_READ_IDS_MAX_VALUES).sort();
        const cutoffClause = `(${col('MENTION_TS')} > TO_TIMESTAMP_NTZ(?) OR ${col('MENTION_TS')} IS NULL)`;
        if (unreadIds.length > 0) {
          clauses.push(`(${cutoffClause} OR ${col('_KEY')} IN (${this.placeholders(unreadIds.length)}))`);
          binds.push(filters.readBeforeTs, ...unreadIds);
          markers.push('readBeforeTs', filters.readBeforeTs, 'unreadIds', ...unreadIds);
        } else {
          clauses.push(cutoffClause);
          binds.push(filters.readBeforeTs);
          markers.push('readBeforeTs', filters.readBeforeTs);
        }
      }
    }

    return { clause: clauses.map((clause) => `\n        AND ${clause}`).join(''), binds, discriminator: [...binds, ...markers] };
  }

  /**
   * The contiguous, equal-length window immediately before `[startDate, endDate)`. Month-aligned
   * windows shift back by whole months; anything else falls back to a day shift.
   */
  private previousWindow(startDate: string, endDate: string): { startDate: string; endDate: string } {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    const isMonthAligned = start.getUTCDate() === 1 && end.getUTCDate() === 1;

    if (isMonthAligned) {
      const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
      return {
        startDate: this.toIsoDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - months, 1))),
        endDate: startDate,
      };
    }

    const spanMs = end.getTime() - start.getTime();
    return { startDate: this.toIsoDate(new Date(start.getTime() - spanMs)), endDate: startDate };
  }

  private resolveGrain(startDate: string, endDate: string): TimeGrain {
    const spanDays = (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / MS_PER_DAY;
    return spanDays <= DAY_GRAIN_MAX_DAYS ? TIME_GRAINS.day : TIME_GRAINS.month;
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Read-through cache for the filter-option and analytics queries (foundation-scoped, shared across
   * callers). The feed itself is never cached (near-zero hit rate); binds discriminate each entry.
   */
  private cached<T>(req: Request, foundationSlug: string, resource: string, discriminator: QueryBind[], fetcher: () => Promise<T>): Promise<T> {
    logger.debug(req, 'social_listening_cached_query', 'Resolving cached Social Listening query', {
      foundation_slug: foundationSlug,
      resource,
    });

    return withSocialListeningCache(foundationSlug, resource, discriminator, VALKEY_CACHE.SOCIAL_LISTENING_TTL_SECONDS, fetcher);
  }

  private capValues(req: Request, values: string[] | undefined, cap: number): string[] {
    if (!values) {
      return [];
    }

    const normalized = values.map((value) => value.trim()).filter(Boolean);
    if (normalized.length > cap) {
      logger.warning(req, 'social_listening_filter_cap', 'Truncated over-long filter value list', {
        received: normalized.length,
        cap,
      });
    }

    return normalized.slice(0, cap);
  }

  private placeholders(count: number): string {
    return Array(count).fill('?').join(', ');
  }

  /** Snowflake rejects binds in `LIMIT`/`OFFSET`, so they are interpolated as literals — this clamp (plus the HTTP layer's bounds) is what makes that safe. */
  private clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }

    return Math.min(Math.max(Math.trunc(value), min), max);
  }
}
