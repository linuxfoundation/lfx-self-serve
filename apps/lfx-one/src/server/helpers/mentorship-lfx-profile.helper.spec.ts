// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MENTORSHIP_LFX_PROFILE_EMAIL_MAX } from '@lfx-one/shared/constants';
import type { EmailManagementData } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { EmailVerificationService } from '../services/email-verification.service';
import { buildMentorshipUpstreamLfxProfileFields, readMentorshipLfxProfileFields, resolveMentorshipPrimaryEmail } from './mentorship-lfx-profile.helper';

const VALID_FIELDS = { firstName: 'Test', lastName: 'User', logoUrl: 'https://example.com/avatar.png' };

function buildReq(sub: string | null = 'auth0|test-user-1'): Request {
  return { impersonationActive: false, oidc: { user: sub ? { sub } : undefined } } as unknown as Request;
}

function emailServiceReturning(data: Partial<EmailManagementData> | null) {
  const getUserEmails = vi.fn().mockResolvedValue(data);
  return { service: { getUserEmails } as unknown as EmailVerificationService, getUserEmails };
}

describe('readMentorshipLfxProfileFields', () => {
  it('reads the three known keys, trimmed, and nothing else', () => {
    const { fields, errors } = readMentorshipLfxProfileFields({ ...VALID_FIELDS, firstName: '  Test ', phone: '555-0100', slug: 'test-slug' });

    expect(errors).toEqual({});
    expect(fields).toEqual(VALID_FIELDS);
  });

  it('ignores an email in the body, since the BFF resolves it', () => {
    expect(readMentorshipLfxProfileFields({ firstName: 'Test', email: 'someone.else@example.com' })).toEqual({ fields: { firstName: 'Test' }, errors: {} });
    expect(readMentorshipLfxProfileFields({ email: 42 })).toEqual({ fields: {}, errors: {} });
  });

  it('keeps only the keys that were sent', () => {
    expect(readMentorshipLfxProfileFields({ lastName: 'User' })).toEqual({ fields: { lastName: 'User' }, errors: {} });
    expect(readMentorshipLfxProfileFields({})).toEqual({ fields: {}, errors: {} });
  });

  it.each([null, 'text', 42, ['a']])('rejects the non-object value %j', (value) => {
    expect(readMentorshipLfxProfileFields(value).errors).toEqual({ body: 'The LFX profile must be a JSON object.' });
    expect(readMentorshipLfxProfileFields(value, 'lfxProfile').errors).toEqual({ lfxProfile: 'The LFX profile must be a JSON object.' });
  });

  it('reports a wrong type and a bad value by key, prefixed with the field when given', () => {
    const value = { firstName: 1, lastName: '', logoUrl: 'http://example.com/avatar.png' };

    expect(Object.keys(readMentorshipLfxProfileFields(value).errors).sort()).toEqual(['firstName', 'lastName', 'logoUrl']);
    expect(Object.keys(readMentorshipLfxProfileFields(value, 'lfxProfile').errors).sort()).toEqual([
      'lfxProfile.firstName',
      'lfxProfile.lastName',
      'lfxProfile.logoUrl',
    ]);
  });
});

describe('resolveMentorshipPrimaryEmail', () => {
  it("returns the caller's primary email, trimmed, looked up by their sub", async () => {
    const { service, getUserEmails } = emailServiceReturning({ primary_email: ' test.user@example.com ', alternate_emails: [] });
    const req = buildReq();

    await expect(resolveMentorshipPrimaryEmail(req, service)).resolves.toBe('test.user@example.com');
    expect(getUserEmails).toHaveBeenCalledWith(req, 'auth0|test-user-1');
  });

  it('returns nothing, without a lookup, when there is no signed-in user', async () => {
    const { service, getUserEmails } = emailServiceReturning({ primary_email: 'test.user@example.com' });

    await expect(resolveMentorshipPrimaryEmail(buildReq(null), service)).resolves.toBeUndefined();
    expect(getUserEmails).not.toHaveBeenCalled();
  });

  it.each([
    ['a failed lookup', null],
    ['no primary email', { primary_email: '' }],
    ['an address that is not email-shaped', { primary_email: 'not-an-email' }],
    ['an address past its cap', { primary_email: `${'a'.repeat(MENTORSHIP_LFX_PROFILE_EMAIL_MAX)}@example.com` }],
  ])('returns nothing for %s, so the column is left as it is', async (_label, data) => {
    const { service } = emailServiceReturning(data);

    await expect(resolveMentorshipPrimaryEmail(buildReq(), service)).resolves.toBeUndefined();
  });
});

describe('buildMentorshipUpstreamLfxProfileFields', () => {
  it('maps the fields to the upstream column names, with the resolved email', () => {
    expect(buildMentorshipUpstreamLfxProfileFields(VALID_FIELDS, 'test.user@example.com')).toEqual({
      first_name: 'Test',
      last_name: 'User',
      email: 'test.user@example.com',
      logo_url: 'https://example.com/avatar.png',
    });
  });

  it('leaves an absent field or email out, so its column is not touched', () => {
    expect(buildMentorshipUpstreamLfxProfileFields({ lastName: 'User' })).toEqual({ last_name: 'User' });
    expect(buildMentorshipUpstreamLfxProfileFields(undefined, 'test.user@example.com')).toEqual({ email: 'test.user@example.com' });
    expect(buildMentorshipUpstreamLfxProfileFields(undefined)).toEqual({});
  });
});
