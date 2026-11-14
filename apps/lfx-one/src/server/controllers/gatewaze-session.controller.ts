// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isSameSite, SESSION_EXPIRED, SESSION_HEADER } from '@gatewaze/host-session';
import { NextFunction, Request, Response } from 'express';

import { gatewazeHostSessionNotFound } from '../middleware/require-gatewaze-host-session.middleware';
import { getGatewazeRealtimeService } from '../services/gatewaze-realtime.service';
import { getGatewazeSessionService, resolveGatewazeHostSessionConfig } from '../services/gatewaze-session.service';
import { logger } from '../services/logger.service';

/**
 * The embed's session endpoints in host-session mode. The embed's `hostSession` shim calls `me` to
 * learn who is signed in and `logout` for its sign-out button. The status codes are the contract the
 * shim reads, so each outcome maps to exactly one answer; see the `/session/me` table in
 * `docs/architecture/backend/gw-host-session.md`. `Cache-Control: no-store` is set by the router.
 */
export class GatewazeSessionController {
  /** `GET /api/gatewaze/session/me` */
  public async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_gatewaze_session_me';
    const startTime = logger.startOperation(req, operation);
    try {
      const result = await getGatewazeSessionService().getGatewazeMe(req);
      if (result.outcome === 'ok') {
        logger.success(req, operation, startTime, { status_code: 200 });
        // `admin` only when the service produced it; the embed reads the profile itself otherwise.
        res.json(result.admin ? { user: result.user, admin: result.admin } : { user: result.user });
        return;
      }
      if (result.outcome === 'host_session_unavailable') {
        // No store-backed appSession id on this request: the same uniform 404 as the flag-off gate.
        next(gatewazeHostSessionNotFound(req));
        return;
      }
      // Answered here rather than through next(error): these are contract answers the shim reads,
      // not failures. Where one is a fault (refused, unavailable), the service already logged its
      // cause at ERROR or WARN, so this only closes the operation.
      logger.debug(req, operation, 'Answered the session check without a user', { outcome: result.outcome });
      switch (result.outcome) {
        case 'not_admin':
          res.status(403).json({ error: 'not_admin', email: result.email });
          return;
        case 'admin_check_pending':
          res.setHeader('Retry-After', String(result.retryAfterSeconds));
          res.status(503).json({ error: 'admin_check_pending' });
          return;
        case 'ended':
          // The only answer that tells the shim the session is gone. Never sent for a fault, or the
          // embed would reload into the same fault.
          res.setHeader(SESSION_HEADER, SESSION_EXPIRED);
          res.status(401).json({ error: 'not_signed_in' });
          return;
        default:
          // `refused` (a GoTrue provider config fault) and `unavailable` (Valkey, Auth0 or GoTrue).
          res.status(503).json({ error: 'session_unavailable' });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/gatewaze/session/logout`: revokes the Gatewaze session at GoTrue and deletes it. The
   * LFX session is not touched, so the embed is signed out of Gatewaze only, and its next session
   * check mints a new one. Answers 204 even when GoTrue or Valkey failed; the service logs those, and
   * the record ages out on its TTL.
   */
  public async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'gatewaze_session_logout';
    const startTime = logger.startOperation(req, operation);
    try {
      if (!this.isSameSiteRequest(req)) {
        // DEBUG, not WARN: any cross-site page can trigger this, so it must not flood the logs.
        logger.debug(req, operation, 'Refusing a cross-site Gatewaze sign-out', { has_origin: !!req.get('origin') });
        res.status(403).json({ error: 'cross_site' });
        return;
      }
      // No sign-out marker: the LFX session is still live, so the next /session/me mints again.
      const result = await getGatewazeSessionService().endGatewazeSession(req, { blockReMint: false });
      logger.success(req, operation, startTime, { status_code: 204, ...result });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/gatewaze/supabase/realtime/v1/websocket`: hands a WebSocket upgrade that passed every gate
   * to the Realtime service, which answers it on the socket. Nothing is written to `res` then, so there
   * is no `startOperation` here; the service logs the upgrade. A plain GET with no upgrade behind it
   * gets the uniform 404.
   */
  public async realtime(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!(await getGatewazeRealtimeService().handleRoute(req))) {
        next(gatewazeHostSessionNotFound(req));
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * The package's CSRF rule for a session write: the Origin, when sent, is LFX's own origin, and the
   * `apikey` header carries the anon key. A cross-site form cannot set `apikey`, and a cross-site
   * fetch that sets it needs a CORS preflight this app never grants. Fails closed when
   * `PCC_BASE_URL` or the host-session config is missing.
   */
  private isSameSiteRequest(req: Request): boolean {
    const config = resolveGatewazeHostSessionConfig();
    if (!config) {
      return false;
    }
    let siteOrigin: string;
    try {
      siteOrigin = new URL(process.env['PCC_BASE_URL'] || '').origin;
    } catch {
      return false;
    }
    return isSameSite(req.get('origin'), req.get('apikey'), siteOrigin, config.anonKey);
  }
}
