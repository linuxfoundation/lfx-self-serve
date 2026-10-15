// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors';
import { gwUniformNotFound } from '../helpers/gw-api.helper';
import { isGatewazeHostSessionEnabled } from '../services/gatewaze-session.service';
import { logger } from '../services/logger.service';

/** The uniform 404 for `/api/gatewaze` while host-session mode is off or the caller has no bearer token. */
export function gatewazeHostSessionNotFound(req: Request): MicroserviceError {
  return gwUniformNotFound(req, 'require_gatewaze_host_session');
}

/**
 * Answers every `/api/gatewaze` request with the uniform 404 unless host-session mode is on and fully
 * configured (`resolveGatewazeHostSessionConfig`: the flag, the embed flag, the session store and the
 * Supabase config). A 404 rather than a 403, so a prober cannot tell the route exists while it is off,
 * and the embed reads it as `unavailable`. Runs before `requireGwEmbedAccess`, which would otherwise
 * spend an FGA lookup on a route that is off.
 */
export function requireGatewazeHostSession(req: Request, _res: Response, next: NextFunction): void {
  if (isGatewazeHostSessionEnabled()) {
    next();
    return;
  }
  logger.debug(req, 'require_gatewaze_host_session', 'Answering the uniform 404: host-session mode is off or misconfigured', { path: req.path });
  next(gatewazeHostSessionNotFound(req));
}

/**
 * Answers the uniform 404 when the request carries no LFX bearer token, so the router's
 * authorization does not rest on `authMiddleware` alone. Under `/api` that middleware already
 * answers 401 to a caller with no token, so this never fires today; it keeps the router safe if the
 * mount or the route classification changes.
 */
export function requireGatewazeBearer(req: Request, _res: Response, next: NextFunction): void {
  if (req.bearerToken) {
    next();
    return;
  }
  logger.debug(req, 'require_gatewaze_bearer', 'Answering the uniform 404: no LFX bearer token on the request', { path: req.path });
  next(gatewazeHostSessionNotFound(req));
}
