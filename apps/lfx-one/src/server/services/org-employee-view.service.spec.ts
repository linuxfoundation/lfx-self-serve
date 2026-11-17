// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsername, resolveVerifiedUserEmails, generateM2MToken } = vi.hoisted(() => ({
  generateM2MToken: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'employee'),
  resolveVerifiedUserEmails: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { OrgEmployeeViewService, emailBelongsToCompanyDomain, normalizeCompanyDomain } = await import('./org-employee-view.service');
const { MicroserviceError } = await import('../errors');

const ORG_UID = '0016100000ACMEAAA1';
const CDEV_ORG = '0b7d6b1e-6a2f-4a1f-9c66-9d9a0f0d1234';

const req = (): Request => ({ path: '/api/orgs/x/lens/overview' }) as unknown as Request;

function experience(organizationId: string | undefined, endDate?: string) {
  return [{ id: 'we-1', organization: 'Acme Motors', organizationId, jobTitle: 'Engineer', startDate: 'Jan 2024', endDate, source: 'cdp-enriched' as const }];
}

interface Setup {
  experiences?: unknown;
  account?: unknown;
  org?: unknown;
  emails?: string[] | Error;
}

function build(opts: Setup = {}) {
  const cdp = {
    getWorkExperiencesForKnownUser: vi
      .fn()
      .mockImplementation(() => (opts.experiences instanceof Error ? Promise.reject(opts.experiences) : Promise.resolve(opts.experiences ?? []))),
  };
  const organizations = {
    getOrgLensAccountContextByCdevOrgId: vi
      .fn()
      .mockImplementation(() =>
        opts.account instanceof Error
          ? Promise.reject(opts.account)
          : Promise.resolve(opts.account === undefined ? { accountId: ORG_UID, accountName: 'Acme Motors', isMember: true } : opts.account)
      ),
  };
  const proxy = {
    proxyRequest: vi
      .fn()
      .mockImplementation(() =>
        opts.org instanceof Error
          ? Promise.reject(opts.org)
          : Promise.resolve(opts.org ?? { uid: ORG_UID, name: 'Acme Motors', primary_domain: 'acme-motors.example' })
      ),
  };
  resolveVerifiedUserEmails.mockImplementation(() =>
    opts.emails instanceof Error ? Promise.reject(opts.emails) : Promise.resolve(opts.emails ?? ['dev@acme-motors.example'])
  );
  const svc = new OrgEmployeeViewService({ cdp: cdp as never, organizations: organizations as never, emailVerification: {} as never, proxy: proxy as never });
  return { svc, cdp, organizations, proxy };
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('employee');
  generateM2MToken.mockResolvedValue('m2m-token');
});

describe('OrgEmployeeViewService.resolve', () => {
  it('admits a current employee of an active member with a verified email on the company domain', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: true, org: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null } });
  });

  it('names the company from the affiliation when no uid is asked for', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
  });

  it('denies a caller with no employer', async () => {
    const { svc, organizations } = build({ experiences: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-employer' });
    expect(organizations.getOrgLensAccountContextByCdevOrgId).not.toHaveBeenCalled();
  });

  it('denies a caller whose only employment has ended', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG, 'Dec 2025') });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-employer' });
  });

  it('denies an employer the account-grain mapping does not list, rather than guessing membership', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), account: null });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'employer-unresolvable' });
  });

  it('denies a non-member company', async () => {
    const { svc, proxy } = build({ experiences: experience(CDEV_ORG), account: { accountId: ORG_UID, accountName: 'Acme Motors', isMember: false } });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'not-member' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('denies a company other than the one the affiliation resolves to, so editing the URL opens nothing', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolve(req(), '0016100000OTHERAAA1')).resolves.toEqual({ eligible: false, reason: 'other-company' });
  });

  it('denies a caller with no verified email at all', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), emails: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('denies a caller whose verified email is on another company domain', async () => {
    const { svc } = build({
      experiences: experience(CDEV_ORG),
      emails: ['dev@example.com', 'dev@notacme-motors.example', 'dev@acme-motors.example.evil.test'],
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('denies, rather than admits, when the company has no domain on record', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), org: { uid: ORG_UID, name: 'Acme Motors' } });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'company-domains-unknown' });
  });

  it('accepts a subdomain of the company domain', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), emails: ['Dev@Eng.Acme-Motors.Example'] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('does not take a domain from the website: only primary_domain counts', async () => {
    const { svc } = build({
      experiences: experience(CDEV_ORG),
      org: { uid: ORG_UID, name: 'Acme Motors', website: 'https://www.acme-motors.example/about' },
      emails: ['dev@acme-motors.example'],
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'company-domains-unknown' });
  });

  it('reads the company record with the BFF machine token, not the caller token', async () => {
    const { svc, proxy } = build({ experiences: experience(CDEV_ORG) });

    await svc.resolve(req(), ORG_UID);

    expect(proxy.proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `/b2b_orgs/${ORG_UID}`, 'GET', undefined, undefined, undefined, {
      bearerToken: 'm2m-token',
    });
  });

  it('reports the company slug so a slug address can resolve', async () => {
    const { svc } = build({
      experiences: experience(CDEV_ORG),
      org: { uid: ORG_UID, name: 'Acme Motors', primary_domain: 'acme-motors.example', slug: 'Acme-Motors' },
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true, org: { orgSlug: 'acme-motors' } });
  });

  it('rejects when the machine token cannot be minted', async () => {
    generateM2MToken.mockRejectedValueOnce(new Error('auth0 down'));
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolve(req(), ORG_UID)).rejects.toBeInstanceOf(Error);
  });

  it.each([
    ['the work history', { experiences: new Error('cdp down') }],
    ['the membership lookup', { experiences: experience(CDEV_ORG), account: new Error('snowflake down') }],
    ['the company record', { experiences: experience(CDEV_ORG), org: new MicroserviceError('boom', 502, 'UPSTREAM') }],
    ['the verified email lookup', { experiences: experience(CDEV_ORG), emails: new Error('auth-service down') }],
  ])('rejects, never denies, when %s fails', async (_label, setup) => {
    const { svc } = build(setup as Setup);

    await expect(svc.resolve(req(), ORG_UID)).rejects.toBeInstanceOf(Error);
  });

  it('does not keep a rejected lookup, so the next request retries', async () => {
    const { svc, cdp } = build({ experiences: new Error('cdp down') });
    await expect(svc.resolve(req(), ORG_UID)).rejects.toBeInstanceOf(Error);

    cdp.getWorkExperiencesForKnownUser.mockResolvedValue(experience(CDEV_ORG));
    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('shares one lookup between the parallel calls of one page', async () => {
    const { svc, cdp } = build({ experiences: experience(CDEV_ORG) });

    await Promise.all([svc.resolve(req(), ORG_UID), svc.resolve(req(), ORG_UID), svc.resolve(req(), ORG_UID)]);

    expect(cdp.getWorkExperiencesForKnownUser).toHaveBeenCalledTimes(1);
  });

  it('resolves for the effective user, never the impersonating admin', async () => {
    getEffectiveUsername.mockReturnValue('impersonated-user');
    const { svc, cdp } = build({ experiences: experience(CDEV_ORG) });

    await svc.resolve(req(), ORG_UID);

    expect(cdp.getWorkExperiencesForKnownUser).toHaveBeenCalledWith(expect.anything(), 'impersonated-user');
    // `resolveVerifiedUserEmails` is itself impersonation-aware and is read strictly, so an outage is never a "no".
    expect(resolveVerifiedUserEmails).toHaveBeenCalledWith(expect.anything(), expect.anything(), { strict: true });
  });

  it('denies a request with no effective username', async () => {
    getEffectiveUsername.mockReturnValue(null as never);
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: false });
  });
});

