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
 * local dev with no `VALKEY_URL` configured, or the nonce fails the key-safety check before any
 * write is attempted. A configured Valkey write whose outcome is uncertain does NOT fall back —
 * see `issue()`'s dual-write-hazard comment — so Flow C can fail closed (`invalid_state`) instead
 * of risking a replayable duplicate nonce.
 */
export class AuthStateService {
  /**
   * Issues a new CSRF state nonce for Flow C, storing it in Valkey (or session, as a fallback).
   * @param req Express request (used for the session fallback and logging correlation).
   * @param sub Auth0 subject the nonce is bound to; `consume()` rejects a mismatched sub.
   * @param returnTo Optional path to redirect to after the callback succeeds.
   * @returns The generated nonce, to embed as the OAuth `state` parameter.
   */
  public async issue(req: Request, sub: string, returnTo?: string): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    const record: AuthStateRecord = { sub, returnTo, createdAt: Date.now() };

    if (valkeyService.isEnabled()) {
      const key = buildAuthStateCacheKey(state);
      if (key !== null) {
        const persisted = await valkeyService.setJson(key, record, VALKEY_CACHE.AUTH_STATE_TTL_SECONDS, VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS);
        // Clear any stale session-stored nonce from a prior outage so at most one store ever holds
        // an outstanding nonce — otherwise a nonce abandoned mid-flow while Valkey was down keeps
        // working indefinitely once Valkey recovers, since the session copy has no TTL (#1938).
        delete req.appSession?.['profileAuthState'];
        if (req.appSession) {
          delete req.appSession['profileAuthReturnTo'];
        }
        if (persisted) {
          logger.debug(req, 'auth_state_issue', 'Auth-state nonce issued', { store: 'valkey' });
          return state;
        }
        // `setJson` returning false does not prove the SET never landed — a client-side timeout races
        // the real write, which can still complete afterward. Also writing the nonce to the session
        // here would risk a duplicate: a later Valkey read for this nonce, if it faulted, could accept
        // the stale session copy as if it were fresh, even though the Valkey copy — if it did land —
        // was already consumed once, breaking single-use. Fail closed instead: return the nonce
        // without a session fallback, so an actually-failed write surfaces as a clean `invalid_state`
        // (consume() treats both a Valkey miss and a Valkey fault as authoritative, never falling
        // back to session for a nonce that may have been issued via Valkey) rather than a silent
        // dual-write hazard (#1938, #2604 review).
        logger.warning(req, 'auth_state_issue', 'Auth-state write outcome unknown — issuing via Valkey only, no session fallback (dual-write hazard)');
        return state;
      }
      // The nonce is exactly 64 hex chars, at isFilterSafeIdentifier's length ceiling — this branch
      // should be unreachable in practice. Unlike a write failure above, the key check runs before any
      // Valkey call, so the outcome is certain (nothing was written) and the session fallback is safe.
      logger.warning(req, 'auth_state_issue', 'Auth-state key rejected as unsafe — falling back to session-stored state (exposed to #1938 race)');
    }

    this.issueToSession(req, state, returnTo);
    logger.debug(req, 'auth_state_issue', 'Auth-state nonce issued', { store: 'session' });
    return state;
  }

  /**
   * Consumes (single-use) the nonce issued by `issue()`, returning its record or `null` if the
   * nonce is missing, expired, already consumed, or the read faulted (fails closed, never falls
   * back to session on an uncertain Valkey outcome).
   * @param req Express request (used for the session fallback and logging correlation).
   * @param state The nonce to consume, typically from the callback's `?state=` query param.
   * @returns The stored record, or `null` if the nonce could not be validated.
   */
  public async consume(req: Request, state: string | undefined): Promise<AuthStateRecord | null> {
    if (!state) {
      return null;
    }

    if (valkeyService.isEnabled()) {
      const key = buildAuthStateCacheKey(state);
      if (key !== null) {
        // Atomic GETDEL, not a get-then-del pair — the record must not be readable by a second
        // concurrent consumer between the two, or "single-use" is only a comment (#1938 review).
        const result = await valkeyService.getdelJson<AuthStateRecord>(key, AuthStateService.isAuthStateRecord, VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS);
        logger.debug(req, 'auth_state_consume', 'Auth-state nonce consumed', { store: 'valkey', result: result.status });
        if (result.status === 'hit') {
          return result.value;
        }
        if (result.status === 'miss') {
          // A clean miss (expired, already consumed, or never existed) is authoritative — falling
          // back to the session here would let a replayed or expired nonce succeed via a store with
          // no TTL, defeating the whole point of Valkey's expiry/single-use enforcement.
          return null;
        }
        // GETDEL is destructive: `withTimeout` abandons the in-flight command rather than cancelling
        // it, so a `fault` can mean the delete actually landed server-side after the client gave up —
        // the record's true state is unknown, not merely "not found". Treat it the same as `miss`
        // (fail closed) instead of falling back to session, matching issue()'s dual-write-hazard
        // stance: an uncertain outcome on this store must not risk bypassing single-use (#2604 review).
        logger.warning(req, 'auth_state_consume', 'Auth-state read faulted — treating as invalid, no session fallback (dual-write hazard)');
        return null;
      }
      // Unlike issue()'s symmetric branch, `state` here comes straight off the caller-controlled
      // `?state=` query param — any malformed value takes this path, not just a real degradation.
      // debug, not warning, so garbage input can't be used to flood on-call-visible logs.
      logger.debug(req, 'auth_state_consume', 'Auth-state nonce failed the key-safety check — treating as no stored state');
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

    // Check before deleting: a wrong or forged `?state=` must not consume a still-valid pending
    // nonce out from under the real callback that's still in flight (#1938 review).
    if (!storedState || storedState !== state) {
      return null;
    }

    delete req.appSession?.['profileAuthState'];
    if (req.appSession) {
      delete req.appSession['profileAuthReturnTo'];
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
