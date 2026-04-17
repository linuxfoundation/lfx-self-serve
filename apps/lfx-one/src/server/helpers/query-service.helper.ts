// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from '../services/logger.service';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 100;
/**
 * Checks if an error is a retryable server error (5xx).
 */
function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const statusCode = (error as any).statusCode ?? (error as any).status;
    return typeof statusCode === 'number' && statusCode >= 500;
  }
  return false;
}

/**
 * Executes a fetch callback with retry logic for 5xx errors.
 */
async function fetchWithRetry<T>(req: Request, fn: () => Promise<T>, context: Record<string, any>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isRetryableError(error) && attempt <= MAX_RETRIES) {
        const statusCode = (error as any).statusCode ?? (error as any).status;
        logger.warning(req, 'fetch_all_query_resources', `Retrying after ${statusCode} error (attempt ${attempt}/${MAX_RETRIES})`, {
          ...context,
          attempt,
          status_code: statusCode,
          retry_delay_ms: RETRY_DELAY_MS,
        });
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('fetchWithRetry: exhausted retries');
}

export interface FetchAllQueryResourcesOptions {
  /**
   * If true, throw when any page fetch fails instead of returning partial results.
   * Callers that rely on complete result sets for correctness (filtering, set
   * membership, counting) should set this to true and handle the thrown error.
   * Defaults to false — partial results are returned on later-page failures.
   */
  failOnPartial?: boolean;
}

/**
 * Fetches all pages from the query service by following page_token pagination.
 * Retries individual page fetches on 5xx errors before giving up.
 * Accepts a callback that performs the actual proxy request, keeping this helper
 * decoupled from any specific service or proxy implementation.
 *
 * By default, returns whatever pages were successfully fetched when a later page
 * fails (partial results). Pass `failOnPartial: true` when completeness is
 * required for correctness.
 *
 * @param req - Express request object for log correlation
 * @param fetchPage - Callback that fetches a single page given an optional page_token
 * @param options - Behavior options (see FetchAllQueryResourcesOptions)
 * @returns All resource data items accumulated across all pages
 *
 * @example
 * const registrants = await fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
 *   this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
 *     req, 'LFX_V2_SERVICE', '/query/resources', 'GET',
 *     { ...params, ...(pageToken && { page_token: pageToken }) }
 *   )
 * );
 */
export async function fetchAllQueryResources<T>(
  req: Request,
  fetchPage: (pageToken?: string) => Promise<QueryServiceResponse<T>>,
  options: FetchAllQueryResourcesOptions = {}
): Promise<T[]> {
  const { failOnPartial = false } = options;
  const results: T[] = [];

  let response = await fetchWithRetry(req, () => fetchPage(), { page: 1 });
  results.push(...response.resources.map((resource) => resource.data));

  let page = 1;
  while (response.page_token) {
    page++;
    logger.debug(req, 'fetch_all_query_resources', 'Fetching next page', {
      page,
      accumulated_count: results.length,
    });
    try {
      response = await fetchWithRetry(req, () => fetchPage(response.page_token), { page });
      results.push(...response.resources.map((resource) => resource.data));
    } catch (error) {
      if (failOnPartial) {
        logger.warning(req, 'fetch_all_query_resources', 'Pagination failed with failOnPartial=true, rethrowing', {
          page,
          accumulated_count: results.length,
          err: error,
        });
        throw error;
      }
      logger.warning(req, 'fetch_all_query_resources', 'Pagination failed, returning partial results', {
        page,
        accumulated_count: results.length,
        err: error,
      });
      break;
    }
  }

  if (page > 1) {
    logger.debug(req, 'fetch_all_query_resources', 'Pagination complete', {
      total_pages: page,
      total_results: results.length,
    });
  }

  return results;
}
