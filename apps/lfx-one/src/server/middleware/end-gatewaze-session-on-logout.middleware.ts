// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { getGatewazeSessionService } from '../services/gatewaze-session.service';
import { logger } from '../services/logger.service';

/**
 * Ends the user's Gatewaze session when they log out of LFX: revokes it at GoTrue, then deletes the
 * record, which closes their Realtime sockets on every pod. The delete also sets the sign-out marker,
 * so a request still in flight on the old LFX session cannot mint a new Gatewaze session. Registered on `/logout` before
 * `auth(authConfig)`, because `express-openid-connect`'s built-in `/logout` never calls `next()`.
 * That also means `req.oidc` does not exist yet, so the session is found from the `appSession`
 * cookie alone.
 *
 * Logout must never fail because of Gatewaze. `endGatewazeSession` bounds each step and never throws,
 * and `next()` runs whatever happens. With host-session mode off it returns at once without touching
 * Valkey.
 */
export async function endGatewazeSessionOnLogout(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await getGatewazeSessionService().endGatewazeSession(req, { blockReMint: true });
    if (result.found || result.deleted) {
      logger.debug(req, 'end_gatewaze_session', 'Ended the Gatewaze session on LFX logout', { ...result });
    }
  } catch (error) {
    logger.warning(req, 'end_gatewaze_session', 'Could not end the Gatewaze session on LFX logout', { err: error });
  }
  next();
}
