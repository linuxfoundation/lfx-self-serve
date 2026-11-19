// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsername, resolveVerifiedUserEmails, generateM2MToken, pinned, valkeyState } = vi.hoisted(() => ({
  pinned: new Map<string, unknown>(),
  valkeyState: { enabled: true, writeFails: false },
  generateM2MToken: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'employee'),
  resolveVerifiedUserEmails: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken }));
vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails }));
vi.mock('./valkey.service', () => ({
  buildPerUserOrgKey: (namespace: string, username: string, id: string) => `${namespace}:${username}:${id}`,
  valkeyService: {
    isEnabled: () => valkeyState.enabled,
    getJson: async (key: string) => (pinned.has(key) ? pinned.get(key) : null),
    setJson: async (key: string, value: unknown) => {
      if (!valkeyState.enabled || valkeyState.writeFails) return false;
      pinned.set(key, value);
      return true;
    },
  },
}));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { OrgEmployeeViewService, normalizeCompanyName } = await import('./org-employee-view.service');

const ORG_UID = '0016100000ACMEAAA1';
const UID_B = '0016100000ZETAAAA1';
const OTHER_UID = '0016100000OTHERAAA1';

const req = (): Request => ({ path: '/api/orgs/x/lens/overview' }) as unknown as Request;

type Doc = { name?: string; slug?: string; primary_domain?: string; domain_aliases?: string[]; is_member?: boolean };
const acme: Doc = { name: 'Acme Motors', primary_domain: 'acme-motors.example' };
const zeta: Doc = { name: 'Zeta Holdings', primary_domain: 'zeta-holdings.example' };

/** A work-history entry: present unless `endDate` is given. No crowd.dev organization id is involved. */
function job(organization: string, startDate = 'Jan 2024', endDate?: string) {
  return { id: `we-${organization}`, organization, jobTitle: 'Engineer', startDate, endDate, source: 'manual' as const };
}

function page(entries: Array<[string, Doc]>) {
  return { resources: entries.map(([uid, data]) => ({ id: `b2b_org:${uid}`, type: 'b2b_org', data })) };
}

interface Setup {
  experiences?: unknown;
  orgs?: Array<[string, Doc]> | Error;
  emails?: string[] | Error;
  auditor?: boolean | Error;
  activity?: Map<string, number>;
}

