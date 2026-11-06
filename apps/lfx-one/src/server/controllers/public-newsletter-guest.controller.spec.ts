// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/newsletter-guest.service', () => ({ NewsletterGuestService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { NEWSLETTER_GUEST_COOKIE_NAME, NEWSLETTER_GUEST_COOKIE_PATH } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';

import type { NewsletterGuestService } from '../services/newsletter-guest.service';
import { createNewsletterGuestSessionValue, readNewsletterGuestSessionValue } from '../utils/newsletter-guest-token.util';
import { PublicNewsletterGuestController } from './public-newsletter-guest.controller';

const session = { e: 'jane@acme-motors.example', c: 'c-news', f: 'f-1', v: true };
const issue = {
  foundation: { uid: 'f-1', slug: 'acme', name: 'Acme', logo_url: null },
  masked_email: 'ja***@acme***.example',
  newsletter: null,
  confirmation_sent: false,
};

function makeRes() {
  const res = { cookie: vi.fn(), json: vi.fn(), set: vi.fn() };
  return res as typeof res & Response;
}

describe('PublicNewsletterGuestController', () => {
  process.env['PCC_AUTH0_SECRET'] = 'test-session-secret';
  let guestService: Record<string, ReturnType<typeof vi.fn>>;
  let controller: PublicNewsletterGuestController;
  const next = vi.fn() as unknown as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    guestService = {
      acceptInvite: vi.fn().mockResolvedValue({ issue, session }),
      requestSharedAccess: vi.fn().mockResolvedValue({ issue, session: { ...session, v: false } }),
      getLatestIssue: vi.fn().mockResolvedValue(issue),
      getSharedIssue: vi.fn().mockResolvedValue({ issue: null }),
    };
    controller = new PublicNewsletterGuestController(guestService as unknown as NewsletterGuestService);
  });

  it('sets a signed, httpOnly browser-session cookie on accept and answers with the issue', async () => {
    const res = makeRes();
    await controller.acceptInvite({ body: { token: 't' } } as Request, res, next);

    expect(guestService['acceptInvite']).toHaveBeenCalledWith(expect.anything(), 't');
    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe(NEWSLETTER_GUEST_COOKIE_NAME);
    expect(readNewsletterGuestSessionValue(value)).toMatchObject(session);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: NEWSLETTER_GUEST_COOKIE_PATH });
    expect(options).not.toHaveProperty('maxAge');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.json).toHaveBeenCalledWith(issue);
  });

  it('passes a non-string token through as empty', async () => {
    await controller.acceptInvite({ body: { token: 42 } } as unknown as Request, makeRes(), next);
    expect(guestService['acceptInvite']).toHaveBeenCalledWith(expect.anything(), '');
  });

  it('reads the latest issue through a valid cookie only', async () => {
    const res = makeRes();
    const cookie = `${NEWSLETTER_GUEST_COOKIE_NAME}=${encodeURIComponent(createNewsletterGuestSessionValue(session))}`;
    await controller.getLatestIssue({ headers: { cookie } } as Request, res, next);
    expect(guestService['getLatestIssue']).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(session));
    expect(res.json).toHaveBeenCalledWith({ issue });
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');

    const anonymous = makeRes();
    await controller.getLatestIssue({ headers: { cookie: `${NEWSLETTER_GUEST_COOKIE_NAME}=forged.value` } } as Request, anonymous, next);
    expect(guestService['getLatestIssue']).toHaveBeenCalledTimes(1);
    expect(anonymous.json).toHaveBeenCalledWith({ issue: null });
  });

  it('keeps a proven session proven when the same reader also continues on a shared link', async () => {
    const res = makeRes();
    const cookie = `${NEWSLETTER_GUEST_COOKIE_NAME}=${encodeURIComponent(createNewsletterGuestSessionValue(session))}`;
    guestService['requestSharedAccess'].mockResolvedValueOnce({ issue: { ...issue, confirmation_sent: true }, session: { ...session, v: false } });

    await controller.requestSharedAccess(
      { headers: { cookie }, params: { projectSlug: 'acme', newsletterUid: 'n-1' }, body: { email: session.e } } as unknown as Request,
      res,
      next
    );

    expect(readNewsletterGuestSessionValue(res.cookie.mock.calls[0][1])).toMatchObject({ v: true });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ confirmation_sent: false }));
  });

  it('forwards service errors to the error handler without setting a cookie', async () => {
    const error = new Error('boom');
    guestService['requestSharedAccess'].mockRejectedValueOnce(error);
    const res = makeRes();
    await controller.requestSharedAccess(
      { headers: {}, params: { projectSlug: 'acme', newsletterUid: 'n-1' }, body: { email: 'x' } } as unknown as Request,
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(error);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
