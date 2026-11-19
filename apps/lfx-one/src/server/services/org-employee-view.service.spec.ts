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

const { OrgEmployeeViewService } = await import('./org-employee-view.service');
const { MicroserviceError } = await import('../errors');

const ORG_UID = '0016100000ACMEAAA1';
const OTHER_UID = '0016100000OTHERAAA1';

const req = (): Request => ({ path: '/api/orgs/x/lens/overview' }) as unknown as Request;

type Doc = { uid?: string; name?: string; slug?: string; primary_domain?: string; domain_aliases?: string[]; is_member?: boolean };

const acme: Doc = { name: 'Acme Motors', primary_domain: 'acme-motors.example' };

/** A query-service page whose wrapper ids are `b2b_org:<uid>`, as the service returns them. */
function page(entries: Array<[string, Doc]>) {
  return { resources: entries.map(([uid, data]) => ({ id: `b2b_org:${uid}`, type: 'b2b_org', data })) };
}

interface Setup {
  orgs?: Array<[string, Doc]> | Error;
  emails?: string[] | Error;
  auditor?: boolean | Error;
}

function build(opts: Setup = {}) {
  const orgs = opts.orgs ?? [[ORG_UID, acme]];
  const proxy = {
    proxyRequest: vi.fn().mockImplementation(() => (orgs instanceof Error ? Promise.reject(orgs) : Promise.resolve(page(orgs)))),
  };
  resolveVerifiedUserEmails.mockImplementation(() =>
    opts.emails instanceof Error ? Promise.reject(opts.emails) : Promise.resolve(opts.emails ?? ['dev@acme-motors.example'])
  );
  const accessCheck = {
    checkSingleAccessStrict: vi
      .fn()
      .mockImplementation(() => (opts.auditor instanceof Error ? Promise.reject(opts.auditor) : Promise.resolve(opts.auditor ?? false))),
  };
  const svc = new OrgEmployeeViewService({ emailVerification: {} as never, proxy: proxy as never, accessCheck: accessCheck as never });
  return { svc, proxy, accessCheck };
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('employee');
  generateM2MToken.mockResolvedValue('m2m-token');
});

