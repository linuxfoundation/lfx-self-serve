// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_CLA_DESIGNEE_NAME_PATTERN } from '../constants/cla.constants';
import {
  classifyOrgClaDesigneeRefusal,
  hasOrgClaDesigneeNominationErrors,
  isOrgClaDesigneeFullName,
  isOrgClaDesigneeLfLoginRequested,
  validateOrgClaDesigneeNomination,
} from './org-cla-designee.utils';

const producerBadRequest = (error: string) =>
  JSON.stringify({ Code: '400', Message: `EasyCLA - 400 Bad Request - user :contributor@example.org, error: ${error}  - error: ${error}` });

describe('classifyOrgClaDesigneeRefusal', () => {
  it.each([
    ['already-signed', 'project already signed'],
    ['no-lf-login', 'lfx user not found'],
    ['no-lf-login', 'user has no LF Login'],
  ] as const)('reads %s from the 400 sentence', (expected, error) => {
    expect(classifyOrgClaDesigneeRefusal(400, producerBadRequest(error))).toBe(expected);
  });

  it('reads the sanctioned code off the typed 403 body before the status', () => {
    const body = { code: 'company_sanctioned', message: 'This organization cannot sign at this time.' };
    expect(classifyOrgClaDesigneeRefusal(403, body)).toBe('sanctioned');
  });

  it('treats any other 401 or 403 as not authorized', () => {
    expect(classifyOrgClaDesigneeRefusal(403, JSON.stringify({ Message: 'EasyCLA - 403 Forbidden - user does not have access' }))).toBe('not-authorized');
    expect(classifyOrgClaDesigneeRefusal(401, '')).toBe('not-authorized');
  });

  it('degrades an unrecognized 400 to unknown rather than guessing', () => {
    expect(classifyOrgClaDesigneeRefusal(400, producerBadRequest('something else went wrong'))).toBe('unknown');
  });

  it('degrades a missing body to unknown', () => {
    expect(classifyOrgClaDesigneeRefusal(400, undefined)).toBe('unknown');
  });
});

describe('isOrgClaDesigneeLfLoginRequested', () => {
  it('is true only for the manager-request 400 that already emailed the person', () => {
    expect(isOrgClaDesigneeLfLoginRequested(400, JSON.stringify({ Code: '400', Message: 'user has no LF Login' }))).toBe(true);
  });

  it('is false for the designee path, whose no-account refusal sends no email', () => {
    expect(isOrgClaDesigneeLfLoginRequested(400, producerBadRequest('lfx user not found'))).toBe(false);
  });

  it('is false on a status other than 400', () => {
    expect(isOrgClaDesigneeLfLoginRequested(404, JSON.stringify({ Message: 'user has no LF Login' }))).toBe(false);
  });
});

describe('isOrgClaDesigneeFullName', () => {
  it.each(['Jo', 'Pat Contributor', 'pat_contributor 2', 'A'.repeat(60)])('accepts %s', (name) => {
    expect(isOrgClaDesigneeFullName(name)).toBe(true);
  });

  it.each(['J', 'A'.repeat(61), 'Pat  Contributor', ' Pat', 'Pat ', 'Zoë Contributor', "O'Contributor", 'Pat-Contributor'])('refuses %s', (name) => {
    expect(isOrgClaDesigneeFullName(name)).toBe(false);
  });

  it('refuses a long input that fails at the end without backtracking', () => {
    expect(ORG_CLA_DESIGNEE_NAME_PATTERN.test(`${'a '.repeat(5000)}!`)).toBe(false);
  });
});

describe('validateOrgClaDesigneeNomination', () => {
  it('passes a valid name and email', () => {
    const result = validateOrgClaDesigneeNomination({ projectSfid: 'a0941000002wBz9AAE', fullName: '  Pat Contributor ', email: 'contributor@example.org' });
    expect(result).toEqual({});
    expect(hasOrgClaDesigneeNominationErrors(result)).toBe(false);
  });

  it('requires both fields', () => {
    expect(validateOrgClaDesigneeNomination({})).toEqual({ fullName: 'Name is required.', email: 'Email address is required.' });
  });

  it('names the length bound the CLA service enforces', () => {
    expect(validateOrgClaDesigneeNomination({ fullName: 'P', email: 'contributor@example.org' }).fullName).toBe('Name must be at least 2 characters.');
    expect(validateOrgClaDesigneeNomination({ fullName: 'P'.repeat(61), email: 'contributor@example.org' }).fullName).toBe(
      'Name must be 60 characters or fewer.'
    );
  });

  it('says which characters are accepted when the pattern fails', () => {
    expect(validateOrgClaDesigneeNomination({ fullName: 'Zoë Contributor', email: 'contributor@example.org' }).fullName).toContain(
      'Accents, hyphens, and apostrophes'
    );
  });

  it('uses the CLA manager email rule', () => {
    expect(validateOrgClaDesigneeNomination({ fullName: 'Pat Contributor', email: 'not-an-email' }).email).toBe('Enter a valid email address.');
  });

  it('answers a non-string field as missing instead of throwing', () => {
    expect(validateOrgClaDesigneeNomination({ fullName: 42, email: ['x'] })).toEqual({
      fullName: 'Name is required.',
      email: 'Email address is required.',
    });
  });
});
