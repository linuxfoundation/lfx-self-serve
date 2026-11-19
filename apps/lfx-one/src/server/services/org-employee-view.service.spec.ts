// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsername, resolveVerifiedUserEmails, generateM2MToken, pinned } = vi.hoisted(() => ({
  pinned: new Map<string, unknown>(),
  generateM2MToken: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'employee'),
  resolveVerifiedUserEmails: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails }));
vi.mock('./valkey.service', () => ({
  withPerUserCache: async (_ns: string, username: string, fingerprint: string, _ttl: number, fetcher: () => Promise<unknown>) => {
    const key = `${username}:${fingerprint}`;
    if (!pinned.has(key)) pinned.set(key, await fetcher());
    return pinned.get(key);
  },
}));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { OrgEmployeeViewService } = await import('./org-employee-view.service');
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
  auditor?: boolean | Error;
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
  const accessCheck = {
    checkSingleAccessStrict: vi
      .fn()
      .mockImplementation(() => (opts.auditor instanceof Error ? Promise.reject(opts.auditor) : Promise.resolve(opts.auditor ?? false))),
  };
  const engagement = { getLastActivityByAccount: vi.fn().mockResolvedValue(new Map<string, number>()) };
  const svc = new OrgEmployeeViewService({
    engagement: engagement as never,
    cdp: cdp as never,
    organizations: organizations as never,
    emailVerification: {} as never,
    proxy: proxy as never,
    accessCheck: accessCheck as never,
  });
  return { svc, cdp, organizations, proxy, accessCheck, engagement };
}

beforeEach(() => {
  vi.clearAllMocks();
  pinned.clear();
  getEffectiveUsername.mockReturnValue('employee');
  generateM2MToken.mockResolvedValue('m2m-token');
});

describe('OrgEmployeeViewService.resolve', () => {
  it('admits a current employee of an active member with a verified email on the company domain', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: true, org: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null } });
  });

  it('names the company from the work history when no uid is asked for', async () => {
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

  it('denies a company other than the employer the work history names, so editing the URL opens nothing', async () => {
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

  it('matches a registered domain alias, and an alias-only company still has domains', async () => {
    const { svc } = build({
      experiences: experience(CDEV_ORG),
      org: { uid: ORG_UID, name: 'Acme Motors', primary_domain: 'acme-motors.example', domain_aliases: ['Acme-Group.example', 'bad host'] },
      emails: ['dev@eng.acme-group.example'],
    });
    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });

    const aliasOnly = build({
      experiences: experience(CDEV_ORG),
      org: { uid: ORG_UID, name: 'Acme Motors', domain_aliases: ['acme-group.example'] },
      emails: ['dev@acme-group.example'],
    });
    await expect(aliasOnly.svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('still excludes the website host when aliases exist', async () => {
    const { svc } = build({
      experiences: experience(CDEV_ORG),
      org: {
        uid: ORG_UID,
        name: 'Acme Motors',
        primary_domain: 'acme-motors.example',
        domain_aliases: ['acme-group.example'],
        website: 'https://social.example/acme',
      },
      emails: ['dev@social.example'],
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
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

  it('rejects, and does not cache a denial, when the token endpoint answers 404', async () => {
    const notFound = new MicroserviceError('token endpoint 404', 404, 'M2M_TOKEN_ERROR', { operation: 'generate_m2m_token' });
    generateM2MToken.mockRejectedValueOnce(notFound);
    const { svc, proxy } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolve(req(), ORG_UID)).rejects.toBe(notFound);
    expect(proxy.proxyRequest).not.toHaveBeenCalled();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('still treats a 404 from the company record itself as no domain on record', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), org: new MicroserviceError('missing', 404, 'NOT_FOUND') });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'company-domains-unknown' });
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

describe('OrgEmployeeViewService.resolveReduced', () => {
  it('reports the company for a caller who is employee-only', async () => {
    const { svc, accessCheck } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.resolveReduced(req())).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    expect(accessCheck.checkSingleAccessStrict).toHaveBeenCalledWith(expect.anything(), { resource: 'b2b_org', id: ORG_UID, access: 'auditor' });
  });

  it('does not publish an employee-only flag for a caller who also holds the auditor entitlement (they resolve full)', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), auditor: true });

    await expect(svc.resolveReduced(req())).resolves.toEqual({
      eligible: false,
      reason: 'holds-full-access',
      org: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null },
    });
  });

  it('rejects, never publishes, when the authorizer cannot answer', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), auditor: new Error('authorizer down') });

    await expect(svc.resolveReduced(req())).rejects.toBeInstanceOf(Error);
  });

  it('asks the authorizer nothing for a caller who is not eligible', async () => {
    const { svc, accessCheck } = build({ experiences: [] });

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

  it('reports the company for a grant-less employee of a member', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({
      employeeView: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null },
    });
  });

  it.each([
    ['a grant holder', grants({ writers: [ORG_UID] })],
    ['LF staff', grants({ isStaff: true })],
    ['a partial roster', grants({ lookupOutcome: 'partial' })],
  ])('asks nothing for %s', async (_label, g) => {
    const { svc, cdp } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.getRoleGrantEmployeeView(req(), g)).resolves.toEqual({});
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });

  it('publishes the full-access company, not an employee view, for a caller who also holds the auditor entitlement', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG), auditor: true });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({ fullAccessOrgUid: ORG_UID });
  });

  it('needs no affiliation verdict, since the strict lookup considers every present employer (a contractor takes the same path)', async () => {
    const { svc } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.getRoleGrantEmployeeView(req(), grants({ isContractor: true }))).resolves.toEqual({
      employeeView: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null },
    });
  });

  it('answers nothing for a caller with no present employer', async () => {
    const { svc } = build({ experiences: [] });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
  });

  it('answers nothing, not an error, when the lookup fails', async () => {
    const { svc } = build({ experiences: new Error('cdp down') });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
  });

  it('is a no-op with the flag off', async () => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = '';
    const { svc, cdp } = build({ experiences: experience(CDEV_ORG) });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });
});