describe('OrgEmployeeViewService.getRoleGrantEmployeeView', () => {
  const grants = (overrides: Partial<RoleGrantsResponse> = {}): RoleGrantsResponse => ({
    writers: [],
    auditors: [],
    cascadingWriters: [],
    cascadingAuditors: [],
    username: 'employee',
    loaded_at: '2026-11-17T00:00:00.000Z',
    isStaff: false,
    degraded: false,
    lookupOutcome: 'ok',
    staffCheck: 'ok',
    ...overrides,
  });
  const member = { hasEmployer: true, employerIsMember: true, lookup: 'ok' as const };

  beforeEach(() => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = 'true';
  });

  it('reports the company for a grant-less employee of a member', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.getRoleGrantEmployeeView(req(), grants(), member)).resolves.toEqual({
      employeeView: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null },
    });
  });

  it.each([
    ['a grant holder', grants({ writers: [ORG_UID] }), member],
    ['LF staff', grants({ isStaff: true }), member],
    ['a partial roster', grants({ lookupOutcome: 'partial' }), member],
    ['a non-member employer', grants(), { hasEmployer: true, employerIsMember: false, lookup: 'ok' as const }],
    ['an unanswered affiliation', grants(), { hasEmployer: true, employerIsMember: false, lookup: 'failed' as const }],
  ])('asks nothing for %s', async (_label, g, affiliation) => {
    const { svc, cdp } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.getRoleGrantEmployeeView(req(), g, affiliation)).resolves.toEqual({});
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });

  it('answers nothing, not an error, when the lookup fails', async () => {
    const { svc } = build({ experiences: new Error('cdp down') });

    await expect(svc.getRoleGrantEmployeeView(req(), grants(), member)).resolves.toEqual({});
  });

  it('is a no-op with the flag off', async () => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = '';
    const { svc, cdp } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.getRoleGrantEmployeeView(req(), grants(), member)).resolves.toEqual({});
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });
});

describe('domain helpers', () => {
  it('normalizes a domain or URL to a bare host', () => {
    expect(normalizeCompanyDomain('https://www.Acme-Motors.example/careers')).toBe('acme-motors.example');
    expect(normalizeCompanyDomain('acme-motors.example/about')).toBe('acme-motors.example');
    expect(normalizeCompanyDomain('not a host')).toBeNull();
    expect(normalizeCompanyDomain('')).toBeNull();
    expect(normalizeCompanyDomain(null)).toBeNull();
  });

  it('matches on a whole label boundary only', () => {
    expect(emailBelongsToCompanyDomain('a@acme-motors.example', ['acme-motors.example'])).toBe(true);
    expect(emailBelongsToCompanyDomain('a@eng.acme-motors.example', ['acme-motors.example'])).toBe(true);
    expect(emailBelongsToCompanyDomain('a@notacme-motors.example', ['acme-motors.example'])).toBe(false);
    expect(emailBelongsToCompanyDomain('a@acme-motors.example.evil.test', ['acme-motors.example'])).toBe(false);
    expect(emailBelongsToCompanyDomain('no-at-sign', ['acme-motors.example'])).toBe(false);
  });
});
