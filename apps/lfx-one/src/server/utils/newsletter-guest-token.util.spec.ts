// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_INVITE_TOKEN_TTL_MS } from '@lfx-one/shared/constants';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import {
  createNewsletterGuestSessionValue,
  createNewsletterInviteToken,
  readCookie,
  readNewsletterGuestSessionValue,
  readNewsletterInviteToken,
} from './newsletter-guest-token.util';

describe('newsletter guest tokens', () => {
  const now = Date.UTC(2026, 10, 5);

  it('round-trips an invite token until it expires', () => {
    const token = createNewsletterInviteToken('c-news', 'jane@acme.example', now);

    expect(readNewsletterInviteToken(token, now + 1000)).toEqual({
      status: 'valid',
      payload: { c: 'c-news', e: 'jane@acme.example', exp: now + NEWSLETTER_INVITE_TOKEN_TTL_MS },
    });
    expect(readNewsletterInviteToken(token, now + NEWSLETTER_INVITE_TOKEN_TTL_MS)).toEqual({ status: 'expired' });
  });

  it('rejects a tampered payload, a forged signature, and junk', () => {
    const token = createNewsletterInviteToken('c-news', 'jane@acme.example', now);
    const [body, signature] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ c: 'c-news', e: 'mallory@acme.example', exp: now + 1e12 })).toString('base64url');

    expect(readNewsletterInviteToken(`${forgedBody}.${signature}`, now)).toEqual({ status: 'invalid' });
    expect(readNewsletterInviteToken(`${body}.AAAA`, now)).toEqual({ status: 'invalid' });
    expect(readNewsletterInviteToken('not-a-token', now)).toEqual({ status: 'invalid' });
    expect(readNewsletterInviteToken('', now)).toEqual({ status: 'invalid' });
    expect(readNewsletterInviteToken(`${'a'.repeat(2000)}.b`, now)).toEqual({ status: 'invalid' });
  });

  it('never accepts a guest cookie as an invite token, or the reverse', () => {
    const cookie = createNewsletterGuestSessionValue({ e: 'jane@acme.example', c: 'c-news', f: 'f-1', v: true });
    const token = createNewsletterInviteToken('c-news', 'jane@acme.example', now);

    expect(readNewsletterInviteToken(cookie, now)).toEqual({ status: 'invalid' });
    expect(readNewsletterGuestSessionValue(token)).toBeNull();
  });

  it('round-trips a guest session and rejects a tampered one', () => {
    const session = { e: 'jane@acme.example', c: 'c-news', f: 'f-1', v: false };
    const value = createNewsletterGuestSessionValue(session);
    const forged = `${Buffer.from(JSON.stringify({ ...session, v: true })).toString('base64url')}.${value.split('.')[1]}`;

    expect(readNewsletterGuestSessionValue(value)).toEqual(session);
    expect(readNewsletterGuestSessionValue(forged)).toBeNull();
    expect(readNewsletterGuestSessionValue(undefined)).toBeNull();
  });

  it('reads one cookie from a Cookie header', () => {
    expect(readCookie('a=1; lfx_newsletter_guest=x%2Ey; b=2', 'lfx_newsletter_guest')).toBe('x.y');
    expect(readCookie('a=1', 'lfx_newsletter_guest')).toBeNull();
    expect(readCookie(undefined, 'lfx_newsletter_guest')).toBeNull();
    expect(readCookie('lfx_newsletter_guest=%E0%A4%A', 'lfx_newsletter_guest')).toBeNull();
  });
});
