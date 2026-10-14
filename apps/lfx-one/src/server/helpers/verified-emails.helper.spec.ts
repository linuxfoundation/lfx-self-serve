// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveEmailMock, getEffectiveUsernameMock } = vi.hoisted(() => ({
  getEffectiveEmailMock: vi.fn(),
  getEffectiveUsernameMock: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: getEffectiveEmailMock, getEffectiveUsername: getEffectiveUsernameMock }));
vi.mock('../services/logger.service', () => ({ logger: { debug: vi.fn() } }));
vi.mock('../services/email-verification.service', () => ({ EmailVerificationService: class {} }));

import type { EmailVerificationService } from '../services/email-verification.service';
import { resolveVerifiedUserEmails } from './verified-emails.helper';

describe('resolveVerifiedUserEmails', () => {
  const req = {} as never;
  let getUserEmails: ReturnType<typeof vi.fn>;
  let service: EmailVerificationService;

  beforeEach(() => {
    getUserEmails = vi.fn();
    service = { getUserEmails } as unknown as EmailVerificationService;
    getEffectiveEmailMock.mockReturnValue('User@Example.com');
    getEffectiveUsernameMock.mockReturnValue('user');
  });

  it('gives the primary, then the verified alternates, lowercased and de-duplicated', async () => {
    getUserEmails.mockResolvedValue({
      primary_email: 'User@Example.com',
      alternate_emails: [
        { email: 'Work@Acme.example', verified: true },
        { email: 'user@example.com', verified: true },
        { email: 'old@unverified.example', verified: false },
      ],
    });

    await expect(resolveVerifiedUserEmails(req, service)).resolves.toEqual({
      emails: ['user@example.com', 'work@acme.example'],
      alternates: ['work@acme.example'],
    });
  });

  it('leaves the primary out when the session email is not verified', async () => {
    getEffectiveEmailMock.mockReturnValue(null);
    getUserEmails.mockResolvedValue({ primary_email: 'user@example.com', alternate_emails: [{ email: 'work@acme.example', verified: true }] });

    await expect(resolveVerifiedUserEmails(req, service)).resolves.toEqual({ emails: ['work@acme.example'], alternates: ['work@acme.example'] });
  });

  it('falls back to the session email when auth-service gives nothing', async () => {
    getUserEmails.mockResolvedValue(null);
    await expect(resolveVerifiedUserEmails(req, service)).resolves.toEqual({ emails: ['user@example.com'], alternates: [] });
  });

  it('looks a session with no LF username up by its verified email, and asks nothing with neither', async () => {
    getEffectiveUsernameMock.mockReturnValue(null);
    getUserEmails.mockResolvedValue({ primary_email: 'user@example.com', alternate_emails: [{ email: 'work@acme.example', verified: true }] });
    await expect(resolveVerifiedUserEmails(req, service)).resolves.toEqual({
      emails: ['user@example.com', 'work@acme.example'],
      alternates: ['work@acme.example'],
    });
    expect(getUserEmails).toHaveBeenCalledWith(req, 'User@Example.com');

    getEffectiveEmailMock.mockReturnValue(null);
    getUserEmails.mockClear();
    await expect(resolveVerifiedUserEmails(req, service)).resolves.toEqual({ emails: [], alternates: [] });
    expect(getUserEmails).not.toHaveBeenCalled();
  });
});
