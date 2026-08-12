// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SOCIAL_LISTENING_MAX_FILTER_VALUES, SOCIAL_LISTENING_MAX_MENTION_IDS, SOCIAL_LISTENING_TOP_TAGS_LIMIT, VALKEY_CACHE } from '@lfx-one/shared/constants';
import {
  SocialListeningAnalyticsOverTimePoint,
  SocialListeningAnalyticsOverview,
  SocialListeningAnalyticsParams,
  SocialListeningAnalyticsPlatformDistribution,
  SocialListeningAnalyticsSentimentDistribution,
  SocialListeningAnalyticsTopProject,
  SocialListeningAuthorsParams,
  SocialListeningCountParams,
  SocialListeningFeedParams,
  SocialListeningFeedResponse,
  SocialListeningFilterParams,
  SocialListeningKeywordsParams,
  SocialListeningLanguagesParams,
  SocialListeningMention,
  SocialListeningMentionAuthor,
  SocialListeningOptionsParams,
  SocialListeningPlatform,
  SocialListeningScopeParams,
  SocialListeningSubProject,
  SocialListeningTag,
  SocialListeningTagsParams,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withSocialListeningCache } from './valkey.service';

/**
 * Octolens-sourced mentions, materialized hourly by the `platinum_social_listening_feed` dbt model
 * (`lf-dbt`). Scoped on `PROJECT_SLUG` — the foundation slug this app already carries everywhere —
 * rather than the model's `PROJECT_ID`, which is a Salesforce id the frontend never holds.
 */
const FEED_TABLE = 'ANALYTICS.PLATINUM.SOCIAL_LISTENING_FEED';

/**
 * Columns dropped from the feed projection: the upstream source id, the global `BOOKMARKED` flag
 * (per-user bookmarks are deferred — see LFXV2-3002), and every pre-computed range flag. The flags
 * only express fixed windows (`IS_30D`, `IS_YTD`, …) and this app filters on an arbitrary
 * `[startDate, endDate)` resolved from the shared period selector, so they are dead weight on the wire.
 */
const FEED_EXCLUDED_COLUMNS = [
  'SOURCE_ID',
  'BOOKMARKED',
  'IS_YTD',
  'IS_7D',
  'IS_30D',
  'IS_QUARTER',
  'IS_90D',
  'IS_12M',
  'IS_ALL_TIME',
  'IS_LAST_COMPLETED_YEAR',
  'IS_PREV_COMPLETED_YEAR',
  'IS_3RD_LAST_COMPLETED_YEAR',
  'IS_4TH_LAST_COMPLETED_YEAR',
  'IS_PREV_YTD',
  'IS_PREV_7D',
  'IS_PREV_30D',
  'IS_PREV_90D',
  'IS_PREV_QUARTER',
  'IS_PREV_12M',
].join(', ');

/** Author options are capped so a foundation with a long tail can't build an unbounded response. */
const AUTHOR_OPTIONS_LIMIT = 200;

/** Distinct sub-projects contributing to a mention volume are the analytics "top projects" table's row cap. */
const TOP_PROJECTS_LIMIT = 10;

/**
 * Day-grain buckets stay readable up to roughly two months; anything longer rolls up to months.
 * A single calendar month or a trailing-30d window therefore charts daily, YTD / last-6 charts monthly.
 */
