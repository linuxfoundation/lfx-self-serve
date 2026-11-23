// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsername, resolveVerifiedUserEmails, generateM2MToken, loggerWarning } = vi.hoisted(() => ({
  loggerWarning: vi.fn(),
  generateM2MToken: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'employee'),
  resolveVerifiedUserEmails: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: loggerWarning, error: vi.fn(), debug: vi.fn() } }));

const { OrgEmployeeViewService, normalizeCompanyName } = await import('./org-employee-view.service');

const ORG_UID = '0016100000ACMEAAA1';
const OTHER_UID = '0016100000OTHERAAA1';

const req = (): Request => ({ path: '/api/orgs/x/lens/overview' }) as unknown as Request;

interface Doc {
  name?: string;
  slug?: string;
  primary_domain?: string;
  domain_aliases?: string[];
  is_member?: boolean;
}
/** A work-history entry: present unless `endDate` is given. */
function job(organization: string, startDate = 'Jan 2024', endDate?: string) {
  return { id: `we-${organization}`, organization, jobTitle: 'Engineer', startDate, endDate, source: 'manual' as const };
}

const acme: Doc = { name: 'Acme Motors', is_member: true, primary_domain: 'acme-motors.example' };

function page(entries: [string, Doc][]) {
  return { resources: entries.map(([uid, data]) => ({ id: `b2b_org:${uid}`, type: 'b2b_org', data })) };
}

interface Setup {
  /** The individual work history; an Error is an outage. */
  experiences?: unknown;
  orgs?: [string, Doc][] | Error;
  emails?: string[] | Error;
  auditor?: boolean | Error;
  grants?: [string, unknown][];
  staff?: boolean;
}

function build(opts: Setup = {}) {
  const orgs = opts.orgs ?? [[ORG_UID, acme]];
  const experiences = opts.experiences === undefined ? [job('Acme Motors')] : opts.experiences;
  const workHistory = {
    getWorkExperiencesForKnownUser: vi
      .fn()
      .mockImplementation(() => (experiences instanceof Error ? Promise.reject(experiences) : Promise.resolve(experiences))),
  };
  const proxy = { proxyRequest: vi.fn().mockImplementation(() => (orgs instanceof Error ? Promise.reject(orgs) : Promise.resolve(page(orgs)))) };
  resolveVerifiedUserEmails.mockImplementation(() =>
    opts.emails instanceof Error ? Promise.reject(opts.emails) : Promise.resolve(opts.emails ?? ['dev@acme-motors.example'])
  );
  const accessCheck = {
    checkSingleAccessStrict: vi
      .fn()
      .mockImplementation(() => (opts.auditor instanceof Error ? Promise.reject(opts.auditor) : Promise.resolve(opts.auditor ?? false))),
  };
  const roster = { resolved: new Map(opts.grants ?? []), isStaff: opts.staff ?? false, upstreamFailed: false, degraded: false, staffCheck: 'ok' };
  const roleGrants = { getAccessAwareOrgs: vi.fn().mockResolvedValue(roster) };
  const svc = new OrgEmployeeViewService({
    roleGrants: roleGrants as never,
    workHistory: workHistory as never,
    emailVerification: {} as never,
    proxy: proxy as never,
    accessCheck: accessCheck as never,
  });
  return { svc, workHistory, proxy, accessCheck, roleGrants };
}

beforeEach(() => {
  vi.clearAllMocks();
  OrgEmployeeViewService.clearCache();
  getEffectiveUsername.mockReturnValue('employee');
  generateM2MToken.mockResolvedValue('m2m-token');
});