describe('OrgEmployeeViewService with several present employers', () => {
  const CDEV_B = '0b7d6b1e-6a2f-4a1f-9c66-9d9a0f0d5678';
  const UID_B = '0016100000ZETAAAA1';

  function twoEmployers(opts: { startA?: string; startB?: string; activity?: Map<string, number>; emails?: string[]; engagementFails?: boolean } = {}) {
    const built = build({
      experiences: [
        {
          id: 'a',
          organization: 'Acme Motors',
          organizationId: CDEV_ORG,
          jobTitle: 'Engineer',
          startDate: opts.startA ?? 'Jan 2024',
          source: 'cdp-enriched' as const,
        },
        {
          id: 'b',
          organization: 'Zeta Holdings',
          organizationId: CDEV_B,
          jobTitle: 'Advisor',
          startDate: opts.startB ?? 'Jan 2025',
          source: 'cdp-enriched' as const,
        },
      ],
      emails: opts.emails ?? ['dev@acme-motors.example', 'dev@zeta-holdings.example'],
    });
    built.organizations.getOrgLensAccountContextByCdevOrgId.mockImplementation((id: string) =>
      Promise.resolve(
        id === CDEV_ORG
          ? { accountId: ORG_UID, accountName: 'Acme Motors', isMember: true }
          : { accountId: UID_B, accountName: 'Zeta Holdings', isMember: true }
      )
    );
    built.proxy.proxyRequest.mockImplementation((_req: unknown, _svc: string, path: string) =>
      Promise.resolve(
        path.includes(UID_B)
          ? { uid: UID_B, name: 'Zeta Holdings', primary_domain: 'zeta-holdings.example' }
          : { uid: ORG_UID, name: 'Acme Motors', primary_domain: 'acme-motors.example' }
      )
    );
    built.engagement.getLastActivityByAccount.mockImplementation(() => Promise.resolve(opts.activity ?? new Map<string, number>()));
    return built;
  }

  it('chooses the employer with the most recent engagement, and cuts the other one off', async () => {
    const { svc } = twoEmployers({
      activity: new Map([
        [ORG_UID, Date.parse('2026-11-01')],
        [UID_B, Date.parse('2026-06-01')],
      ]),
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    await expect(svc.resolve(req(), UID_B)).resolves.toEqual({ eligible: false, reason: 'other-company' });
    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
  });

  it('falls back to the most recent start date when there is no engagement data', async () => {
    const { svc } = twoEmployers({ startA: 'Jan 2024', startB: 'Mar 2025' });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: UID_B } });
  });

  it('falls back to the start date when the engagement lookup has nothing for either company', async () => {
    const { svc } = twoEmployers({ startA: 'Jun 2025', startB: 'Jan 2020', activity: new Map() });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
  });

  it('considers only employers that qualify: the one with a verified email wins even if the other is newer', async () => {
    const { svc } = twoEmployers({ startB: 'Nov 2026', emails: ['dev@acme-motors.example'] });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    await expect(svc.resolve(req(), UID_B)).resolves.toEqual({ eligible: false, reason: 'other-company' });
  });

  it('pins the choice: later activity at the other company does not move it while employers and emails are unchanged', async () => {
    const first = twoEmployers({
      activity: new Map([
        [ORG_UID, 2000],
        [UID_B, 1000],
      ]),
    });
    await expect(first.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });

    // A fresh service (the 60 s verdict cache is gone) with the activity now reversed, same employers and emails.
    const later = twoEmployers({
      activity: new Map([
        [ORG_UID, 1000],
        [UID_B, 9000],
      ]),
    });
    await expect(later.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    expect(later.engagement.getLastActivityByAccount).not.toHaveBeenCalled();
  });

  it('re-chooses when a verified email changes', async () => {
    const first = twoEmployers({
      activity: new Map([
        [ORG_UID, 2000],
        [UID_B, 1000],
      ]),
    });
    await expect(first.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });

    const changed = twoEmployers({
      activity: new Map([
        [ORG_UID, 1000],
        [UID_B, 9000],
      ]),
      emails: ['dev@acme-motors.example', 'dev@zeta-holdings.example', 'dev2@zeta-holdings.example'],
    });
    await expect(changed.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: UID_B } });
  });

  it('counts two work-history entries that name the same account once', async () => {
    const { svc, engagement } = build({
      experiences: [
        { id: 'a', organization: 'Acme Motors', organizationId: CDEV_ORG, startDate: 'Jan 2024', source: 'cdp-enriched' as const },
        { id: 'b', organization: 'Acme Motors Inc', organizationId: CDEV_B, startDate: 'Jan 2025', source: 'cdp-enriched' as const },
      ],
    });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    expect(engagement.getLastActivityByAccount).not.toHaveBeenCalled();
  });

  it('ignores a past employer even when it would otherwise qualify', async () => {
    const { svc } = build({
      experiences: [
        { id: 'a', organization: 'Acme Motors', organizationId: CDEV_ORG, startDate: 'Jan 2020', endDate: 'Dec 2025', source: 'cdp-enriched' as const },
      ],
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-employer' });
  });
});
