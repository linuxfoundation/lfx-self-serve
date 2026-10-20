// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUserEmails, getMeetingInviteEmail, getEffectiveEmail, getEffectiveSub, isImpersonating, loggerWarning } = vi.hoisted(() => ({
  loggerWarning: vi.fn(),
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
vi.mock('./logger.service', () => ({ logger: { warning: loggerWarning } }));
vi.mock('../helpers/api-gateway.helper', () => ({ getUserServiceBaseUrl: () => 'https://gw.example/user-service/v1' }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail, getEffectiveSub, isImpersonating }));

import type { Request } from 'express';

import { collectAuthServiceVerifiedEmails, UserVerifiedEmailsService } from './user-verified-emails.service';

const PRIMARY = 'user@acme-motors.example';
const CONTACT_ID = '0032M00003abcdeQAA';
const fetchMock = vi.fn();
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
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ID: CONTACT_ID }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('puts the meeting-invite preference first, then the primary and verified alternates', async () => {
    const req = buildReq();

    await expect(service.getUserVerifiedEmails(req)).resolves.toEqual({
      emails: [ALIAS, PRIMARY, 'alt@example.org'],
      preferenceEmail: ALIAS,
      contactId: CONTACT_ID,
      incomplete: false,
    });
    expect(getUserEmails).toHaveBeenCalledWith(req, 'auth0|user123');
    expect(getMeetingInviteEmail).toHaveBeenCalledWith(req, 'v1-token');
  });

  it('returns nothing for an anonymous caller', async () => {
    getEffectiveSub.mockReturnValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({ emails: [], preferenceEmail: null, contactId: null, incomplete: false });
    expect(getUserEmails).not.toHaveBeenCalled();
    expect(getMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('drops the primary when the session email is unverified', async () => {
    getEffectiveEmail.mockReturnValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: [ALIAS, 'alt@example.org'],
      preferenceEmail: ALIAS,
      contactId: CONTACT_ID,
      incomplete: false,
    });
  });

  it("uses the impersonated user's emails but not the impersonator's preference", async () => {
    isImpersonating.mockReturnValue(true);
    getEffectiveSub.mockReturnValue('auth0|target');
    const req = buildReq();

    await expect(service.getUserVerifiedEmails(req)).resolves.toEqual({
      emails: [PRIMARY, 'alt@example.org'],
      preferenceEmail: null,
      contactId: null,
      incomplete: false,
    });
    expect(getUserEmails).toHaveBeenCalledWith(req, 'auth0|target');
    expect(getMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it('skips the preference and flags the lookup incomplete without a gateway token', async () => {
    await expect(service.getUserVerifiedEmails(buildReq(false))).resolves.toEqual({
      emails: [PRIMARY, 'alt@example.org'],
      preferenceEmail: null,
      contactId: null,
      incomplete: true,
    });
    expect(getMeetingInviteEmail).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a preference with no override as complete', async () => {
    getMeetingInviteEmail.mockResolvedValue({ email_id: null, email: null });

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: [PRIMARY, 'alt@example.org'],
      preferenceEmail: null,
      contactId: CONTACT_ID,
      incomplete: false,
    });
  });

  it('treats a failed preference lookup as best-effort', async () => {
    getMeetingInviteEmail.mockResolvedValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: [PRIMARY, 'alt@example.org'],
      preferenceEmail: null,
      contactId: CONTACT_ID,
      incomplete: false,
    });
  });

  it('flags a failed auth-service lookup but keeps the preference', async () => {
    getUserEmails.mockResolvedValue(null);

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: [ALIAS],
      preferenceEmail: ALIAS,
      contactId: CONTACT_ID,
      incomplete: true,
    });
    expect(loggerWarning).toHaveBeenCalledWith(expect.anything(), 'get_user_verified_emails', expect.any(String), { has_preference: true });
  });

  it('dedupes the preference against the auth-service emails', async () => {
    getMeetingInviteEmail.mockResolvedValue({ email_id: 'email-1', email: 'ALT@example.org' });

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toEqual({
      emails: ['alt@example.org', PRIMARY],
      preferenceEmail: 'alt@example.org',
      contactId: CONTACT_ID,
      incomplete: false,
    });
  });

  it('flags a failed contact-id lookup as incomplete', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 });

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toMatchObject({ contactId: null, incomplete: true });
    expect(loggerWarning).toHaveBeenCalledWith(expect.anything(), 'get_contact_id', expect.any(String), { status: 502 });
  });

  it('treats a profile with no ID as complete', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toMatchObject({ contactId: null, incomplete: false });
  });

  it('flags a thrown contact-id lookup as incomplete', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));

    await expect(service.getUserVerifiedEmails(buildReq())).resolves.toMatchObject({ contactId: null, incomplete: true });
  });

  describe('getContactIdForMatching', () => {
    it('treats a 404 from /me as a definite no-contact, not an incomplete lookup', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await service.getUserVerifiedEmails(buildReq());

      expect(result.contactId).toBeNull();
      expect(result.incomplete).toBe(false);
    });

    it('shares one /me call across callers on the same request', async () => {
      const req = buildReq();

      await expect(service.getContactIdForMatching(req)).resolves.toBe(CONTACT_ID);
      await expect(new UserVerifiedEmailsService().getContactIdForMatching(req)).resolves.toBe(CONTACT_ID);
      await service.getUserVerifiedEmails(req);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('looks up again for a different request', async () => {
      await service.getContactIdForMatching(buildReq());
      await service.getContactIdForMatching(buildReq());

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('is null without a gateway token, without calling /me', async () => {
      await expect(service.getContactIdForMatching(buildReq(false))).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is null while impersonating, so the impersonator id is never used', async () => {
      isImpersonating.mockReturnValue(true);

      await expect(service.getContactIdForMatching(buildReq())).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is null when /me fails or has no ID, never throwing', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 502 });
      await expect(service.getContactIdForMatching(buildReq())).resolves.toBeNull();

      fetchMock.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.getContactIdForMatching(buildReq())).resolves.toBeNull();

      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await expect(service.getContactIdForMatching(buildReq())).resolves.toBeNull();
    });
  });
});
