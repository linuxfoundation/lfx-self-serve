// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUserEmails, getMeetingInviteEmail, getEffectiveEmail, getEffectiveSub, isImpersonating } = vi.hoisted(() => ({
  getUserEmails: vi.fn(),
  getMeetingInviteEmail: vi.fn(),
  getEffectiveEmail: vi.fn(),
  getEffectiveSub: vi.fn(),
  isImpersonating: vi.fn(),
}));

vi.mock('./email-verification.service', () => ({
  EmailVerificationService: vi.fn(function () {
    return { getUserEmails };
  }),
}));
vi.mock('./meeting-preference.service', () => ({
  MeetingPreferenceService: vi.fn(function () {
    return { getMeetingInviteEmail };
  }),
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail, getEffectiveSub, isImpersonating }));

import type { Request } from 'express';

import { collectAuthServiceVerifiedEmails, UserVerifiedEmailsService } from './user-verified-emails.service';

const PRIMARY = 'user@acme-motors.example';
const ALIAS = 'user+meetings@example.com';

function buildReq(withGatewayToken = true): Request {
  return { apiGatewayToken: withGatewayToken ? 'v1-token' : undefined } as unknown as Request;
}

describe('collectAuthServiceVerifiedEmails', () => {
  it('keeps verified alternates, normalized and deduped, and the primary only when asked', () => {
    const emailData = {
      primary_email: PRIMARY,
      alternate_emails: [
        { email: ' User+Meetings@Example.com ', verified: true },
        { email: ALIAS, verified: true },
        { email: 'unverified@example.com', verified: false },
      ],
    };

    expect(collectAuthServiceVerifiedEmails(emailData as never, true)).toEqual([PRIMARY, ALIAS]);
    expect(collectAuthServiceVerifiedEmails(emailData as never, false)).toEqual([ALIAS]);
  });

  it('tolerates missing alternates', () => {
    expect(collectAuthServiceVerifiedEmails({ primary_email: PRIMARY } as never, true)).toEqual([PRIMARY]);
  });
});

describe('UserVerifiedEmailsService.getUserVerifiedEmails', () => {
  let service: UserVerifiedEmailsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserVerifiedEmailsService();
    getEffectiveSub.mockReturnValue('auth0|user123');
    getEffectiveEmail.mockReturnValue(PRIMARY);
    isImpersonating.mockReturnValue(false);
    getUserEmails.mockResolvedValue({ primary_email: PRIMARY, alternate_emails: [{ email: 'alt@example.org', verified: true }] });
    getMeetingInviteEmail.mockResolvedValue({ email_id: 'email-1', email: ALIAS });
  });

  it('puts the meeting-invite preference first, then the primary and verified alternates', async () => {
    const req = buildReq();

    await expect(service.getUserVerifiedEmails(req)).resolves.toEqual({
      emails: [ALIAS, PRIMARY, 'alt@example.org'],
      preferenceEmail: ALIAS,
      incomplete: false,
    });
    expect(getUserEmails).toHaveBeenCalledWith(req, 'auth0|user123');
    expect(getMeetingInviteEmail).toHaveBeenCalledWith(req, 'v1-token');
  });

  it('returns nothing for an anonymous caller', async () => {
    getEffectiveSub.mockReturnValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({ emails: [], preferenceEmail: null, incomplete: false });
    expect(getUserEmails).not.toHaveBeenCalled();
    expect(getMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('drops the primary when the session email is unverified', async () => {
    getEffectiveEmail.mockReturnValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({ emails: [ALIAS, 'alt@example.org'], preferenceEmail: ALIAS, incomplete: false });
  });

  it("uses the impersonated user's emails but not the impersonator's preference", async () => {
    isImpersonating.mockReturnValue(true);
    getEffectiveSub.mockReturnValue('auth0|target');
    const req = buildReq();

    await expect(service.getUserVerifiedEmails(req)).resolves.toEqual({ emails: [PRIMARY, 'alt@example.org'], preferenceEmail: null, incomplete: false });
    expect(getUserEmails).toHaveBeenCalledWith(req, 'auth0|target');
    expect(getMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('skips the preference without a gateway token', async () => {
    await expect(service.getUserVerifiedEmails(buildReq(false))).resolves.toEqual({
      emails: [PRIMARY, 'alt@example.org'],
      preferenceEmail: null,
      incomplete: false,
    });
    expect(getMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('treats a preference with no override as complete', async () => {
    getMeetingInviteEmail.mockResolvedValue({ email_id: null, email: null });

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: [PRIMARY, 'alt@example.org'],
      preferenceEmail: null,
      incomplete: false,
    });
  });

  it('treats a failed preference lookup as best-effort', async () => {
    getMeetingInviteEmail.mockResolvedValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: [PRIMARY, 'alt@example.org'],
      preferenceEmail: null,
      incomplete: false,
    });
  });

  it('flags a failed auth-service lookup but keeps the preference', async () => {
    getUserEmails.mockResolvedValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({ emails: [ALIAS], preferenceEmail: ALIAS, incomplete: true });
  });

  it('dedupes the preference against the auth-service emails', async () => {
    getMeetingInviteEmail.mockResolvedValue({ email_id: 'email-1', email: 'ALT@example.org' });

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: ['alt@example.org', PRIMARY],
      preferenceEmail: 'alt@example.org',
      incomplete: false,
    });
  });
});
