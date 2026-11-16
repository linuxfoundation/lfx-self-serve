// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { ApiRequestOptions, MentorshipSyncClaim, MentorshipUpstreamListResponse, MentorshipUpstreamUser } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils/string.utils';
import { randomUUID } from 'crypto';
import { Request } from 'express';

import {
  MENTORSHIP_BOOTSTRAP_PATH,
  MENTORSHIP_LIST_MAX_PAGES,
  MENTORSHIP_LIST_PAGE_SIZE,
  MENTORSHIP_NOT_PROVISIONED_ERROR,
  MENTORSHIP_SESSION_LOGIN_ID_KEY,
  MENTORSHIP_USER_SYNC_DONE_TTL_SECONDS,
  MENTORSHIP_USER_SYNC_MEMORY_MAX_ENTRIES,
  MENTORSHIP_USER_SYNC_RETRY_MS,
} from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { buildMentorshipUserSyncKey, valkeyService } from '../services/valkey.service';
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

/** In-flight refreshes on this replica by login id, so the parallel mentorship requests of one page load share one `PUT /me`. */
const inFlightSyncs = new Map<string, Promise<void>>();

/**
 * This replica's refresh markers by login id: when each stops blocking a refresh (epoch ms). Checked before Valkey and written on
 * every outcome, so a login this replica has claimed, refreshed or found claimed costs no Valkey call until its marker expires.
 */
const replicaSyncMarkers = new Map<string, number>();

/**
 * Starts a new login for the mentorship refresh: `afterCallback` in `server.ts` returns the session with a fresh login id, so the
 * login's first mentorship request refreshes the record. It is never written afterwards, so a request that saves an older copy
 * of the session cannot undo it.
 */
export function withMentorshipLoginId<T extends object>(session: T): T & Record<typeof MENTORSHIP_SESSION_LOGIN_ID_KEY, string> {
  return { ...session, [MENTORSHIP_SESSION_LOGIN_ID_KEY]: randomUUID() };
}

/**
 * Refreshes the caller's mentorship record with `PUT /mentorship/v1/me` once per login: upstream then stores the caller's
 * current email, name and avatar. The marker is kept in Valkey and on this replica, keyed by the login id, so every replica
 * sees it and no session write can erase it. Runs only for a session with a login id (one signed in before this change gets one at its next login),
 * and never while impersonating, which is read-only. A failure is logged and never fails the request it runs for; the claim
 * then expires after `MENTORSHIP_USER_SYNC_RETRY_MS`, so a later request tries again without retrying on every request.
 */
async function syncMentorshipUserOncePerLogin(proxy: MicroserviceProxyService, req: Request): Promise<void> {
  const loginId: unknown = req.appSession?.[MENTORSHIP_SESSION_LOGIN_ID_KEY];
  if (typeof loginId !== 'string' || !loginId || isImpersonating(req)) return;

  let sync = inFlightSyncs.get(loginId);
  if (!sync) {
    sync = refreshMentorshipUser(proxy, req, loginId).finally(() => inFlightSyncs.delete(loginId));
    inFlightSyncs.set(loginId, sync);
  }
  await sync;
}

async function refreshMentorshipUser(proxy: MicroserviceProxyService, req: Request, loginId: string): Promise<void> {
  const claim = await claimMentorshipSync(loginId);
  if (!claim) return;
  try {
    // Upstream decodes a JSON body and rejects an empty one; it fills every field from the token.
    await proxy.proxyRequest<unknown>(req, 'LFX_V2_SERVICE', MENTORSHIP_BOOTSTRAP_PATH, 'PUT', undefined, {});
  } catch (error) {
    logger.warning(req, 'mentorship_session_sync', 'Mentorship user refresh failed; a later mentorship request retries it', {
      err: error,
      retry_after_ms: MENTORSHIP_USER_SYNC_RETRY_MS,
    });
    return;
  }
  await claim.complete();
}

/**
 * Claims the login's refresh, or returns null when it is already refreshed, being refreshed, or backing off after a failure.
 * This replica's marker is checked first. Otherwise the claim is an atomic `SET NX` in Valkey lasting
 * `MENTORSHIP_USER_SYNC_RETRY_MS`, shared by every replica; while Valkey is unavailable this replica's marker alone decides.
 * Whatever Valkey answers, this replica does not ask again for that long, so a slow or unreachable Valkey costs a login at
 * most one lock timeout per window, and a refresh done during an outage is not repeated once Valkey recovers.
 */
async function claimMentorshipSync(loginId: string): Promise<MentorshipSyncClaim | null> {
  const blockedUntil = replicaSyncMarkers.get(loginId);
  if (blockedUntil !== undefined && blockedUntil > Date.now()) return null;
  rememberReplicaSync(loginId, Date.now() + MENTORSHIP_USER_SYNC_RETRY_MS);

  const key = buildMentorshipUserSyncKey(loginId);
  const lock = key ? await valkeyService.acquireLock(key, MENTORSHIP_USER_SYNC_RETRY_MS) : null;
  if (lock?.status === 'contended') return null;
  return {
    complete: async () => {
      // Kept on this replica too, so a lost Valkey write cannot repeat the refresh here.
      rememberReplicaSync(loginId, Date.now() + MENTORSHIP_USER_SYNC_DONE_TTL_SECONDS * 1000);
      if (key && lock?.status === 'acquired') {
        await valkeyService.setJson(key, true, MENTORSHIP_USER_SYNC_DONE_TTL_SECONDS, VALKEY_CACHE.LOCK_OP_TIMEOUT_MS);
      }
    },
  };
}

function rememberReplicaSync(loginId: string, blockedUntil: number): void {
  // Re-inserted so the map stays in write order and the first key is the one to drop.
  replicaSyncMarkers.delete(loginId);
  replicaSyncMarkers.set(loginId, blockedUntil);
  if (replicaSyncMarkers.size > MENTORSHIP_USER_SYNC_MEMORY_MAX_ENTRIES) {
    const oldest = replicaSyncMarkers.keys().next().value;
    if (oldest !== undefined) replicaSyncMarkers.delete(oldest);
  }
}

/**
 * Calls the mentorship service with the caller's own token. Once per login it first refreshes the caller's record
 * (`syncMentorshipUserOncePerLogin`), which also provisions a first-time user. Without a local record, upstream answers
 * every authenticated route with a 401, so if that refresh did not run (no session, or it failed) or the record was removed
 * since, this provisions the user on that one 401 and retries the original request once; any other error, or a second
 * failure, propagates.
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

  await syncMentorshipUserOncePerLogin(proxy, req);

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
  return (await readMentorshipPages<T>(proxy, req, path, query, pageSize)).items;
}

/**
 * `listAllMentorshipPages`, also saying whether the read stopped at `MENTORSHIP_LIST_MAX_PAGES` with rows still to come,
 * for a caller that must tell its user the list is incomplete.
 */
export async function readMentorshipPages<T>(
  proxy: MicroserviceProxyService,
  req: Request,
  path: string,
  query: Record<string, unknown> = {},
  pageSize: number = MENTORSHIP_LIST_PAGE_SIZE
): Promise<{ items: T[]; truncated: boolean }> {
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
      return { items, truncated: false };
    }
  }
  logger.warning(req, 'mentorship_list_all_pages', 'Upstream list exceeded the page cap, returning the rows read so far', {
    path,
    max_pages: MENTORSHIP_LIST_MAX_PAGES,
    count: items.length,
  });
  return { items, truncated: true };
}