describe('OrgEmployeeViewService.resolve', () => {
  it('admits a caller with a verified email on an active member company domain, with no CDP or work history involved', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: true, org: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null } });
  });

  it('names the company from the email when no uid is asked for', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
  });

  it('asks the query service only for active-member companies matching the address domains', async () => {
    const { svc, proxy } = build({ emails: ['dev@eng.acme-motors.example'] });

    await svc.resolve(req(), ORG_UID);

    expect(proxy.proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({
        type: 'b2b_org',
        tags_all: ['is_member:true'],
        filters_or: [
          'primary_domain:eng.acme-motors.example',
          'domain_aliases:eng.acme-motors.example',
          'primary_domain:acme-motors.example',
          'domain_aliases:acme-motors.example',
        ],
      }),
      undefined,
      undefined,
      { bearerToken: 'm2m-token' }
    );
  });

  it('denies a caller with no verified email at all, without asking the query service', async () => {
    const { svc, proxy } = build({ emails: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('never treats a personal mailbox provider as an employer', async () => {
    const { svc, proxy } = build({ emails: ['dev@gmail.com', 'dev@outlook.com'] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('denies a caller whose verified email matches no member company', async () => {
    const { svc } = build({ orgs: [], emails: ['dev@elsewhere.example'] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('re-checks every returned record, so a company the query service returned for another domain never qualifies', async () => {
    const { svc } = build({ orgs: [[ORG_UID, { name: 'Acme Motors', primary_domain: 'unrelated.example' }]] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('ignores a record the index marks as a non-member', async () => {
    const { svc } = build({ orgs: [[ORG_UID, { ...acme, is_member: false }]] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('denies a company other than the one the email names, so editing the URL opens nothing', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), OTHER_UID)).resolves.toEqual({ eligible: false, reason: 'other-company' });
  });

  it('matches any of the company domains (primary or Salesforce alias), such as hitachi .co.uk / .com / .jp', async () => {
    const { svc } = build({
      orgs: [
        [ORG_UID, { name: 'Acme Motors', primary_domain: 'acme-motors.example', domain_aliases: ['Acme-Group.example', 'acme-motors.example.jp', 'bad host'] }],
      ],
      emails: ['dev@acme-motors.example.jp'],
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('accepts a subdomain address of a company that registered the parent domain', async () => {
    const { svc } = build({ emails: ['Dev@Eng.Acme-Motors.Example'] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('does not match a look-alike or suffix-extended domain', async () => {
    const { svc, proxy } = build({ orgs: [], emails: ['dev@notacme-motors.example', 'dev@acme-motors.example.evil.test'] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    const filters = (proxy.proxyRequest.mock.calls[0][4] as { filters_or: string[] }).filters_or;
    expect(filters).not.toContain('primary_domain:example');
    expect(filters).not.toContain('primary_domain:acme-motors.example');
  });

  it('reports the company slug so a slug address can resolve', async () => {
    const { svc } = build({ orgs: [[ORG_UID, { ...acme, slug: 'Acme-Motors' }]] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true, org: { orgSlug: 'acme-motors' } });
  });

  it('with several matching companies, answers a stable first one for no uid and any of them for a specific uid', async () => {
    const orgs: Array<[string, Doc]> = [
      [OTHER_UID, { name: 'Zeta Holdings', primary_domain: 'acme-motors.example' }],
      [ORG_UID, { name: 'Acme Motors', domain_aliases: ['acme-motors.example'] }],
    ];
    const { svc } = build({ orgs });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    await expect(svc.resolve(req(), OTHER_UID)).resolves.toMatchObject({ eligible: true, org: { orgUid: OTHER_UID } });
  });

  it('reads the companies with the BFF machine token, not the caller token', async () => {
    const { svc, proxy } = build();

    await svc.resolve(req(), ORG_UID);

    expect(proxy.proxyRequest.mock.calls[0][7]).toEqual({ bearerToken: 'm2m-token' });
  });

  it('rejects, and does not cache a denial, when the machine token cannot be minted', async () => {
    const notFound = new MicroserviceError('token endpoint 404', 404, 'M2M_TOKEN_ERROR', { operation: 'generate_m2m_token' });
    generateM2MToken.mockRejectedValueOnce(notFound);
    const { svc, proxy } = build();

    await expect(svc.resolve(req(), ORG_UID)).rejects.toBe(notFound);
    expect(proxy.proxyRequest).not.toHaveBeenCalled();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it.each([
    ['the company lookup', { orgs: new MicroserviceError('boom', 502, 'UPSTREAM') }],
    ['the verified email lookup', { emails: new Error('auth-service down') }],
  ])('rejects, never denies, when %s fails', async (_label, setup) => {
    const { svc } = build(setup as Setup);

    await expect(svc.resolve(req(), ORG_UID)).rejects.toBeInstanceOf(Error);
  });

  it('does not keep a rejected lookup, so the next request retries', async () => {
    const { svc } = build({ emails: new Error('auth-service down') });
    await expect(svc.resolve(req(), ORG_UID)).rejects.toBeInstanceOf(Error);

    resolveVerifiedUserEmails.mockResolvedValue(['dev@acme-motors.example']);
    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('shares one lookup between the parallel calls of one page', async () => {
    const { svc } = build();

    await Promise.all([svc.resolve(req(), ORG_UID), svc.resolve(req(), ORG_UID), svc.resolve(req(), ORG_UID)]);

    expect(resolveVerifiedUserEmails).toHaveBeenCalledTimes(1);
  });

  it('resolves for the effective user, never the impersonating admin', async () => {
    getEffectiveUsername.mockReturnValue('impersonated-user');
    const { svc } = build();

    await svc.resolve(req(), ORG_UID);

    // `resolveVerifiedUserEmails` is itself impersonation-aware and is read strictly, so an outage is never a "no".
    expect(resolveVerifiedUserEmails).toHaveBeenCalledWith(expect.anything(), expect.anything(), { strict: true });
  });

  it('denies a request with no effective username', async () => {
    getEffectiveUsername.mockReturnValue(null as never);
    const { svc } = build();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: false });
  });
});

describe('OrgEmployeeViewService.resolveReduced', () => {
  it('reports the company for a caller who is employee-only', async () => {
    const { svc, accessCheck } = build();

    await expect(svc.resolveReduced(req())).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    expect(accessCheck.checkSingleAccessStrict).toHaveBeenCalledWith(expect.anything(), { resource: 'b2b_org', id: ORG_UID, access: 'auditor' });
  });

  it('does not publish an employee-only flag for a caller who also holds the auditor entitlement (they resolve full)', async () => {
    const { svc } = build({ auditor: true });

    await expect(svc.resolveReduced(req())).resolves.toEqual({
      eligible: false,
      reason: 'holds-full-access',
      org: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null },
    });
  });

  it('rejects, never publishes, when the authorizer cannot answer', async () => {
    const { svc } = build({ auditor: new Error('authorizer down') });

    await expect(svc.resolveReduced(req())).rejects.toBeInstanceOf(Error);
  });

  it('asks the authorizer nothing for a caller who is not eligible', async () => {
    const { svc, accessCheck } = build({ emails: [] });

    await expect(svc.resolveReduced(req())).resolves.toMatchObject({ eligible: false });
    expect(accessCheck.checkSingleAccessStrict).not.toHaveBeenCalled();
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

  beforeEach(() => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = 'true';
  });

  it('reports the company for a grant-less caller with a verified member-company email', async () => {
    const { svc } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({
      employeeView: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null },
    });
  });

  it('needs no affiliation verdict, so a contractor and any other grant-less caller take the same path', async () => {
    const { svc } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), grants({ isContractor: true }))).resolves.toMatchObject({ employeeView: { orgUid: ORG_UID } });
  });

  it.each([
    ['a grant holder', grants({ writers: [ORG_UID] })],
    ['LF staff', grants({ isStaff: true })],
    ['a partial roster', grants({ lookupOutcome: 'partial' })],
  ])('asks nothing for %s', async (_label, g) => {
    const { svc } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), g)).resolves.toEqual({});
    expect(resolveVerifiedUserEmails).not.toHaveBeenCalled();
  });

  it('publishes the full-access company, not an employee view, for a caller who also holds the auditor entitlement', async () => {
    const { svc } = build({ auditor: true });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({ fullAccessOrgUid: ORG_UID });
  });

  it('answers nothing, not an error, when the lookup fails', async () => {
    const { svc } = build({ emails: new Error('auth-service down') });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
  });

  it('answers nothing for a caller whose emails name no member company', async () => {
    const { svc } = build({ orgs: [] });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
  });

  it('is a no-op with the flag off', async () => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = '';
    const { svc } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
    expect(resolveVerifiedUserEmails).not.toHaveBeenCalled();
  });
});
