// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_HOST_SESSION_LFX_LOGOUT_WAIT_MS } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { getGatewazeSessionService } from '../services/gatewaze-session.service';
import { logger } from '../services/logger.service';

/**
 * Ends the user's Gatewaze session when they log out of LFX: revokes it at GoTrue, then deletes the
 * record, which closes their Realtime sockets on every pod. The delete also sets the sign-out marker,
 * so a request still in flight on the old LFX session cannot mint a new Gatewaze session.
 * Registered on `/logout` before `auth(authConfig)`, because `express-openid-connect`'s built-in
 * `/logout` never calls `next()`. That also means `req.oidc` does not exist yet, so the session is
 * found from the `appSession` cookie alone.
 *
 * Logout must never fail because of Gatewaze. `endGatewazeSession` bounds each step and never throws,
 * this waits for it for at most `GW_HOST_SESSION_LFX_LOGOUT_WAIT_MS`, and `next()` runs whatever
 * happens. With host-session mode off it returns at once without touching Valkey.
 */
export async function endGatewazeSessionOnLogout(req: Request, _res: Response, next: NextFunction): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const ending = getGatewazeSessionService().endGatewazeSession(req, { blockReMint: true });
    const waited = new Promise<'timed_out'>((resolve) => {
      timer = setTimeout(() => resolve('timed_out'), GW_HOST_SESSION_LFX_LOGOUT_WAIT_MS);
      timer.unref();
    });
    const result = await Promise.race([ending, waited]);
    if (result === 'timed_out') {
      // The steps carry on in the background under their own bounds; the LFX logout does not wait.
      logger.warning(req, 'end_gatewaze_session', 'Ending the Gatewaze session is slow; continuing the LFX logout without it');
    } else if (result.found || result.deleted) {
      logger.debug(req, 'end_gatewaze_session', 'Ended the Gatewaze session on LFX logout', { ...result });
    }
  } catch (error) {
    logger.warning(req, 'end_gatewaze_session', 'Could not end the Gatewaze session on LFX logout', { err: error });
  } finally {
    clearTimeout(timer);
  }
  next();
}
