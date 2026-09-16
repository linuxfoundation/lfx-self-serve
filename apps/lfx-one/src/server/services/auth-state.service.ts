// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import { Request } from 'express';

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { AuthStateRecord } from '@lfx-one/shared/interfaces';

import { buildAuthStateCacheKey, valkeyService } from './valkey.service';
import { logger } from './logger.service';

/**
 * Issues and consumes Flow C's (profile Auth0 Management API) CSRF state nonce via a dedicated
 * short-TTL Valkey record, keyed by the nonce itself — see #1938. express-openid-connect reads the
 * whole session once at request start and blind-overwrites it on every response; a concurrent
 * request (e.g. `/profile/identities`'s page-load XHRs, still in flight when the browser navigates
 * to `/auth/start`) that finishes after the state write silently drops it, producing `invalid_state`
 * on the callback. Storing the nonce outside `req.appSession` removes it from that race entirely,
 * independent of whether `SESSION_STORE_ENABLED` is on (cookie-mode sessions have the identical
 * last-`Set-Cookie`-wins race, which this sidesteps rather than fixes).
 *
 * Falls back to `req.appSession` (today's behavior, and its race) only when Valkey is unavailable —
 * local dev with no `VALKEY_URL` configured, or a write failure — so Flow C keeps working rather
 * than breaking outright.
 */
export class AuthStateService {
  public async issue(req: Request, sub: string, returnTo?: string): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    const record: AuthStateRecord = { sub, returnTo, createdAt: Date.now() };

    if (valkeyService.isEnabled()) {
      const key = buildAuthStateCacheKey(state);
      if (key !== null) {
        const persisted = await valkeyService.setJson(key, record, VALKEY_CACHE.AUTH_STATE_TTL_SECONDS, VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS);
        if (persisted) {
          logger.debug(req, 'auth_state_issue', 'Auth-state nonce issued', { store: 'valkey' });
          return state;
        }
        logger.warning(req, 'auth_state_issue', 'Auth-state write failed — falling back to session-stored state (exposed to #1938 race)');
      } else {
        // The nonce is exactly 64 hex chars, at isFilterSafeIdentifier's length ceiling — this branch
        // should be unreachable in practice, but it's the same "exposed to #1938" condition as a write
        // failure, so it gets the same warning rather than degrading silently.
        logger.warning(req, 'auth_state_issue', 'Auth-state key rejected as unsafe — falling back to session-stored state (exposed to #1938 race)');
      }
    }

    this.issueToSession(req, state, returnTo);
    logger.debug(req, 'auth_state_issue', 'Auth-state nonce issued', { store: 'session' });
    return state;
  }

  public async consume(req: Request, state: string | undefined): Promise<AuthStateRecord | null> {
    if (!state) {
      return null;
    }

    if (valkeyService.isEnabled()) {
      const key = buildAuthStateCacheKey(state);
      if (key !== null) {
        // Atomic GETDEL, not a get-then-del pair — the record must not be readable by a second
        // concurrent consumer between the two, or "single-use" is only a comment (#1938 review).
        const record = await valkeyService.getdelJson<AuthStateRecord>(key, AuthStateService.isAuthStateRecord, VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS);
        logger.debug(req, 'auth_state_consume', 'Auth-state nonce consumed', { store: 'valkey', found: record !== null });
        if (record !== null) {
          return record;
        }
      } else {
        logger.warning(req, 'auth_state_consume', 'Auth-state key rejected as unsafe — falling back to session-stored state (exposed to #1938 race)');
      }
    }

    const sessionRecord = this.consumeFromSession(req, state);
    logger.debug(req, 'auth_state_consume', 'Auth-state nonce consumed', { store: 'session', found: sessionRecord !== null });
    return sessionRecord;
  }

  /** No-Valkey fallback write — mirrors the pre-#1938 behavior. */
  private issueToSession(req: Request, state: string, returnTo?: string): void {
    if (!req.appSession) {
      req.appSession = {};
    }
    req.appSession['profileAuthState'] = state;
    if (returnTo) {
      req.appSession['profileAuthReturnTo'] = returnTo;
    } else {
      delete req.appSession['profileAuthReturnTo'];
    }
  }

  /** No-Valkey fallback read — mirrors the pre-#1938 behavior; `sub` is unknown here so the caller's sub check always applies against the live oidc user instead. */
  private consumeFromSession(req: Request, state: string): AuthStateRecord | null {
    const storedState = req.appSession?.['profileAuthState'];
    const returnTo = req.appSession?.['profileAuthReturnTo'] as string | undefined;
    delete req.appSession?.['profileAuthState'];
    if (req.appSession) {
      delete req.appSession['profileAuthReturnTo'];
    }

    if (!storedState || storedState !== state) {
      return null;
    }

    const sub = req.oidc?.user?.['sub'] as string | undefined;
    return { sub: sub ?? '', returnTo, createdAt: Date.now() };
  }

  private static isAuthStateRecord(value: unknown): value is AuthStateRecord {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const { sub, returnTo, createdAt } = value as { sub?: unknown; returnTo?: unknown; createdAt?: unknown };
    return typeof sub === 'string' && (returnTo === undefined || typeof returnTo === 'string') && typeof createdAt === 'number';
  }
}

export const authStateService = new AuthStateService();