function build(opts: Setup = {}) {
  const orgs = opts.orgs ?? [[ORG_UID, acme]];
  const cdp = {
    getWorkExperiencesForKnownUser: vi
      .fn()
      .mockImplementation(() =>
        opts.experiences instanceof Error ? Promise.reject(opts.experiences) : Promise.resolve(opts.experiences ?? [job('Acme Motors')])
      ),
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
  const engagement = { getLastActivityByAccount: vi.fn().mockResolvedValue(opts.activity ?? new Map<string, number>()) };
  const svc = new OrgEmployeeViewService({
    cdp: cdp as never,
    emailVerification: {} as never,
    proxy: proxy as never,
    accessCheck: accessCheck as never,
    engagement: engagement as never,
  });
  return { svc, cdp, proxy, accessCheck, engagement };
}

beforeEach(() => {
  vi.clearAllMocks();
  pinned.clear();
  valkeyState.enabled = true;
  valkeyState.writeFails = false;
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
  it('admits a present employer whose company the verified email names, with nothing read from crowd.dev', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: true, org: { orgUid: ORG_UID, orgName: 'Acme Motors', orgSlug: null } });
  });

  it('names the company when no uid is asked for', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
  });

  it('matches the work-history employer name to the company name loosely', async () => {
    const { svc } = build({ experiences: [job('the ACME motors, inc.')] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('denies a caller with no work history', async () => {
    const { svc, proxy } = build({ experiences: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-employer' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('denies a caller whose only matching job has ended', async () => {
    const { svc } = build({ experiences: [job('Acme Motors', 'Jan 2020', 'Dec 2025')] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-employer' });
  });

  it('denies when no present employer names the company the email points to', async () => {
    const { svc } = build({ experiences: [job('Elsewhere Corp')] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'employer-mismatch' });
  });

  it('denies a caller with no verified email, without asking the query service', async () => {
    const { svc, proxy } = build({ emails: [] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
    expect(proxy.proxyRequest).not.toHaveBeenCalled();
  });

  it('never treats a personal mailbox provider as an employer', async () => {
    const { svc, proxy } = build({ emails: [`dev@${'gmail'}.com`] });

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

  it('re-checks every returned record, and ignores one the index marks as a non-member', async () => {
    const unrelated = build({ orgs: [[ORG_UID, { name: 'Acme Motors', primary_domain: 'unrelated.example' }]] });
    await expect(unrelated.svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });

    pinned.clear();
    const lapsed = build({ orgs: [[ORG_UID, { ...acme, is_member: false }]] });
    await expect(lapsed.svc.resolve(req(), ORG_UID)).resolves.toEqual({ eligible: false, reason: 'no-verified-company-email' });
  });

  it('matches any registered domain (primary or Salesforce alias) of the company', async () => {
    const { svc } = build({
      orgs: [[ORG_UID, { name: 'Acme Motors', primary_domain: 'acme-motors.example', domain_aliases: ['Acme-Group.example', 'bad host'] }]],
      emails: ['dev@eng.acme-group.example'],
    });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('denies a company other than the one the work history and email name, so editing the URL opens nothing', async () => {
    const { svc } = build();

    await expect(svc.resolve(req(), OTHER_UID)).resolves.toEqual({ eligible: false, reason: 'other-company' });
  });

  it('reports the company slug so a slug address can resolve', async () => {
    const { svc } = build({ orgs: [[ORG_UID, { ...acme, slug: 'Acme-Motors' }]] });

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true, org: { orgSlug: 'acme-motors' } });
  });

  it('reads companies with the BFF machine token and the work history without creating a CDP member', async () => {
    const { svc, proxy, cdp } = build();

    await svc.resolve(req(), ORG_UID);

    expect(proxy.proxyRequest.mock.calls[0][7]).toEqual({ bearerToken: 'm2m-token' });
    expect(cdp.getWorkExperiencesForKnownUser).toHaveBeenCalledWith(expect.anything(), 'employee');
  });

  it.each([
    ['the work history', { experiences: new Error('cdp down') }],
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
    const { svc, cdp } = build();

    await Promise.all([svc.resolve(req(), ORG_UID), svc.resolve(req(), null), svc.resolveReduced(req()), svc.resolve(req(), OTHER_UID)]);

    expect(cdp.getWorkExperiencesForKnownUser).toHaveBeenCalledTimes(1);
    expect(resolveVerifiedUserEmails).toHaveBeenCalledTimes(1);
  });

  it('resolves for the effective user, never the impersonating admin', async () => {
    getEffectiveUsername.mockReturnValue('impersonated-user');
    const { svc, cdp } = build();

    await svc.resolve(req(), ORG_UID);

    expect(cdp.getWorkExperiencesForKnownUser).toHaveBeenCalledWith(expect.anything(), 'impersonated-user');
    expect(resolveVerifiedUserEmails).toHaveBeenCalledWith(expect.anything(), expect.anything(), { strict: true });
  });

  it('denies a request with no effective username', async () => {
    getEffectiveUsername.mockReturnValue(null as never);
    const { svc } = build();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: false });
  });
});

describe('OrgEmployeeViewService with several qualifying companies', () => {
  const both: Array<[string, Doc]> = [
    [ORG_UID, acme],
    [UID_B, zeta],
  ];
  const emails = ['dev@acme-motors.example', 'dev@zeta-holdings.example'];

  it('chooses the company with the most recent engagement and cuts the other off', async () => {
    const { svc } = build({
      orgs: both,
      emails,
      experiences: [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Jan 2025')],
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
    const { svc } = build({ orgs: both, emails, experiences: [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Mar 2025')] });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: UID_B } });
  });

  it('considers only companies the work history names: the one with a present entry wins even if the other is newer', async () => {
    const { svc } = build({ orgs: both, emails, experiences: [job('Acme Motors', 'Jan 2020')] });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    await expect(svc.resolve(req(), UID_B)).resolves.toEqual({ eligible: false, reason: 'other-company' });
  });

  it('pins the choice: later activity elsewhere does not move it while employers and emails are unchanged', async () => {
    const experiences = [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Jan 2025')];
    const first = build({
      orgs: both,
      emails,
      experiences,
      activity: new Map([
        [ORG_UID, 2000],
        [UID_B, 1000],
      ]),
    });
    await expect(first.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });

    const later = build({
      orgs: both,
      emails,
      experiences,
      activity: new Map([
        [ORG_UID, 1000],
        [UID_B, 9000],
      ]),
    });
    await expect(later.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });
    expect(later.engagement.getLastActivityByAccount).not.toHaveBeenCalled();
  });

  it('re-chooses when a verified email changes', async () => {
    const experiences = [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Jan 2025')];
    const first = build({
      orgs: both,
      emails,
      experiences,
      activity: new Map([
        [ORG_UID, 2000],
        [UID_B, 1000],
      ]),
    });
    await first.svc.resolve(req(), null);

    const changed = build({
      orgs: both,
      emails: [...emails, 'dev2@zeta-holdings.example'],
      experiences,
      activity: new Map([
        [ORG_UID, 1000],
        [UID_B, 9000],
      ]),
    });
    await expect(changed.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: UID_B } });
  });

  it('re-chooses when the work history changes', async () => {
    const first = build({
      orgs: both,
      emails,
      experiences: [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Jan 2025')],
      activity: new Map([
        [ORG_UID, 2000],
        [UID_B, 1000],
      ]),
    });
    await first.svc.resolve(req(), null);

    const changed = build({
      orgs: both,
      emails,
      experiences: [job('Zeta Holdings', 'Jan 2025'), job('Acme Motors', 'Jan 2024'), job('Side Project Ltd')],
      activity: new Map([
        [ORG_UID, 1000],
        [UID_B, 9000],
      ]),
    });
    await expect(changed.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: UID_B } });
  });

  it('rejects with a 503, and never chooses an unpinned company, when the pin cannot be stored', async () => {
    const experiences = [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Jan 2025')];
    valkeyState.writeFails = true;
    const failing = build({ orgs: both, emails, experiences });
    await expect(failing.svc.resolve(req(), null)).rejects.toMatchObject({ statusCode: 503, code: 'ROLE_GRANTS_UNAVAILABLE' });

    valkeyState.writeFails = false;
    valkeyState.enabled = false;
    const disabled = build({ orgs: both, emails, experiences });
    await expect(disabled.svc.resolve(req(), null)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('does not need the pin store for a single qualifying company', async () => {
    valkeyState.enabled = false;
    const { svc } = build();

    await expect(svc.resolve(req(), ORG_UID)).resolves.toMatchObject({ eligible: true });
  });

  it('replaces a pin that no longer qualifies and persists the replacement, so later activity cannot move it again', async () => {
    const third: Array<[string, Doc]> = [...both, [OTHER_UID, { name: 'Other Works', primary_domain: 'other-works.example' }]];
    const threeEmails = [...emails, 'dev@other-works.example'];
    const experiences = [job('Acme Motors', 'Jan 2024'), job('Zeta Holdings', 'Jan 2025'), job('Other Works', 'Jan 2023')];
    const first = build({
      orgs: third,
      emails: threeEmails,
      experiences,
      activity: new Map([
        [ORG_UID, 3000],
        [UID_B, 2000],
        [OTHER_UID, 1000],
      ]),
    });
    await expect(first.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: ORG_UID } });

    // Acme stops being a member (same fingerprint: same employers and emails). The replacement is ranked once and stored.
    const second = build({
      orgs: [third[1], third[2]],
      emails: threeEmails,
      experiences,
      activity: new Map([
        [UID_B, 2000],
        [OTHER_UID, 1000],
      ]),
    });
    await expect(second.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: UID_B } });

    const later = build({
      orgs: [third[1], third[2]],
      emails: threeEmails,
      experiences,
      activity: new Map([
        [UID_B, 1000],
        [OTHER_UID, 9000],
      ]),
    });
    await expect(later.svc.resolve(req(), null)).resolves.toMatchObject({ org: { orgUid: UID_B } });
    expect(later.engagement.getLastActivityByAccount).not.toHaveBeenCalled();
  });

  it('counts two entries naming the same company once', async () => {
    const { svc, engagement } = build({ experiences: [job('Acme Motors', 'Jan 2024'), job('The Acme Motors Inc', 'Jan 2025')] });

    await expect(svc.resolve(req(), null)).resolves.toMatchObject({ eligible: true, org: { orgUid: ORG_UID } });
    expect(engagement.getLastActivityByAccount).not.toHaveBeenCalled();
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
    const { svc, cdp } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), g)).resolves.toEqual({});
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });

  it('publishes the full-access company, not an employee view, for a caller who also holds the auditor entitlement', async () => {
    const { svc } = build({ auditor: true });

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({ fullAccessOrgUid: ORG_UID });
  });

  it('answers nothing, not an error, when the lookup fails or the caller does not qualify', async () => {
    const failing = build({ experiences: new Error('cdp down') });
    await expect(failing.svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});

    const none = build({ experiences: [] });
    await expect(none.svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
  });

  it('is a no-op with the flag off', async () => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = '';
    const { svc, cdp } = build();

    await expect(svc.getRoleGrantEmployeeView(req(), grants())).resolves.toEqual({});
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });
});
