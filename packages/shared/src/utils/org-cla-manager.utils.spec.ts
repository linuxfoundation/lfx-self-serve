// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  classifyOrgClaManagerRefusal,
  hasOrgClaManagerAddErrors,
  isOrgClaManagerAddEmail,
  isOrgClaManagerLfUsername,
  validateOrgClaManagerAdd,
} from './org-cla-manager.utils';

describe('classifyOrgClaManagerRefusal', () => {
  describe.each([
    ['no-lf-login', 'user lookup failed: the user does not have an lf login account'],
    ['no-lf-login', 'No LF Login account exists for this email address'],
    ['last-manager', "Can't delete the only remaining CLA Manager for this CLA Group"],
    ['last-manager', 'a CLA Group must have at least one CLA Manager'],
    ['already-manager', 'user jdelacroix is already a CLA Manager for this project'],
    ['already-manager', 'manager already in signature ACL'],
    ['lf-username-required', 'User contributor@example.org needs to update account with username'],
    ['not-authorized', 'user aporter is not authorized for project a09410000182dD3AAI'],
    ['not-authorized', 'EasyCLA - 403 Forbidden - user does not have permission'],
    ['not-authorized', 'user aporter does not have access to DeleteCLAManager'],
  ] as const)('%s', (expected, sentence) => {
    it('classifies the JSON envelope', () => {
      expect(classifyOrgClaManagerRefusal(400, JSON.stringify({ Message: sentence }))).toBe(expected);
    });

    it('classifies the same sentence sent as plain text', () => {
      expect(classifyOrgClaManagerRefusal(400, sentence)).toBe(expected);
    });
  });

  it('reads the lower-cased `message` key as well as `Message`', () => {
    expect(classifyOrgClaManagerRefusal(400, JSON.stringify({ message: 'the user does not have an lf login' }))).toBe('no-lf-login');
  });

  it('prefers the sole-manager reading over the authority one when a sentence could be either', () => {
    expect(classifyOrgClaManagerRefusal(400, "Can't delete the only remaining CLA Manager; user is not a CLA Manager elsewhere")).toBe('last-manager');
  });

  it('takes 409 as a duplicate without consulting the body', () => {
    expect(classifyOrgClaManagerRefusal(409, undefined)).toBe('already-manager');
  });

  it('takes 403 as an authority refusal when the body has no more specific reading', () => {
    expect(classifyOrgClaManagerRefusal(403, '')).toBe('not-authorized');
  });

  it('does not treat a sanctions 403 as a missing-permission refusal', () => {
    expect(classifyOrgClaManagerRefusal(403, JSON.stringify({ error: 'company_sanctioned' }))).toBe('unknown');
  });

  it('reads a top-level company_sanctioned code before the free-form message', () => {
    expect(classifyOrgClaManagerRefusal(403, JSON.stringify({ code: 'company_sanctioned', message: 'pending trade-compliance review' }))).toBe('unknown');
  });

  describe('degrades to `unknown` rather than guessing', () => {
    it.each([
      ['a sentence it has never seen', 'the request could not be completed at this time'],
      ['an empty body', ''],
      ['an absent body', undefined],
      ['a body with no message field', JSON.stringify({ code: 'SOMETHING' })],
      ['a non-string message', JSON.stringify({ Message: { nested: true } })],
      ['a number', 42],
    ])('%s', (_label, body) => {
      expect(classifyOrgClaManagerRefusal(400, body)).toBe('unknown');
    });
  });

  it('never returns the sentence it was given', () => {
    const sentence = 'user jdelacroix is not authorized for project a09410000182dD3AAI';
    const result: string = classifyOrgClaManagerRefusal(400, sentence);

    expect(result).toBe('not-authorized');
    expect(result).not.toContain('jdelacroix');
    expect(result).not.toContain('a09410000182dD3AAI');
  });
});

describe('validateOrgClaManagerAdd', () => {
  const valid = { firstName: 'Ada', lastName: 'Okonkwo', email: 'ada.okonkwo@example.org' };

  it('accepts a well-formed request', () => {
    expect(hasOrgClaManagerAddErrors(validateOrgClaManagerAdd(valid))).toBe(false);
  });

  it('rejects each missing field by name', () => {
    const result = validateOrgClaManagerAdd({});

    expect(result.firstName).toBeDefined();
    expect(result.lastName).toBeDefined();
    expect(result.email).toBeDefined();
  });

  it.each([
    ['a name part below the producer minimum', { ...valid, firstName: 'A' }, 'firstName'],
    ['a name part above the producer maximum', { ...valid, lastName: 'x'.repeat(31) }, 'lastName'],
    ['an address with no domain', { ...valid, email: 'ada.okonkwo@' }, 'email'],
    ['an address with no local part', { ...valid, email: '@example.org' }, 'email'],
    ['an address with a space', { ...valid, email: 'ada okonkwo@example.org' }, 'email'],
  ] as const)('rejects %s', (_label, request, field) => {
    expect(validateOrgClaManagerAdd(request)[field]).toBeDefined();
  });

  it('trims before measuring, so whitespace does not satisfy the minimum', () => {
    expect(validateOrgClaManagerAdd({ ...valid, firstName: ' A ' }).firstName).toBeDefined();
  });

  it('accepts a two-character name part, which is the producer boundary', () => {
    expect(hasOrgClaManagerAddErrors(validateOrgClaManagerAdd({ ...valid, firstName: 'Bo', lastName: 'Ng' }))).toBe(false);
  });

  it('counts Unicode code points for name limits, not UTF-16 code units', () => {
    expect(hasOrgClaManagerAddErrors(validateOrgClaManagerAdd({ ...valid, firstName: '😀' }))).toBe(true);
    expect(hasOrgClaManagerAddErrors(validateOrgClaManagerAdd({ ...valid, firstName: '😀😀' }))).toBe(false);
  });

  it('accepts a plus-addressed and a subdomain address, which are legal and deliverable', () => {
    expect(hasOrgClaManagerAddErrors(validateOrgClaManagerAdd({ ...valid, email: 'ada+cla@eng.example.org' }))).toBe(false);
  });

  it('accepts an underscore in the domain portion, which EasyCLA userEmail allows', () => {
    expect(hasOrgClaManagerAddErrors(validateOrgClaManagerAdd({ ...valid, email: 'user@team_name.example.org' }))).toBe(false);
  });

  it.each([
    ['a one-letter TLD the producer rejects', 'ada@example.c'],
    ['a TLD longer than ten letters', 'ada@example.engineering'],
    ['a local part with a slash', 'ada/cla@example.org'],
  ] as const)('rejects %s', (_label, email) => {
    expect(isOrgClaManagerAddEmail(email)).toBe(false);
    expect(validateOrgClaManagerAdd({ ...valid, email }).email).toBeDefined();
  });
});

describe('isOrgClaManagerLfUsername', () => {
  it.each(['john.doe', 'ab', 'aporter'])('accepts %s', (username) => {
    expect(isOrgClaManagerLfUsername(username)).toBe(true);
  });

  it.each(['', 'a porter/../..', 'ada porter', '.', '..'])('rejects %s', (username) => {
    expect(isOrgClaManagerLfUsername(username)).toBe(false);
  });
});
