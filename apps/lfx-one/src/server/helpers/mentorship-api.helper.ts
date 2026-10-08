// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApiRequestOptions, MentorshipUpstreamListResponse, MentorshipUpstreamUser } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils/string.utils';
import { Request } from 'express';

import { MENTORSHIP_BOOTSTRAP_PATH, MENTORSHIP_LIST_MAX_PAGES, MENTORSHIP_LIST_PAGE_SIZE, MENTORSHIP_NOT_PROVISIONED_ERROR } from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { isImpersonating } from '../utils/auth-helper';

/**
 * An upstream failure's `path` is the full request URL, query included, and the error handler logs it. This rebuilds the error
 * with the query cut off, so a failed name check or mentor candidate search does not log the name or email it was asked about.
 */
export function withoutQueryInErrorPath(error: unknown): unknown {
  if (!(error instanceof MicroserviceError) || !error.path?.includes('?')) return error;
  return new MicroserviceError(error.message, error.statusCode, error.code, {
    operation: error.operation,
    service: error.service,
    path: error.path.slice(0, error.path.indexOf('?')),
    errorBody: error.errorBody,
    originalMessage: error.originalMessage,
    originalError: error.originalError,
    transportFailure: error.transportFailure,
    clientMessage: error.clientMessage,
  });
}

/** Whether an upstream failure is the mentorship service saying the caller has no local record yet. */
export function isMentorshipNotProvisionedError(error: unknown): boolean {
  return error instanceof MicroserviceError && error.statusCode === 401 && error.errorBody?.error === MENTORSHIP_NOT_PROVISIONED_ERROR;
}

/**
 * Calls the mentorship service with the caller's own token. A first-time user has no local
 * mentorship record, so upstream answers every authenticated route with a 401 until
 * `PUT /mentorship/v1/me` has run for them. On that one 401 this provisions the user and
 * retries the original request once; any other error, or a second failure, propagates.
 *
 * Retrying a write is safe: upstream rejects an unprovisioned caller in middleware, before
 * the handler runs, so the first attempt changed nothing. `PUT /me` is an upsert, so two
 * requests provisioning the same user at once is harmless.
 *
 * While impersonating, the token is the target's, so provisioning would write the target's
 * record from a read. Impersonation is read-only, so the 401 propagates instead.
 */
export async function proxyMentorshipRequest<T>(
  proxy: MicroserviceProxyService,
  req: Request,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  query?: Record<string, unknown>,
  data?: unknown,
  /** Logged in place of `path` when the path carries a credential. */
  logPath: string = path,
  /** Sent on the request and its retry, not on the `PUT /me` provisioning call; a raw upload sets its `Content-Type` here. */
  customHeaders?: Record<string, string>,
  /** Applied to the request and its retry, not to the provisioning call; a file upload sets a longer `timeoutMs` here. */
  options?: ApiRequestOptions
): Promise<T> {
  // Headers and options are passed only when set, so a call without them reaches the proxy with the same arguments it always had.
  const send = (): Promise<T> => {
    if (options) return proxy.proxyRequest<T>(req, 'LFX_V2_SERVICE', path, method, query, data, customHeaders, options);
    if (customHeaders) return proxy.proxyRequest<T>(req, 'LFX_V2_SERVICE', path, method, query, data, customHeaders);
    return proxy.proxyRequest<T>(req, 'LFX_V2_SERVICE', path, method, query, data);
  };

  try {
    return await send();
  } catch (error) {
    if (!isMentorshipNotProvisionedError(error) || isImpersonating(req)) {
      throw error;
    }
  }

  logger.info(req, 'mentorship_provision_user', 'Mentorship user not provisioned; bootstrapping and retrying', { path: logPath, method });
  // Upstream decodes a JSON body and rejects an empty one; it fills every field from the token.
  await proxy.proxyRequest<unknown>(req, 'LFX_V2_SERVICE', MENTORSHIP_BOOTSTRAP_PATH, 'PUT', undefined, {});
  return send();
}

/** The caller's local mentorship user id, read from `GET /me`. A missing or malformed id is a 502. */
export async function readMentorshipLocalUserId(proxy: MicroserviceProxyService, req: Request, operation: string): Promise<string> {
  const user = await proxyMentorshipRequest<MentorshipUpstreamUser>(proxy, req, MENTORSHIP_BOOTSTRAP_PATH);
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!isUuid(userId)) {
    throw new MicroserviceError('The mentorship service returned a user without a valid id', 502, 'MENTORSHIP_INVALID_USER', {
      operation,
      service: 'mentorship',
    });
  }
  return userId;
}

/**
 * Reads an upstream list to the end, at the largest page size unless the route takes a smaller one, stopping once the rows read reach
 * the reported total, a page comes back empty, or the page carries no usable total. A list still
 * going after `MENTORSHIP_LIST_MAX_PAGES` pages logs a warning and returns the rows read so far.
 */
export async function listAllMentorshipPages<T>(
  proxy: MicroserviceProxyService,
  req: Request,
  path: string,
  query: Record<string, unknown> = {},
  pageSize: number = MENTORSHIP_LIST_PAGE_SIZE
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; page < MENTORSHIP_LIST_MAX_PAGES; page++) {
    const { data, meta } = await proxyMentorshipRequest<MentorshipUpstreamListResponse<T>>(proxy, req, path, 'GET', {
      ...query,
      limit: pageSize,
      offset: items.length,
    });
    const rows = data ?? [];
    items.push(...rows);
    const total = meta?.total;
    if (rows.length === 0 || typeof total !== 'number' || !Number.isFinite(total) || items.length >= total) {
      return items;
    }
  }
  logger.warning(req, 'mentorship_list_all_pages', 'Upstream list exceeded the page cap, returning the rows read so far', {
    path,
    max_pages: MENTORSHIP_LIST_MAX_PAGES,
    count: items.length,
  });
  return items;
}