const DAY_GRAIN_MAX_DAYS = 62;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `LIKE`/`ILIKE` escape character. Must stay in sync with `escapeSqlLikePattern()`, which escapes
 * `%`, `_`, and `!` itself. `!` rather than `\` so the SQL literal needs no backslash doubling —
 * Snowflake also processes backslash escapes inside string literals.
 */
const LIKE_ESCAPE_CHAR = '!';

/** Only ever `string | number` — every user-supplied value reaches Snowflake as a bind, never as SQL text. */
type QueryBind = string | number;

interface SqlFragment {
  clause: string;
  binds: QueryBind[];
}

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
 * Snowflake reads for the Social Listening page (LFXV2-3002). Ported from PCC's
 * `social-listening-queries.service.ts` with two deliberate departures:
 *
 * - Scoping and date filtering are explicit (`PROJECT_SLUG` + a `MENTION_TS` half-open range)
 *   instead of PCC's fixed `IS_*` boolean range flags, so the shared period selector's arbitrary
 *   `YYYY-MM` months are expressible.
 * - Analytics is computed from the feed table rather than the pre-aggregated
 *   `SOCIAL_LISTENING_MENTIONS_*` views, which only expose the same fixed range suffixes. No dbt
 *   change is required either way.
 */
export class SocialListeningService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * One page of mentions, newest first. `computedAt` is the dbt rebuild timestamp carried on every
   * row and is surfaced in the UI as "Data as of"; it is null for an empty page.
   */
  public async getMentionsFeed(req: Request, params: SocialListeningFeedParams): Promise<SocialListeningFeedResponse> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(params);

    const sql = `
      SELECT * EXCLUDE (${FEED_EXCLUDED_COLUMNS}) RENAME _KEY AS MENTION_ID
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}${filters.clause}
      ORDER BY MENTION_TS DESC
      LIMIT ? OFFSET ?
    `;

    logger.debug(req, 'social_listening_mentions_feed', 'Querying mentions feed', {
      foundation_slug: params.foundationSlug,
      limit: params.limit,
      offset: params.offset,
    });

    const result = await this.snowflakeService.execute<SocialListeningMention>(sql, [...scope.binds, ...filters.binds, params.limit, params.offset]);
    const mentions = result.rows ?? [];

    return { mentions, computedAt: mentions[0]?.COMPUTED_AT ?? null };
  }

  /** Total rows matching the same scope + filters as the feed, for the paginator. */
  public async getMentionsCount(req: Request, params: SocialListeningCountParams): Promise<number> {
    const scope = this.buildScope(params);
    const filters = this.buildFilters(params);

    const sql = `
      SELECT COUNT(*) AS TOTAL
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}${filters.clause}
    `;

    logger.debug(req, 'social_listening_mentions_count', 'Counting mentions', { foundation_slug: params.foundationSlug });

    const result = await this.snowflakeService.execute<{ TOTAL: number }>(sql, [...scope.binds, ...filters.binds]);

    return Number(result.rows?.[0]?.TOTAL ?? 0);
  }

  /**
   * Sub-project options. Deliberately unscoped by date: the sub-project select drives the date-scoped
   * queries, so narrowing it by the current window would make options disappear as the user pages back.
   */
  public async getMentionsProjects(req: Request, params: SocialListeningOptionsParams): Promise<SocialListeningSubProject[]> {
    const sql = `
      SELECT DISTINCT SOURCE_PROJECT_ID, SOURCE_PROJECT_NAME
      FROM ${FEED_TABLE}
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
      FROM ${FEED_TABLE}
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

  public async getMentionsLanguages(req: Request, params: SocialListeningLanguagesParams): Promise<string[]> {
    const scope = this.buildScope(params);

    const sql = `
      SELECT DISTINCT LOWER(LANGUAGE) AS LANGUAGE
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}
        AND LANGUAGE IS NOT NULL
        AND LANGUAGE != ''
      ORDER BY LANGUAGE
    `;

    return this.cached(req, params.foundationSlug, 'languages', scope.binds, async () => {
      const result = await this.snowflakeService.execute<{ LANGUAGE: string }>(sql, scope.binds);
      return (result.rows ?? []).map((row) => row.LANGUAGE);
    });
  }

  public async getMentionsKeywords(req: Request, params: SocialListeningKeywordsParams): Promise<string[]> {
    const scope = this.buildScope(params);

    const sql = `
      SELECT DISTINCT LOWER(KEYWORD) AS KEYWORD
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}
        AND KEYWORD IS NOT NULL
        AND KEYWORD != ''
      ORDER BY KEYWORD
    `;

    return this.cached(req, params.foundationSlug, 'keywords', scope.binds, async () => {
      const result = await this.snowflakeService.execute<{ KEYWORD: string }>(sql, scope.binds);
      return (result.rows ?? []).map((row) => row.KEYWORD);
    });
  }

  /**
   * Tags with their mention volume, highest first. `TAGS` is a comma-joined string upstream, so it is
   * exploded with `LATERAL FLATTEN` before grouping. Serves both the tag filter and the analytics
   * top-tags panel — the filter sorts alphabetically client-side.
   */
  public async getMentionsTags(req: Request, params: SocialListeningTagsParams): Promise<SocialListeningTag[]> {
    const scope = this.buildScope(params, 'm');
    const limit = params.limit ?? SOCIAL_LISTENING_TOP_TAGS_LIMIT;

    const sql = `
      SELECT TRIM(f.VALUE::STRING) AS TAG, COUNT(*) AS TOTAL_COUNT
      FROM ${FEED_TABLE} AS m,
        LATERAL FLATTEN(input => SPLIT(m.TAGS, ',')) AS f
      WHERE ${scope.clause}
        AND m.TAGS IS NOT NULL
        AND m.TAGS != ''
        AND TRIM(f.VALUE::STRING) != ''
      GROUP BY TRIM(f.VALUE::STRING)
      ORDER BY TOTAL_COUNT DESC, TAG
      LIMIT ?
    `;

    const binds: QueryBind[] = [...scope.binds, limit];

    return this.cached(req, params.foundationSlug, 'tags', binds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningTag>(sql, binds);
      return result.rows ?? [];
    });
  }

  /**
   * Author options, cascading off every other active filter so the list narrows with the feed.
   * One row per author — an author posting on several platforms is attributed to their busiest one
   * (`PLATFORM_RANK = 1`) so the multiselect can show a single platform icon.
   */
  public async getMentionsAuthors(req: Request, params: SocialListeningAuthorsParams): Promise<SocialListeningMentionAuthor[]> {
    const scope = this.buildScope(params);
    // `authors` and `mentionIds` are absent from this param type by construction — a multiselect
    // must never filter its own option list.
    const filters = this.buildFilters(params);

    const sql = `
      SELECT AUTHOR, PLATFORM, MENTION_COUNT
      FROM (
        SELECT AUTHOR,
               SOURCE_PLATFORM AS PLATFORM,
               SUM(COUNT(*)) OVER (PARTITION BY AUTHOR) AS MENTION_COUNT,
               ROW_NUMBER() OVER (PARTITION BY AUTHOR ORDER BY COUNT(*) DESC) AS PLATFORM_RANK
        FROM ${FEED_TABLE}
        WHERE ${scope.clause}
          AND AUTHOR IS NOT NULL
          AND AUTHOR != ''${filters.clause}
        GROUP BY AUTHOR, SOURCE_PLATFORM
      )
      WHERE PLATFORM_RANK = 1
      ORDER BY MENTION_COUNT DESC
      LIMIT ?
    `;

    logger.debug(req, 'social_listening_mentions_authors', 'Querying author options', { foundation_slug: params.foundationSlug });

    const result = await this.snowflakeService.execute<SocialListeningMentionAuthor>(sql, [...scope.binds, ...filters.binds, AUTHOR_OPTIONS_LIMIT]);

    return result.rows ?? [];
  }

  /**
   * Headline KPIs plus change against the immediately preceding, equal-length window.
   *
   * A change figure is suppressed (null) when the previous window holds less than 20% of the current
   * window's volume — carried over from PCC, where it stops a partially-backfilled comparison window
   * from rendering as a spectacular jump.
   */
  public async getAnalyticsOverview(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningAnalyticsOverview> {
    const previous = this.previousWindow(params.startDate, params.endDate);
    // The base CTE spans previous-start → current-end so both windows are read in a single pass.
    const base = this.buildScope({ ...params, startDate: previous.startDate, endDate: params.endDate });

    const sql = `
      WITH base AS (
        SELECT SENTIMENT, SOURCE_PROJECT_ID, MENTION_TS
        FROM ${FEED_TABLE}
        WHERE ${base.clause}
      ),
      current_window AS (
        SELECT COUNT(*) AS TOTAL,
               COUNT(DISTINCT SOURCE_PROJECT_ID) AS CHILD_PROJECTS,
               COUNT_IF(LOWER(SENTIMENT) = 'positive') AS POSITIVE,
               COUNT_IF(LOWER(SENTIMENT) = 'negative') AS NEGATIVE
        FROM base
        WHERE MENTION_TS >= TO_DATE(?) AND MENTION_TS < TO_DATE(?)
      ),
      previous_window AS (
        SELECT COUNT(*) AS TOTAL,
               COUNT_IF(LOWER(SENTIMENT) = 'positive') AS POSITIVE,
               COUNT_IF(LOWER(SENTIMENT) = 'negative') AS NEGATIVE
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
                  ELSE ROUND(c.POSITIVE / c.TOTAL::FLOAT * 100 - p.POSITIVE / p.TOTAL::FLOAT * 100, 1) END AS POSITIVE_SENTIMENT_CHANGE_PP,
             CASE WHEN c.TOTAL = 0 OR p.TOTAL = 0 OR p.TOTAL < c.TOTAL * 0.2 THEN NULL
                  ELSE ROUND(c.NEGATIVE / c.TOTAL::FLOAT * 100 - p.NEGATIVE / p.TOTAL::FLOAT * 100, 1) END AS NEGATIVE_SENTIMENT_CHANGE_PP
      FROM current_window c
      CROSS JOIN previous_window p
    `;

    const binds: QueryBind[] = [...base.binds, params.startDate, params.endDate, previous.startDate, previous.endDate];

    return this.cached(req, params.foundationSlug, 'analytics-overview', binds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningAnalyticsOverview>(sql, binds);
      const row = result.rows?.[0];

      if (!row) {
        logger.warning(req, 'social_listening_analytics_overview', 'Overview query returned no rows — serving zeroed overview', {
          foundation_slug: params.foundationSlug,
        });
        return {
          TOTAL_MENTIONS: 0,
          TOTAL_MENTIONS_CHANGE_PCT: null,
          CHILD_PROJECTS_COUNT: 0,
          POSITIVE_SENTIMENT_PERCENT: 0,
          NEGATIVE_SENTIMENT_PERCENT: 0,
          POSITIVE_SENTIMENT_CHANGE_PP: null,
          NEGATIVE_SENTIMENT_CHANGE_PP: null,
        };
      }

      return row;
    });
  }

  /** Mention volume bucketed by day (windows up to ~2 months) or month (anything longer). */
  public async getAnalyticsOverTime(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningAnalyticsOverTimePoint[]> {
    const scope = this.buildScope(params);
    const grain = this.resolveGrain(params.startDate, params.endDate);

    const sql = `
      SELECT TO_CHAR(DATE_TRUNC('${grain.unit}', MENTION_TS), 'YYYY-MM-DD') AS PERIOD_START,
             TO_CHAR(DATE_TRUNC('${grain.unit}', MENTION_TS), '${grain.labelFormat}') AS PERIOD_LABEL,
             COUNT(*) AS TOTAL_MENTIONS
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}
      GROUP BY DATE_TRUNC('${grain.unit}', MENTION_TS)
      ORDER BY DATE_TRUNC('${grain.unit}', MENTION_TS)
    `;

    return this.cached(req, params.foundationSlug, `analytics-over-time-${grain.unit}`, scope.binds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningAnalyticsOverTimePoint>(sql, scope.binds);
      return result.rows ?? [];
    });
  }

  public async getAnalyticsPlatformDistribution(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningAnalyticsPlatformDistribution[]> {
    const scope = this.buildScope(params);

    const sql = `
      SELECT SOURCE_PLATFORM,
             MAX(SOCIAL_NETWORK) AS PLATFORM_DISPLAY_NAME,
             COUNT(*) AS MENTIONS_COUNT,
             ROUND(COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0)::FLOAT * 100, 1) AS PERCENT_OF_TOTAL
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}
        AND SOURCE_PLATFORM IS NOT NULL
        AND SOURCE_PLATFORM != ''
      GROUP BY SOURCE_PLATFORM
      ORDER BY MENTIONS_COUNT DESC
    `;

    return this.cached(req, params.foundationSlug, 'analytics-platform-distribution', scope.binds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningAnalyticsPlatformDistribution>(sql, scope.binds);
      return result.rows ?? [];
    });
  }

  /** A null or blank upstream sentiment is bucketed as neutral, matching how the feed renders it. */
  public async getAnalyticsSentimentDistribution(
    req: Request,
    params: SocialListeningAnalyticsParams
  ): Promise<SocialListeningAnalyticsSentimentDistribution[]> {
    const scope = this.buildScope(params);

    const sql = `
      SELECT COALESCE(NULLIF(LOWER(SENTIMENT), ''), 'neutral') AS SENTIMENT,
             COUNT(*) AS MENTION_COUNT,
             ROUND(COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0)::FLOAT * 100, 1) AS PERCENT_OF_TOTAL
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}
      GROUP BY COALESCE(NULLIF(LOWER(SENTIMENT), ''), 'neutral')
      ORDER BY MENTION_COUNT DESC
    `;

    return this.cached(req, params.foundationSlug, 'analytics-sentiment-distribution', scope.binds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningAnalyticsSentimentDistribution>(sql, scope.binds);
      return result.rows ?? [];
    });
  }

  public async getAnalyticsTopProjects(req: Request, params: SocialListeningAnalyticsParams): Promise<SocialListeningAnalyticsTopProject[]> {
    const scope = this.buildScope(params);
    const limit = params.limit ?? TOP_PROJECTS_LIMIT;

    const sql = `
      SELECT SOURCE_PROJECT_NAME, COUNT(*) AS TOTAL_MENTIONS
      FROM ${FEED_TABLE}
      WHERE ${scope.clause}
        AND SOURCE_PROJECT_NAME IS NOT NULL
        AND SOURCE_PROJECT_NAME != ''
      GROUP BY SOURCE_PROJECT_NAME
      ORDER BY TOTAL_MENTIONS DESC
      LIMIT ?
    `;

    const binds: QueryBind[] = [...scope.binds, limit];

    return this.cached(req, params.foundationSlug, 'analytics-top-projects', binds, async () => {
      const result = await this.snowflakeService.execute<SocialListeningAnalyticsTopProject>(sql, binds);
      return result.rows ?? [];
    });
  }

  /**
   * Foundation + half-open date window, plus the two scope selects that every query shares.
   * `endDate` is exclusive — `resolvePeriodRange()` returns the first of the following month.
   *
   * `alias` prefixes the column references for the one query that joins (`getMentionsTags`).
   */
  private buildScope(params: SocialListeningScopeParams & { sourceProjectId?: string; platform?: string }, alias?: string): SqlFragment {
    const col = (name: string): string => (alias ? `${alias}.${name}` : name);
    const clauses = [`${col('PROJECT_SLUG')} = ?`, `${col('MENTION_TS')} >= TO_DATE(?)`, `${col('MENTION_TS')} < TO_DATE(?)`];
    const binds: QueryBind[] = [params.foundationSlug, params.startDate, params.endDate];

    if (params.sourceProjectId && params.sourceProjectId !== 'all') {
      clauses.push(`${col('SOURCE_PROJECT_ID')} = ?`);
      binds.push(params.sourceProjectId);
    }

    if (params.platform && params.platform !== 'all') {
      clauses.push(`LOWER(${col('SOURCE_PLATFORM')}) = ?`);
      binds.push(params.platform.toLowerCase());
    }

    return { clause: clauses.join('\n        AND '), binds };
  }

  /**
   * Feed filters, as a fragment appended to an existing `WHERE` (every clause starts with `AND`).
   * Every user-supplied value is a bind — nothing is interpolated. Array filters are capped so a
   * crafted query can't build an unbounded `IN` list, and `LIKE`/`ILIKE` patterns escape the user's
   * own wildcards so a literal `%` matches a `%`.
   *
   * `sourceProjectId` and `platform` are intentionally absent: they belong to the shared scope
   * (`buildScope`) and would otherwise be applied twice.
   */
  private buildFilters(filters: SocialListeningFilterParams): SqlFragment {
    const clauses: string[] = [];
    const binds: QueryBind[] = [];

    if (filters.sentiment && filters.sentiment !== 'all') {
      clauses.push('LOWER(SENTIMENT) = ?');
      binds.push(filters.sentiment.toLowerCase());
    }

    if (filters.relevance && filters.relevance !== 'all') {
      clauses.push('LOWER(RELEVANCE_SCORE) = ?');
      binds.push(filters.relevance.toLowerCase());
    }

    if (filters.language && filters.language !== 'all') {
      clauses.push('LOWER(LANGUAGE) = ?');
      binds.push(filters.language.toLowerCase());
    }

    if (filters.hasTitle === 'yes') {
      clauses.push("TITLE IS NOT NULL AND TITLE != ''");
    } else if (filters.hasTitle === 'no') {
      clauses.push("(TITLE IS NULL OR TITLE = '')");
    }

    const keywords = this.capValues(filters.keywords, SOCIAL_LISTENING_MAX_FILTER_VALUES);
    if (keywords.length > 0) {
      clauses.push(`LOWER(KEYWORD) IN (${this.placeholders(keywords.length)})`);
      binds.push(...keywords.map((keyword) => keyword.toLowerCase()));
    }

    // TAGS is a comma-joined string upstream, so each selected tag is a substring match ANDed
    // together — a mention must carry all of them.
    const tags = this.capValues(filters.tags, SOCIAL_LISTENING_MAX_FILTER_VALUES);
    for (const tag of tags) {
      clauses.push(`LOWER(TAGS) LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}'`);
      binds.push(`%${escapeSqlLikePattern(tag.toLowerCase())}%`);
    }

    const authors = this.capValues(filters.authors, SOCIAL_LISTENING_MAX_FILTER_VALUES);
    if (authors.length > 0) {
      clauses.push(`AUTHOR IN (${this.placeholders(authors.length)})`);
      binds.push(...authors);
    }

    if (filters.search) {
      clauses.push(`(TITLE ILIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}' OR BODY ILIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}')`);
      const pattern = `%${escapeSqlLikePattern(filters.search)}%`;
      binds.push(pattern, pattern);
    }

    if (filters.mentionIds) {
      const mentionIds = this.capValues(filters.mentionIds, SOCIAL_LISTENING_MAX_MENTION_IDS);
      if (mentionIds.length > 0) {
        clauses.push(`_KEY IN (${this.placeholders(mentionIds.length)})`);
        binds.push(...mentionIds);
      } else {
        // An explicitly empty id list means "nothing selected", not "no filter".
        clauses.push('1 = 0');
      }
    }

    return { clause: clauses.map((clause) => `\n        AND ${clause}`).join(''), binds };
  }

  /**
   * The contiguous, equal-length window immediately before `[startDate, endDate)`.
   *
   * Month-aligned windows (every period the shared selector produces: a calendar month, YTD, or a
   * trailing 3/6 months) shift back by whole months so a 28-day February compares against a 31-day
   * January rather than an arbitrary 28-day slice of it. Anything else falls back to a day shift.
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
   * Read-through cache for the filter-option and analytics queries — shared across callers, since
   * the data is foundation-scoped rather than per-user (the ED gate lives in the route middleware).
   * The feed itself is never cached: its filter cardinality makes the hit rate near zero.
   *
   * The query's own binds discriminate the entry, so a different window or scope can't read another's
   * value. The feed is rebuilt hourly by dbt, so a 30-minute TTL never serves data a full rebuild stale.
   */
  private cached<T>(req: Request, foundationSlug: string, resource: string, binds: QueryBind[], fetcher: () => Promise<T>): Promise<T> {
    logger.debug(req, 'social_listening_cached_query', 'Resolving cached Social Listening query', {
      foundation_slug: foundationSlug,
      resource,
    });

    return withSocialListeningCache(foundationSlug, resource, binds, VALKEY_CACHE.SOCIAL_LISTENING_TTL_SECONDS, fetcher);
  }

  private capValues(values: string[] | undefined, cap: number): string[] {
    if (!values) {
      return [];
    }

    const normalized = values.map((value) => value.trim()).filter(Boolean);
    if (normalized.length > cap) {
      logger.warning(undefined, 'social_listening_filter_cap', 'Truncated over-long filter value list', {
        received: normalized.length,
        cap,
      });
    }

    return normalized.slice(0, cap);
  }

  private placeholders(count: number): string {
    return Array(count).fill('?').join(', ');
  }
}
