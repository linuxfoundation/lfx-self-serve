// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { isEmailShape, isIdentityAlreadyLinkedError } from './identity.utils';

describe('isEmailShape', () => {
  it('accepts a well-formed address', () => {
    expect(isEmailShape('alice@example.com')).toBe(true);
  });

  it.each([['no-at'], ['missing@tld'], ['@example.com'], ['alice@'], ['']])('rejects %p', (value) => {
    expect(isEmailShape(value)).toBe(false);
  });
});

describe('isIdentityAlreadyLinkedError', () => {
  it('matches the email send-code phrasing', () => {
    expect(isIdentityAlreadyLinkedError('email already linked')).toBe(true);
  });

  it('matches the identity-link phrasing returned for social conflicts', () => {
    // Exact string returned by the auth-service USER_IDENTITY_LINK call — note it
    // contains no "already", which the previous substring check missed.
    expect(isIdentityAlreadyLinkedError('the provided identity token belongs to an existing LFID account and cannot be linked')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isIdentityAlreadyLinkedError('Belongs To An Existing LFID Account')).toBe(true);
  });

  it('checks every provided text and short-circuits on a match in message', () => {
    expect(isIdentityAlreadyLinkedError('some_error_code', 'This email is already linked to another account')).toBe(true);
  });

  it('does not match unrelated / transient failures', () => {
    expect(isIdentityAlreadyLinkedError('Service temporarily unavailable', 'Please try again later.')).toBe(false);
    expect(isIdentityAlreadyLinkedError('Internal server error')).toBe(false);
  });

  it('ignores nullish inputs', () => {
    expect(isIdentityAlreadyLinkedError(undefined, null, '')).toBe(false);
  });
});
