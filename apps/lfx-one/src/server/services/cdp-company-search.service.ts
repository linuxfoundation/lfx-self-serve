// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CDP_COMPANY_ID_PATTERN,
  CDP_COMPANY_SEARCH_CACHE_TTL_SECONDS,
  CDP_COMPANY_SEARCH_DEADLINE_MS,
  CDP_COMPANY_SEARCH_MAX_LIST_AGE_MS,
  CDP_COMPANY_SEARCH_MAX_ROWS,
} from '@lfx-one/shared/constants';
import type { CdpCompanyItem, CdpCompanySearchCacheEntry, CdpCompanySearchResponse, CdpCompanySearchRow } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { toIsoTimestamp } from '../helpers/date-format.helper';
import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { buildCdpCompanySearchCacheKey, valkeyService } from './valkey.service';

const SEARCH_TABLE = 'CDP_COMPANY_SEARCH';

/**
 * Spec 062 DR-043 — CDP company search: one read of `CDP_COMPANY_SEARCH` per uncached term, behind the CDP audience
 * check (the route runs `requireCdpAudience` first, so nothing here is read or filled for an outsider).
 *
 * - Bounded by a 1-second deadline that does not count toward the shared circuit breaker (`expectTimeout`); every
 *   other error counts, and an open breaker fails the search fast.
 * - A missed deadline, an error, or a list built more than 48 hours ago answers no rows and `unavailable: true`,
 *   with a warning naming the reason (FR-023). B2B search is a separate request and is never affected.
 * - Rows are cached per normalized term for 15 minutes with the list's build time; the 48-hour limit is checked on
 *   every answer, cache hits included, so a cached entry is refused once its build passes 48 hours. An `unavailable`
 *   answer is never cached. With Valkey off every search reads the warehouse.
 */
export class CdpCompanySearchService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  public async search(req: Request, term: string): Promise<CdpCompanySearchResponse> {
    const normalized = normalizeTerm(term);
    const cacheKey = buildCdpCompanySearchCacheKey(normalized);

    const cached = await valkeyService.getJson<CdpCompanySearchCacheEntry>(cacheKey, isSearchCacheEntry);
    if (cached) {
      return this.answer(req, cached, 'cache');
    }

    let entry: CdpCompanySearchCacheEntry;
    try {
      entry = await this.read(normalized);
    } catch (error) {
      let reason = 'error';
      if (isDeadlineMiss(error)) reason = 'deadline';
      else if (SnowflakeService.isMissingObjectError(error, SEARCH_TABLE)) reason = 'missing_table';
      logger.warning(req, 'search_cdp_companies', 'CDP search unavailable', { reason, term_length: normalized.length, err: error });
      return { items: [], unavailable: true };
    }

    const answer = this.answer(req, entry, 'warehouse');
    if (!answer.unavailable) {
      await valkeyService.setJson(cacheKey, entry, CDP_COMPANY_SEARCH_CACHE_TTL_SECONDS);
    }
    return answer;
  }

  /** The list-age check every answer passes, cached or not: no build time, or one older than 48 hours, is refused. */
  private answer(req: Request, entry: CdpCompanySearchCacheEntry, source: 'cache' | 'warehouse'): CdpCompanySearchResponse {
    const builtAt = entry.builtAt ? Date.parse(entry.builtAt) : Number.NaN;
    if (Number.isNaN(builtAt)) {
      logger.warning(req, 'search_cdp_companies', 'CDP search unavailable', { reason: 'no_build_time', source });
      return { items: [], unavailable: true };
    }
    const ageMs = Date.now() - builtAt;
    if (ageMs > CDP_COMPANY_SEARCH_MAX_LIST_AGE_MS) {
      logger.warning(req, 'search_cdp_companies', 'CDP search unavailable', { reason: 'stale_list', source, list_age_hours: Math.floor(ageMs / 3_600_000) });
      return { items: [], unavailable: true };
    }
    return { items: entry.items };
  }

  /**
   * One statement: the list's build metadata — a single row from the whole table, so a term that matches nothing is
   * still age-checked and a fresh list with no match is told apart from an empty or stale one — left-joined to at
   * most 20 matches: names starting with the term first, then name, then id. No counts, domains, people or project
   * columns are selected for a company (FR-022). An empty table yields no build time and so answers unavailable.
   */
  private async read(normalized: string): Promise<CdpCompanySearchCacheEntry> {
    const table = `${resolveLfxOnePlatinumSchema()}.${SEARCH_TABLE}`;
    const escaped = escapeSqlLikePattern(normalized);
    const sql = `
      WITH list AS (
        SELECT MAX(built_at) AS list_built_at FROM ${table}
      ),
      matches AS (
        SELECT
          cdp_id,
          name,
          logo_url,
          CASE WHEN name ILIKE ? ESCAPE '!' THEN 0 ELSE 1 END AS prefix_rank
        FROM ${table}
        WHERE name ILIKE ? ESCAPE '!'
        ORDER BY prefix_rank, LOWER(name), cdp_id
        LIMIT ${CDP_COMPANY_SEARCH_MAX_ROWS}
      )
      SELECT list.list_built_at AS built_at, matches.cdp_id, matches.name, matches.logo_url
      FROM list
      LEFT JOIN matches ON TRUE
      ORDER BY matches.prefix_rank, LOWER(matches.name), matches.cdp_id
    `;

    const result = await this.snowflakeService.execute<CdpCompanySearchRow>(sql, [`${escaped}%`, `%${escaped}%`], {
      timeout: CDP_COMPANY_SEARCH_DEADLINE_MS,
      expectTimeout: true,
      expectMissingObject: SEARCH_TABLE,
    });

    // An ungrouped MAX always yields the one metadata row; on an empty table its BUILT_AT is NULL, so `builtAt` stays
    // null and the answer is unavailable — never a cached empty result.
    const builtAt = toIsoTimestamp(result.rows[0]?.BUILT_AT ?? null);
    const items: CdpCompanyItem[] = [];
    for (const row of result.rows) {
      const cdpId = row.CDP_ID?.trim().toLowerCase();
      const name = row.NAME?.trim();
      if (!cdpId || !CDP_COMPANY_ID_PATTERN.test(cdpId) || !name) continue;
      items.push({ cdpId, name, ...(row.LOGO_URL ? { logoUrl: row.LOGO_URL } : {}) });
    }
    return { items, builtAt };
  }
}

/** Case- and whitespace-insensitive: one cache entry per term however it was typed. */
function normalizeTerm(term: string): string {
  return term.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when the error is this query missing its own deadline (the service's timer), not any other failure. */
function isDeadlineMiss(error: unknown): boolean {
  return error instanceof Error && /query timed out after \d+ms/.test(error.message);
}

function isSearchCacheEntry(value: unknown): boolean {
  const entry = value as Partial<CdpCompanySearchCacheEntry> | null;
  return (
    !!entry &&
    Array.isArray(entry.items) &&
    (entry.builtAt === null || typeof entry.builtAt === 'string') &&
    entry.items.every((item) => !!item && typeof item.cdpId === 'string' && typeof item.name === 'string')
  );
}
