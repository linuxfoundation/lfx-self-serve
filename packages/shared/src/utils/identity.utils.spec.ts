// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { agreedUsername, composeFullName, formatUserLabel, isEmailShape, isIdentityAlreadyLinkedError } from './identity.utils';

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

describe('agreedUsername', () => {
  it('returns username for a single valid entry', () => {
    expect(agreedUsername(['alice'])).toBe('alice');
  });

  it('returns agreed username when all entries match', () => {
    expect(agreedUsername(['alice', 'alice', 'alice'])).toBe('alice');
  });

  it('matches case-insensitively and trims whitespace while preserving original casing', () => {
    expect(agreedUsername([' Alice ', 'alice', 'ALICE'])).toBe('Alice');
  });

  it('fails closed when any row lacks a username (disagreement, not abstention)', () => {
    expect(agreedUsername([null, 'bob'])).toBeNull();
    expect(agreedUsername(['bob', null])).toBeNull();
    expect(agreedUsername([undefined, 'bob'])).toBeNull();
    expect(agreedUsername(['bob', undefined])).toBeNull();
    expect(agreedUsername(['', 'bob'])).toBeNull();
    expect(agreedUsername(['   ', 'bob'])).toBeNull();
  });

  it('fails closed when rows have conflicting usernames', () => {
    expect(agreedUsername(['alice', 'bob'])).toBeNull();
  });

  it('fails closed for empty or all-nullish groups', () => {
    expect(agreedUsername([])).toBeNull();
    expect(agreedUsername([null])).toBeNull();
    expect(agreedUsername([undefined])).toBeNull();
    expect(agreedUsername([''])).toBeNull();
    expect(agreedUsername([null, undefined, '  '])).toBeNull();
  });
});

describe('composeFullName', () => {
  it('joins both parts with a single space', () => {
    expect(composeFullName('Ada', 'Lovelace')).toBe('Ada Lovelace');
  });

  it('drops a missing half rather than leaving a dangling space', () => {
    expect(composeFullName('Ada', null)).toBe('Ada');
    expect(composeFullName(undefined, 'Lovelace')).toBe('Lovelace');
  });

  it('collapses padding around each half, which directory records carry', () => {
    expect(composeFullName('Ada ', ' Lovelace')).toBe('Ada Lovelace');
  });

  it('treats a whitespace-only half as absent', () => {
    expect(composeFullName('   ', 'Lovelace')).toBe('Lovelace');
  });

  it('is empty when neither part is known', () => {
    expect(composeFullName(null, undefined)).toBe('');
  });
});

describe('formatUserLabel', () => {
  it('renders a committed assignee as Name (email)', () => {
    expect(formatUserLabel('Ada Lovelace', 'ada@example.com')).toBe('Ada Lovelace (ada@example.com)');
  });

  it('falls back to whichever half is known', () => {
    // A hand-typed address whose owner has not been resolved, and a name mid-selection.
    expect(formatUserLabel(null, 'ada@example.com')).toBe('ada@example.com');
    expect(formatUserLabel('Ada Lovelace', '')).toBe('Ada Lovelace');
  });

  it('treats a whitespace-only half as absent, so no empty parens are rendered', () => {
    expect(formatUserLabel('Ada Lovelace', '   ')).toBe('Ada Lovelace');
    expect(formatUserLabel('   ', '   ')).toBe('');
  });
});
