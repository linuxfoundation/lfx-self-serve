// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The controller imports the `@lfx-one/shared/utils` barrel, which pulls @angular/forms; the JIT
// compiler must be present in this plain-Node runtime.
import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/newsletter-invite.service', () => ({ NewsletterInviteService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { NewsletterInviteController } from './newsletter-invite.controller';

const FOUNDATION_UID = '8d1c3a52-6b8e-4c1a-9f3e-2b7d5e4a1c90';

describe('NewsletterInviteController.sendInvite', () => {
  const sendInvite = vi.fn();
  let res: Response & { locals: Record<string, unknown> };
  let next: NextFunction;
  const controller = new NewsletterInviteController({ sendInvite } as never);
  const req = (foundationUid = FOUNDATION_UID) => ({ params: { foundationUid }, body: { email: 'pat@acme-motors.example' }, path: '/x' }) as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    res = { locals: {}, status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response & { locals: Record<string, unknown> };
    next = vi.fn();
  });

  it('answers 201 with the result', async () => {
    sendInvite.mockResolvedValue({ email: 'pat@acme-motors.example', foundation_name: 'Acme Foundation' });

    await controller.sendInvite(req(), res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed foundation uid without calling the service or spending the budget', async () => {
    await controller.sendInvite(req('not-a-uuid'), res, next);

    expect(sendInvite).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(res.locals['newsletterInviteCounted']).toBeUndefined();
  });

  it('lets typos and personal mailboxes through the budget for free', async () => {
    sendInvite.mockRejectedValueOnce(ServiceValidationError.forField('email', 'Enter a valid email address'));
    await controller.sendInvite(req(), res, next);
    sendInvite.mockRejectedValueOnce(new ServiceValidationError([{ field: 'email', message: 'x', code: 'NEWSLETTER_INVITE_PERSONAL_EMAIL' }]));
    await controller.sendInvite(req(), res, next);

    expect(res.locals['newsletterInviteCounted']).toBeUndefined();
  });

  it('charges a non-member domain and other refusals to the budget', async () => {
    sendInvite.mockRejectedValueOnce(new ServiceValidationError([{ field: 'email', message: 'x', code: 'NEWSLETTER_INVITE_NOT_MEMBER_COMPANY' }]));
    await controller.sendInvite(req(), res, next);
    expect(res.locals['newsletterInviteCounted']).toBe(true);

    res.locals = {};
    sendInvite.mockRejectedValueOnce(new AuthorizationError('no'));
    await controller.sendInvite(req(), res, next);
    expect(res.locals['newsletterInviteCounted']).toBe(true);
  });
});
