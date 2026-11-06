// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_GUEST_TOKEN_MAX_LENGTH, NEWSLETTER_INVITE_TOKEN_TTL_MS } from '@lfx-one/shared/constants';
import { NewsletterGuestSession, NewsletterInviteTokenCheck, NewsletterInviteTokenPayload } from '@lfx-one/shared/interfaces';
import { createHmac } from 'node:crypto';

import { logger } from '../services/logger.service';
import { constantTimeEquals } from './security.util';

// Stateless signed values for signed-out newsletter readers (#5235): the invite / confirmation link
// token and the guest session cookie. Each is `base64url(JSON payload).HMAC-SHA256(purpose.payload)`,
// keyed with the app session secret (PCC_AUTH0_SECRET), so nothing is stored server-side and every SSR
// pod can verify. The purpose prefix keeps a cookie from ever being replayed as a link token.

const INVITE_PURPOSE = 'newsletter-invite';
const GUEST_SESSION_PURPOSE = 'newsletter-guest';

let warnedMissingSecret = false;

function signingSecret(): string {
  const secret = process.env['PCC_AUTH0_SECRET'];
  if (secret) return secret;
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    logger.warning(undefined, 'newsletter_guest_token_secret', 'PCC_AUTH0_SECRET is unset — newsletter guest links are signed with a public default key');
  }
  return 'sufficiently-long-string';
}

function signature(purpose: string, body: string): string {
  return createHmac('sha256', signingSecret()).update(`${purpose}.${body}`).digest('base64url');
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
  return sign(INVITE_PURPOSE, payload);
}

/** Verifies a link token: `invalid` for a malformed or tampered one, `expired` past its expiry. */
export function readNewsletterInviteToken(token: string | null | undefined, now: number = Date.now()): NewsletterInviteTokenCheck {
  const payload = verify(INVITE_PURPOSE, token);
  if (!payload || !isNonEmptyString(payload['c']) || !isNonEmptyString(payload['e']) || typeof payload['exp'] !== 'number') {
    return { status: 'invalid' };
  }
  if (payload['exp'] <= now) return { status: 'expired' };
  return { status: 'valid', payload: { c: payload['c'], e: payload['e'], exp: payload['exp'] } };
}

/** The signed value of a guest session cookie. */
export function createNewsletterGuestSessionValue(session: NewsletterGuestSession): string {
  return sign(GUEST_SESSION_PURPOSE, session);
}

/** A guest session from its signed cookie value, or null. */
export function readNewsletterGuestSessionValue(value: string | null | undefined): NewsletterGuestSession | null {
  const payload = verify(GUEST_SESSION_PURPOSE, value);
  if (!payload || !isNonEmptyString(payload['e']) || !isNonEmptyString(payload['c']) || !isNonEmptyString(payload['f']) || typeof payload['v'] !== 'boolean') {
    return null;
  }
  return { e: payload['e'], c: payload['c'], f: payload['f'], v: payload['v'] };
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
