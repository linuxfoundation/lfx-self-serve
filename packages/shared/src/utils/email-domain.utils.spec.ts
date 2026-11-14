// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { candidateMemberDomains, emailDomain, isPersonalEmailDomain, normalizeDomain, registrableDomain } from './email-domain.utils';

describe('normalizeDomain', () => {
  it('lowercases and trims', () => {
    expect(normalizeDomain('  Acme-Motors.EXAMPLE ')).toBe('acme-motors.example');
  });

  it('strips scheme, path, port, trailing dot and www', () => {
    expect(normalizeDomain('https://www.acme-motors.example:8443/about?x=1')).toBe('acme-motors.example');
    expect(normalizeDomain('acme-motors.example.')).toBe('acme-motors.example');
  });

  it('rejects malformed or single-label values', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('acme motors.example')).toBeNull();
    expect(normalizeDomain('acme,motors.example')).toBeNull();
    expect(normalizeDomain('-acme.example')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
  });
});

describe('emailDomain', () => {
  it('returns the normalized domain of an address', () => {
    expect(emailDomain('Jane.Doe@Eng.Acme-Motors.EXAMPLE')).toBe('eng.acme-motors.example');
  });

  it('uses the last @ and rejects addresses without a domain', () => {
    expect(emailDomain('"odd@local"@vendor-corp.example')).toBe('vendor-corp.example');
    expect(emailDomain('no-at-sign')).toBeNull();
    expect(emailDomain('@vendor-corp.example')).toBeNull();
    expect(emailDomain('jane@')).toBeNull();
  });
});

describe('registrableDomain', () => {
  it('takes the last two labels by default', () => {
    expect(registrableDomain('eng.emea.acme-motors.example')).toBe('acme-motors.example');
  });

  it('takes three labels under a multi-part public suffix', () => {
    expect(registrableDomain('eng.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('acme.com.au')).toBe('acme.com.au');
    expect(registrableDomain('mail.acme.com.vn')).toBe('acme.com.vn');
  });

  it('is null for a bare public suffix', () => {
    expect(registrableDomain('co.uk')).toBeNull();
    expect(registrableDomain('com.vn')).toBeNull();
  });

  it('treats a multi-tenant mail host tenant as its own registrable domain', () => {
    expect(registrableDomain('support.acme.zendesk.com')).toBe('acme.zendesk.com');
    expect(registrableDomain('acme.atlassian.net')).toBe('acme.atlassian.net');
    expect(registrableDomain('contoso.onmicrosoft.com')).toBe('contoso.onmicrosoft.com');
  });
});

describe('isPersonalEmailDomain', () => {
  it.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'outlook.jp',
    'hotmail.co.uk',
    'yahoo.co.in',
    'yahoo.com.ph',
    'icloud.com',
    'proton.me',
    'qq.com',
    '163.com',
  ])('flags %s as personal', (domain) => {
    expect(isPersonalEmailDomain(domain)).toBe(true);
  });

  it('flags subdomains of personal providers', () => {
    expect(isPersonalEmailDomain('mail.yahoo.com')).toBe(true);
  });

  it('does not flag company domains, even ones containing a provider word', () => {
    expect(isPersonalEmailDomain('acme-motors.example')).toBe(false);
    expect(isPersonalEmailDomain('gmail-team.acme-motors.example')).toBe(false);
    expect(isPersonalEmailDomain('acme.co.uk')).toBe(false);
  });
});

describe('candidateMemberDomains', () => {
  it('walks parents down to the registrable domain', () => {
    expect(candidateMemberDomains('eng.emea.acme-motors.example')).toEqual(['eng.emea.acme-motors.example', 'emea.acme-motors.example', 'acme-motors.example']);
  });

  it('returns just the domain when it is already registrable', () => {
    expect(candidateMemberDomains('acme-motors.example')).toEqual(['acme-motors.example']);
  });

  it('never walks up to a bare public suffix', () => {
    expect(candidateMemberDomains('eng.acme.co.uk')).toEqual(['eng.acme.co.uk', 'acme.co.uk']);
    expect(candidateMemberDomains('foo.com.vn')).toEqual(['foo.com.vn']);
    expect(candidateMemberDomains('co.uk')).toEqual([]);
  });

  it('never walks out of a multi-tenant tenant to the host company domain', () => {
    expect(candidateMemberDomains('support.acme.zendesk.com')).toEqual(['support.acme.zendesk.com', 'acme.zendesk.com']);
    expect(candidateMemberDomains('acme.atlassian.net')).toEqual(['acme.atlassian.net']);
  });
});
