// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_GUEST_SESSION_TTL_MS, NEWSLETTER_INVITE_TOKEN_TTL_MS } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MicroserviceError } from '../errors';
import {
  createNewsletterGuestSessionValue,
  createNewsletterInviteToken,
  readCookie,
  readNewsletterGuestSessionValue,
  readNewsletterInviteToken,
} from './newsletter-guest-token.util';

describe('newsletter guest tokens', () => {
  const now = Date.UTC(2026, 10, 5);
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedSecret = process.env['PCC_AUTH0_SECRET'];
    process.env['PCC_AUTH0_SECRET'] = 'test-session-secret';
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env['PCC_AUTH0_SECRET'];
    else process.env['PCC_AUTH0_SECRET'] = savedSecret;
  });

  it('fails closed with a 503 when the signing secret is not configured', () => {
    delete process.env['PCC_AUTH0_SECRET'];
    expect(() => createNewsletterInviteToken('c-news', 'jane@acme.example', now)).toThrow(MicroserviceError);
  });

  it('does not verify tokens signed under another secret', () => {
    const token = createNewsletterInviteToken('c-news', 'jane@acme.example', now);
    process.env['PCC_AUTH0_SECRET'] = 'rotated-secret';
    expect(readNewsletterInviteToken(token, now)).toEqual({ status: 'invalid' });
  });

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
    const cookie = createNewsletterGuestSessionValue({ e: 'jane@acme.example', c: 'c-news', f: 'f-1', v: true }, now);
    const token = createNewsletterInviteToken('c-news', 'jane@acme.example', now);

    expect(readNewsletterInviteToken(cookie, now)).toEqual({ status: 'invalid' });
    expect(readNewsletterGuestSessionValue(token, now)).toBeNull();
  });

  it('round-trips a guest session until its signed expiry, and rejects a tampered one', () => {
    const session = { e: 'jane@acme.example', c: 'c-news', f: 'f-1', v: false };
    const value = createNewsletterGuestSessionValue(session, now);
    const exp = now + NEWSLETTER_GUEST_SESSION_TTL_MS;
    const forged = `${Buffer.from(JSON.stringify({ ...session, v: true, exp })).toString('base64url')}.${value.split('.')[1]}`;

    expect(readNewsletterGuestSessionValue(value, now + 1000)).toEqual({ ...session, exp });
    expect(readNewsletterGuestSessionValue(value, exp)).toBeNull();
    expect(readNewsletterGuestSessionValue(forged, now)).toBeNull();
    expect(readNewsletterGuestSessionValue(undefined, now)).toBeNull();
  });

  it('reads one cookie from a Cookie header', () => {
    expect(readCookie('a=1; lfx_newsletter_guest=x%2Ey; b=2', 'lfx_newsletter_guest')).toBe('x.y');
    expect(readCookie('a=1', 'lfx_newsletter_guest')).toBeNull();
    expect(readCookie(undefined, 'lfx_newsletter_guest')).toBeNull();
    expect(readCookie('lfx_newsletter_guest=%E0%A4%A', 'lfx_newsletter_guest')).toBeNull();
  });
});
