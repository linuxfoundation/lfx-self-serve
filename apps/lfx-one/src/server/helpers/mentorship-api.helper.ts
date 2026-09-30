// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { MENTORSHIP_BOOTSTRAP_PATH, MENTORSHIP_NOT_PROVISIONED_ERROR } from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { isImpersonating } from '../utils/auth-helper';

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
  data?: unknown
): Promise<T> {
  try {
    return await proxy.proxyRequest<T>(req, 'LFX_V2_SERVICE', path, method, query, data);
  } catch (error) {
    if (!isMentorshipNotProvisionedError(error) || isImpersonating(req)) {
      throw error;
    }
  }

  logger.info(req, 'mentorship_provision_user', 'Mentorship user not provisioned; bootstrapping and retrying', { path, method });
  // Upstream decodes a JSON body and rejects an empty one; it fills every field from the token.
  await proxy.proxyRequest<unknown>(req, 'LFX_V2_SERVICE', MENTORSHIP_BOOTSTRAP_PATH, 'PUT', undefined, {});
  return proxy.proxyRequest<T>(req, 'LFX_V2_SERVICE', path, method, query, data);
}
