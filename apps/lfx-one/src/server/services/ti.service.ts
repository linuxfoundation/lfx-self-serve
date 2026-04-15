// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { TiCacheEntry, TiContentItem, TiContentResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';

const TI_API_URL = 'https://linux.thoughtindustries.com/incoming/v2/content';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Service for fetching logo URLs from the Thought Industries (TI) API.
 *
 * TI serves full card images (wide banners with geometric frames) as LOGO_URL in Snowflake.
 * The `asset` field in the TI API response contains the clean logo URL without the frame.
 *
 * Uses singleton pattern and in-memory cache (30-day TTL) to minimize API calls.
 * Rate limit: ~250 requests per 15-minute window, shared with LF Education production flows.
 */
export class TiService {
  private static instance: TiService | null = null;

  private readonly apiKey: string;
  private readonly cache: Map<string, TiCacheEntry> = new Map();

  private constructor() {
    this.apiKey = process.env['TI_API_KEY'] || '';
  }

  /**
   * Get the singleton instance of TiService
   */
  public static getInstance(): TiService {
    if (!TiService.instance) {
      TiService.instance = new TiService();
    }
    return TiService.instance;
  }

  /**
   * Reset the singleton instance (primarily for testing)
   */
  public static resetInstance(): void {
    TiService.instance = null;
  }

  /**
   * Fetch logo asset URLs for the given course IDs from the TI API.
   *
   * Returns a Map<courseId, assetUrl>. On any error (including rate limits),
   * returns whatever is available from the cache — never throws.
   *
   * @param req - Express request for logging context
   * @param courseIds - Array of TI course UUIDs (_id field in TI API)
   */
  public async getLogoUrls(req: Request | undefined, courseIds: string[]): Promise<Map<string, string>> {
    if (courseIds.length === 0) {
      return new Map();
    }

    // Split into cached and uncached IDs
    const now = Date.now();
    const result = new Map<string, string>();
    const uncachedIds: string[] = [];

    for (const id of courseIds) {
      const cached = this.cache.get(id);
      if (cached && cached.expiresAt > now) {
        if (cached.url) {
          result.set(id, cached.url);
        }
        // null entry = confirmed TI miss, skip without re-fetching
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length === 0) {
      logger.debug(req, 'ti_cache_hit', 'All course logos served from cache', { count: courseIds.length });
      return result;
    }

    if (!this.apiKey) {
      logger.debug(req, 'ti_get_logos', 'TI_API_KEY not configured — skipping fetch, returning cached results only', {
        uncached_count: uncachedIds.length,
      });
      return result;
    }

    logger.debug(req, 'ti_get_logos', 'Fetching course logos from TI API', {
      total: courseIds.length,
      cached: courseIds.length - uncachedIds.length,
      uncached: uncachedIds.length,
    });

    try {
      const query = `(${uncachedIds.map((id) => `_id:${id}`).join(' OR ')})`;
      const url = `${TI_API_URL}?query=${encodeURIComponent(query)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 429) {
        const resetHeader = response.headers.get('x-ratelimit-reset');
        const resetTimestamp = resetHeader ? parseInt(resetHeader, 10) : NaN;
        const resetTime = Number.isFinite(resetTimestamp) ? new Date(resetTimestamp * 1000).toISOString() : 'unknown';
        logger.warning(req, 'ti_get_logos', 'TI API rate limit hit — returning cached results only', {
          uncached_count: uncachedIds.length,
          rate_limit_resets_at: resetTime,
        });
        // Return whatever we have from cache — already populated in result
        return result;
      }

      if (!response.ok) {
        logger.warning(req, 'ti_get_logos', 'TI API returned non-OK response — returning cached results only', {
          status: response.status,
          status_text: response.statusText,
          uncached_count: uncachedIds.length,
        });
        return result;
      }

      const data = (await response.json()) as TiContentResponse;
      const items = data.contentItems || [];
      const foundIds = new Set<string>();

      for (const item of items) {
        if (item.id && item.asset) {
          foundIds.add(item.id);
          this.cache.set(item.id, { url: item.asset, expiresAt: now + CACHE_TTL_MS });
          result.set(item.id, item.asset);
        }
      }

      // Cache negative results so unmatched IDs aren't re-fetched until TTL expires
      for (const id of uncachedIds) {
        if (!foundIds.has(id)) {
          this.cache.set(id, { url: null, expiresAt: now + CACHE_TTL_MS });
        }
      }

      logger.debug(req, 'ti_get_logos', 'Fetched course logos from TI API', {
        requested: uncachedIds.length,
        returned: items.length,
        total_result: result.size,
      });
    } catch (error) {
      logger.warning(req, 'ti_get_logos', 'Failed to fetch course logos from TI API — returning cached results only', {
        uncached_count: uncachedIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }
}

export const tiService = TiService.getInstance();