describe('normalizeCompanyName', () => {
  it.each([
    ['The Linux Foundation', 'linux foundation'],
    ['Linux Foundation', 'linux foundation'],
    ['Acme Motors, Inc.', 'acme motors'],
    ['ACME  Motors LLC', 'acme motors'],
    ['Zürich & Sons Ltd', 'zurich and sons'],
    ['Inc', 'inc'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  it('handles null and undefined', () => {
    expect(normalizeCompanyName(null)).toBe('');
    expect(normalizeCompanyName(undefined)).toBe('');
  });
});

describe('OrgEmployeeViewService.resolve', () => {
  it('admits a caller with a validated email on a member company domain and that company as a present employer in their work history, using no CDP organization id or engagement data', async () => {
    const { svc, workHistory } = build();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: true, org: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null } });
    expect(workHistory.getWorkExperiencesForKnownUser).toHaveBeenCalledWith(expect.anything(), 'employee');
  });

  it('names the company when no uid is asked for', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
  });

  it('matches the work-history employer name to the company name loosely', async () => {
    const { svc } = build({ experiences: [job('the ACME motors, inc.')] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('denies a caller with no work history, without asking the query service', async () => {
    const { svc, proxy } = build({ experiences: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-employer' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('denies a caller whose only matching job has ended', async () => {
    const { svc } = build({ experiences: [job('Acme Motors', 'Jan 2020', 'Dec 2025')] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-employer' });
  });

  it('denies when no present employer is the company the email names', async () => {
    const { svc } = build({ experiences: [job('Elsewhere Corp')] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'employer-mismatch' });
  });

  it('denies a caller with no validated email, without asking the query service', async () => {
    const { svc, proxy } = build({ emails: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('never treats a personal mailbox provider as an employer', async () => {
    const { svc, proxy } = build({ emails: ['dev@gmail.example'] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('never treats the Linux.com forwarding alias as an employer', async () => {
    const { svc, proxy } = build({ emails: [`dev@${'linux'}.com`, `dev@mail.${'linux'}.com`] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('denies when the email matches no active-member company', async () => {
    const { svc } = build({ orgs: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('asks only for active-member companies matching the address domains', async () => {
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

  it('asks in batches and drops no candidate domain when the caller has many addresses', async () => {
    const many = Array.from({ length: 25 }, (_v, i) => `dev@corp-${i}.example`);
    const { svc, proxy } = build({ emails: [...many, 'dev@acme-motors.example'] });
    proxy.proxyRequest.mockImplementation((_r: unknown, _s: string, _p: string, _m: string, params: { filters_or: string[] }) =>
      Promise.resolve(params.filters_or.includes('primary_domain:acme-motors.example') ? page([[ORG_UID, acme]]) : page([]))
    );

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    // 26 candidate domains in batches of 20, every one asked about.
    expect(proxy.proxyRequest).toHaveBeenCalledTimes(2);
    const asked = proxy.proxyRequest.mock.calls
      .flatMap((call) => (call[4] as { filters_or: string[] }).filters_or)
      .filter((f: string) => f.startsWith('primary_domain:'));
    expect(asked).toHaveLength(26);
  });

  it('re-checks every returned record, and ignores one the index marks as a non-member', async () => {
    const unrelated = build({ orgs: [[ORG_UID, { name: 'Acme Motors', is_member: true, primary_domain: 'unrelated.example' }]] });
    await expect(unrelated.svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });

    OrgEmployeeViewService.clearCache();
    const lapsed = build({ orgs: [[ORG_UID, { ...acme, is_member: false }]] });
    await expect(lapsed.svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('matches any registered domain (primary or Salesforce alias) of the company', async () => {
    const { svc } = build({
      orgs: [[ORG_UID, { name: 'Acme Motors', is_member: true, primary_domain: 'acme-motors.example', domain_aliases: ['Acme-Group.example', 'bad host'] }]],
      emails: ['dev@eng.acme-group.example'],
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('denies a company other than the one the email and profile name, so editing the URL opens nothing', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), OTHER_UID)).resolves.toEqual({ eligible: false, reason: 'other-company' });
  });

  describe('with several companies the email and work history both name', () => {
    const zeta = { name: 'Zeta Holdings', is_member: true, primary_domain: 'zeta-holdings.example' };
    const both: [string, Doc][] = [
      [ORG_UID, acme],
      [OTHER_UID, zeta],
    ];
    const emails = ['dev@acme-motors.example', 'dev@zeta-holdings.example'];

    it('grants only the company whose present entry has the most recent start date, and cuts the other off', async () => {
      const { svc } = build({ orgs: both, emails, experiences: [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Mar 2025')] });

      await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: OTHER_UID } });
      await expect(svc.resolve(req(), OTHER_UID)).resolves.toMatchObject({ eligible: true });
      await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'other-company' });
    });

    it('compares the start dates, not the order of the entries', async () => {
      const { svc } = build({ orgs: both, emails, experiences: [job('Zeta Holdings', 'Mar 2025'), job('Acme Motors', 'Jun 2025')] });

      await expect(svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    });

    it('considers only companies the email also names: the other present employer does not compete', async () => {
      const { svc } = build({
        orgs: both,
        emails: ['dev@acme-motors.example'],
        experiences: [job('Acme Motors', 'Jan 2020'), job('Zeta Holdings', 'Nov 2026')],
      });

      await expect(svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    });

    it('ignores an ended entry even if it is the most recent: only present entries compete', async () => {
      const { svc } = build({ orgs: both, emails, experiences: [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Nov 2026', 'Nov 2026')] });

      await expect(svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    });

    it('uses the latest start when two entries name the same company', async () => {
      const { svc } = build({
        orgs: both,
        emails,
        experiences: [job('Acme Motors', 'Jan 2020'), job('The Acme Motors Inc', 'Sep 2025'), job('Zeta Holdings', 'Mar 2025')],
      });

      await expect(svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    });

    it('follows a change of employer at the next lookup: nothing is pinned', async () => {
      const first = build({ orgs: both, emails, experiences: [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Mar 2025')] });
      await expect(first.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: OTHER_UID } });

      OrgEmployeeViewService.clearCache();
      const left = build({ orgs: both, emails, experiences: [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Mar 2025', 'Dec 2025')] });
      await expect(left.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    });

    it('resolves a tie on start date to the first company in stable order (name, then uid)', async () => {
      const { svc } = build({ orgs: both, emails, experiences: [job('Zeta Holdings', 'Jan 2025'), job('Acme Motors', 'Jan 2025')] });

      await expect(svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    });
  });

  it('reports the company slug so a slug address can resolve', async () => {
    const { svc } = build({ orgs: [[ORG_UID, { ...acme, slug: 'Acme-Motors' }]] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true, org: { orgSlug: 'acme-motors' } });
  });

  it('reads companies with the BFF machine token, not the caller token', async () => {
    const { svc, proxy } = build();

    await svc.resolve(req(), ORG_UID);

    expect(proxy.proxyRequest.mock.calls[0][7]).toEqual({ bearerToken: 'm2m-token' });
  });

  it.each([
    ['the work-history read', { experiences: new Error('cdp down') }],
    ['the verified email lookup', { emails: new Error('auth-service down') }],
    ['the company lookup', { orgs: new Error('query-service down') }],
  ])('rejects, never denies, when %s fails', async (_label, setup) => {
    const { svc } = build(setup as Setup);

    await expect(svc.resolve(req(), ORG_UID)).rejects.toBeInstanceOf(Error);
  });

  it('rejects, and does not keep a denial, when the machine token cannot be minted', async () => {
    generateM2MToken.mockRejectedValueOnce(new Error('auth0 down'));
    const { svc } = build();

    await expect(svc.resolve(req(), ORG_UID)).rejects.toBeInstanceOf(Error);
    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('shares ONE lookup between the specific-company and unscoped calls of one page', async () => {
    const { svc, workHistory } = build();

    await Promise.all([svc.resolve(req(), ORG_UID), svc.resolve(req(), null), svc.resolveReduced(req()), svc.resolve(req(), OTHER_UID)]);

    expect(workHistory.getWorkExperiencesForKnownUser).toHaveBeenCalledTimes(1);
    expect(resolveVerifiedUserEmails).toHaveBeenCalledTimes(1);
  });

  it('shares one lookup across separately constructed services, as the gate, controller, navigation and resolver each build their own', async () => {
    const a = build();
    const b = build();

    await Promise.all([a.svc.resolve(req(), ORG_UID), b.svc.resolve(req(), null)]);

    expect(a.workHistory.getWorkExperiencesForKnownUser.mock.calls.length + b.workHistory.getWorkExperiencesForKnownUser.mock.calls.length).toBe(1);
  });

  it('resolves for the effective user, never the impersonating admin', async () => {
    getEffectiveUsername.mockReturnValue('impersonated-user');
    const { svc, workHistory } = build();

    await svc.resolve(req(), ORG_UID);

    expect(workHistory.getWorkExperiencesForKnownUser).toHaveBeenCalledWith(expect.anything(), 'impersonated-user');
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

  it('reports the company for a grant-less employee', async () => {
    const { svc } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({
      employeeView: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null },
    });
  });

  it('needs no affiliation verdict, so a contractor takes the same path', async () => {
    const { svc } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), grants({ isContractor: true }))).resolves.toMatchObject({ employeeView: { orgUid: ORG_UID } });
  });

  it.each([
    ['a grant holder', grants({ writers: [ORG_UID] })],
    ['LF staff', grants({ isStaff: true })],
    ['a partial roster', grants({ lookupOutcome: 'partial' })],
  ])('asks nothing for %s', async (_label, g) => {
    const { svc, workHistory } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), g)).resolves.toEqual({});
    expect(workHistory.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });

  it('publishes the full-access company, not an employee view, for a caller who also holds the auditor entitlement', async () => {
    const { svc } = build({ auditor: true });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({ fullAccessOrgUid: ORG_UID });
  });

  it('reports a failed lookup as failed, so the client can offer Retry, and answers nothing for a caller who does not qualify', async () => {
    const failing = build({ experiences: new Error('cdp down') });
    await expect(failing.svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({ employeeViewLookup: 'failed' });

    OrgEmployeeViewService.clearCache();
    const none = build({ experiences: [] });
    await expect(none.svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
  });

  it('is a no-op with the flag off', async () => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = '';
    const { svc, workHistory } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
    expect(workHistory.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });
});

describe('OrgEmployeeViewService entry rule: no grants and not staff', () => {
  it('denies a caller who holds a grant without looking at work history or emails', async () => {
    const { svc, workHistory } = build({ grants: [[OTHER_UID, { roleSource: 'direct-writer' }]] });

    await expect(svc.resolveReduced(req())).resolves.toEqual({ eligible: false, reason: 'has-grants' });
    expect(workHistory.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });

  it('denies LF staff without looking at work history', async () => {
    const { svc, workHistory } = build({ staff: true });

    await expect(svc.resolveReduced(req())).resolves.toEqual({ eligible: false, reason: 'has-grants' });
    expect(workHistory.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });

  it('answers a retriable 503 when the roster could not be read, never a denial', async () => {
    const { svc, roleGrants } = build();
    roleGrants.getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), isStaff: false, upstreamFailed: true, degraded: false, staffCheck: 'ok' });

    await expect(svc.resolveReduced(req())).rejects.toMatchObject({ statusCode: 503, code: 'ROLE_GRANTS_UNAVAILABLE' });
  });
});

describe('OrgEmployeeViewService consumer mail and logging', () => {
  it('never treats a consumer ISP mailbox as an employer', async () => {
    const { svc, proxy } = build({ emails: [`dev@${'comcast'}.net`] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('logs a warning when the member-company lookup returns no rows at all', async () => {
    const { svc } = build({ orgs: [] });

    await svc.resolve(req(), ORG_UID);

    expect(loggerWarning).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining('no rows'), expect.anything());
  });
});

describe('OrgEmployeeViewService cache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one caller’s answer apart from another’s', async () => {
    const first = build({ experiences: [job('Acme Motors')] });
    getEffectiveUsername.mockReturnValue('alice');
    await expect(first.svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });

    const second = build({ experiences: [] });
    getEffectiveUsername.mockReturnValue('bob');
    await expect(second.svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: false });
    getEffectiveUsername.mockReturnValue('alice');
    await expect(second.svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('recomputes after the TTL', async () => {
    vi.useFakeTimers();
    const { svc, workHistory } = build();

    await svc.resolve(req(), ORG_UID);
    vi.setSystemTime(Date.now() + 61_000);
    await svc.resolve(req(), ORG_UID);

    expect(workHistory.getWorkExperiencesForKnownUser).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry once the cache is full', async () => {
    const { svc, workHistory } = build();
    for (let i = 0; i <= 1000; i++) {
      getEffectiveUsername.mockReturnValue(`user-${i}`);
      await svc.resolve(req(), ORG_UID);
    }
    workHistory.getWorkExperiencesForKnownUser.mockClear();

    getEffectiveUsername.mockReturnValue('user-1000');
    await svc.resolve(req(), ORG_UID);
    expect(workHistory.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
    getEffectiveUsername.mockReturnValue('user-0');
    await svc.resolve(req(), ORG_UID);
    expect(workHistory.getWorkExperiencesForKnownUser).toHaveBeenCalledTimes(1);
  });
});

describe('OrgEmployeeViewService.getRoleGrantEmployeeView budget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a failed lookup, not a hang, when work history never answers', async () => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = 'true';
    vi.useFakeTimers();
    const { svc, workHistory } = build();
    workHistory.getWorkExperiencesForKnownUser.mockImplementation(() => new Promise(() => undefined));

    const pending = svc.getRoleGrantEmployeeView(req(), {
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
    } as RoleGrantsResponse);
    await vi.advanceTimersByTimeAsync(5_100);

    await expect(pending).resolves.toEqual({ employeeViewLookup: 'failed' });
  });
});
