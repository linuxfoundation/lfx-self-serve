// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  NEWSLETTER_GUEST_SESSION_PURPOSE,
  NEWSLETTER_GUEST_SESSION_TTL_MS,
  NEWSLETTER_GUEST_SIGNING_KEY_INFO,
  NEWSLETTER_GUEST_SIGNING_UNAVAILABLE_ERROR_CODE,
  NEWSLETTER_GUEST_TOKEN_MAX_LENGTH,
  NEWSLETTER_INVITE_TOKEN_PURPOSE,
  NEWSLETTER_INVITE_TOKEN_TTL_MS,
} from '@lfx-one/shared/constants';
import { NewsletterGuestSession, NewsletterInviteTokenCheck, NewsletterInviteTokenPayload } from '@lfx-one/shared/interfaces';
import { createHmac, hkdfSync } from 'node:crypto';

import { MicroserviceError } from '../errors';
import { constantTimeEquals } from './security.util';

// Stateless signed values for signed-out newsletter readers (#5235): the invite / confirmation link
// token and the guest session cookie. Each is `base64url(JSON payload).HMAC-SHA256(purpose.payload)`,
// so nothing is stored server-side and every SSR pod can verify. The key is derived from the app
// session secret (PCC_AUTH0_SECRET) with HKDF under its own info label — never the raw secret — and
// there is deliberately no fallback key: these values authorize an M2M group add, so a missing secret
// fails closed. The purpose prefix keeps a cookie from ever being replayed as a link token.

/** The HKDF-derived signing key; throws a 503 when PCC_AUTH0_SECRET is not configured. */
function signingKey(): Buffer {
  const secret = process.env['PCC_AUTH0_SECRET'];
  if (!secret) {
    throw new MicroserviceError('Newsletter guest signing secret is not configured', 503, NEWSLETTER_GUEST_SIGNING_UNAVAILABLE_ERROR_CODE, {
      operation: 'newsletter_guest_signing_key',
      service: 'newsletter_guest',
      clientMessage: 'Newsletter access is temporarily unavailable. Please try again later.',
    });
  }
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), NEWSLETTER_GUEST_SIGNING_KEY_INFO, 32));
}

function signature(purpose: string, body: string): string {
  return createHmac('sha256', signingKey()).update(`${purpose}.${body}`).digest('base64url');
}

function sign(purpose: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${signature(purpose, body)}`;
}

/** The payload of a value signed for `purpose`, or null when it is malformed or the signature does not match. */
function verify(purpose: string, value: string | null | undefined): Record<string, unknown> | null {
  if (!value || value.length > NEWSLETTER_GUEST_TOKEN_MAX_LENGTH) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot !== value.lastIndexOf('.')) return null;
  const body = value.slice(0, dot);
  if (!constantTimeEquals(value.slice(dot + 1), signature(purpose, body))) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A link token that lets the holder of `email`'s inbox read and join newsletter group `committeeUid`. */
export function createNewsletterInviteToken(committeeUid: string, email: string, now: number = Date.now()): string {
  const payload: NewsletterInviteTokenPayload = { c: committeeUid, e: email, exp: now + NEWSLETTER_INVITE_TOKEN_TTL_MS };
  return sign(NEWSLETTER_INVITE_TOKEN_PURPOSE, payload);
}

/** Verifies a link token: `invalid` for a malformed or tampered one, `expired` past its expiry. */
export function readNewsletterInviteToken(token: string | null | undefined, now: number = Date.now()): NewsletterInviteTokenCheck {
  const payload = verify(NEWSLETTER_INVITE_TOKEN_PURPOSE, token);
  if (!payload || !isNonEmptyString(payload['c']) || !isNonEmptyString(payload['e']) || typeof payload['exp'] !== 'number') {
    return { status: 'invalid' };
  }
  if (payload['exp'] <= now) return { status: 'expired' };
  return { status: 'valid', payload: { c: payload['c'], e: payload['e'], exp: payload['exp'] } };
}

/** The signed value of a guest session cookie, stamped to expire {@link NEWSLETTER_GUEST_SESSION_TTL_MS} from `now`. */
export function createNewsletterGuestSessionValue(session: Omit<NewsletterGuestSession, 'exp'>, now: number = Date.now()): string {
  const payload: NewsletterGuestSession = { ...session, exp: now + NEWSLETTER_GUEST_SESSION_TTL_MS };
  return sign(NEWSLETTER_GUEST_SESSION_PURPOSE, payload);
}

/** A guest session from its signed cookie value, or null when it is missing, forged, malformed or past its signed expiry. */
export function readNewsletterGuestSessionValue(value: string | null | undefined, now: number = Date.now()): NewsletterGuestSession | null {
  const payload = verify(NEWSLETTER_GUEST_SESSION_PURPOSE, value);
  if (
    !payload ||
    !isNonEmptyString(payload['e']) ||
    !isNonEmptyString(payload['c']) ||
    !isNonEmptyString(payload['f']) ||
    typeof payload['v'] !== 'boolean' ||
    typeof payload['exp'] !== 'number' ||
    payload['exp'] <= now
  ) {
    return null;
  }
  return { e: payload['e'], c: payload['c'], f: payload['f'], v: payload['v'], exp: payload['exp'] };
}

/** One cookie's raw value from a `Cookie` header (the first occurrence wins), or null. */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex !== -1 && pair.slice(0, eqIndex).trim() === name) {
      const raw = pair.slice(eqIndex + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}
