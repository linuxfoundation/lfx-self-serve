// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveEmail, getEffectiveSub, getEffectiveUsername } = vi.hoisted(() => ({
  getEffectiveEmail: vi.fn(),
  getEffectiveSub: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail, getEffectiveSub, getEffectiveUsername }));
vi.mock('../services/email-verification.service', () => ({ EmailVerificationService: class {} }));
vi.mock('../services/logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn() } }));

import type { Request } from 'express';

import type { EmailVerificationService } from '../services/email-verification.service';
import { resolveVerifiedUserEmails } from './user-emails.helper';

const req = {} as unknown as Request;

describe('resolveVerifiedUserEmails', () => {
  const getUserEmails = vi.fn();
  const svc = { getUserEmails } as unknown as EmailVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    getEffectiveEmail.mockReturnValue('jane@acme-motors.example');
    getEffectiveUsername.mockReturnValue('jdoe');
    getEffectiveSub.mockReturnValue('auth0|123');
  });

  it('returns the primary then verified alternates, lowercased and de-duplicated, keyed on the username', async () => {
    getUserEmails.mockResolvedValue({
      primary_email: 'Jane@Acme-Motors.example',
      alternate_emails: [
        { email: 'jane@acme-motors.example', verified: true },
        { email: 'Jane@Beta-Coastal.example', verified: true },
        { email: 'jane@unverified.example', verified: false },
      ],
    });

    await expect(resolveVerifiedUserEmails(req, svc)).resolves.toEqual(['jane@acme-motors.example', 'jane@beta-coastal.example']);
    expect(getUserEmails).toHaveBeenCalledWith(req, 'jdoe');
  });

  it('falls back to the sub only when there is no username', async () => {
    getEffectiveUsername.mockReturnValue(null);
    getUserEmails.mockResolvedValue({ primary_email: 'jane@acme-motors.example', alternate_emails: [] });

    await resolveVerifiedUserEmails(req, svc);

    expect(getUserEmails).toHaveBeenCalledWith(req, 'auth0|123');
  });

  it('omits the primary when the session email is not verified', async () => {
    getEffectiveEmail.mockReturnValue(null);
    getUserEmails.mockResolvedValue({ primary_email: 'jane@acme-motors.example', alternate_emails: [{ email: 'jane@beta-coastal.example', verified: true }] });

    await expect(resolveVerifiedUserEmails(req, svc)).resolves.toEqual(['jane@beta-coastal.example']);
  });

  it('falls back to the lowercased session email when auth-service is unavailable', async () => {
    getEffectiveEmail.mockReturnValue('Jane@Acme-Motors.EXAMPLE');
    getUserEmails.mockResolvedValue(null);

    await expect(resolveVerifiedUserEmails(req, svc)).resolves.toEqual(['jane@acme-motors.example']);
  });

  it('falls back when the lookup throws instead of returning null', async () => {
    getUserEmails.mockRejectedValue(new Error('codec unavailable'));

    await expect(resolveVerifiedUserEmails(req, svc)).resolves.toEqual(['jane@acme-motors.example']);
  });

  it('answers 503 when the lookup throws and strict', async () => {
    getUserEmails.mockRejectedValue(new Error('codec unavailable'));

    await expect(resolveVerifiedUserEmails(req, svc, { strict: true })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('throws 503 instead of falling back when strict', async () => {
    getUserEmails.mockResolvedValue(null);

    await expect(resolveVerifiedUserEmails(req, svc, { strict: true })).rejects.toMatchObject({ statusCode: 503, code: 'USER_EMAILS_UNAVAILABLE' });
  });
});
