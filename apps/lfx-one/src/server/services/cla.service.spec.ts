// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runtime collaborators are mocked (the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config; cla.service imports only type-only symbols from it, which esbuild elides).
const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
const { getEffectiveEmail, getEffectiveSub, getEffectiveUsername, isImpersonating } = vi.hoisted(() => ({
  getEffectiveEmail: vi.fn<() => string | null>(() => null),
  getEffectiveSub: vi.fn<() => string | null>(() => null),
  getEffectiveUsername: vi.fn<() => string | null>(() => null),
  isImpersonating: vi.fn<() => boolean>(() => false),
}));
const { getUserIdentities } = vi.hoisted(() => ({ getUserIdentities: vi.fn(async () => [] as unknown[]) }));
const { getUserEmails } = vi.hoisted(() => ({ getUserEmails: vi.fn(async () => null as unknown) }));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail, getEffectiveSub, getEffectiveUsername, isImpersonating }));
vi.mock('./auth0.service', () => ({
  Auth0Service: class {
    public getUserIdentities = getUserIdentities;
  },
}));
vi.mock('./email-verification.service', () => ({
  EmailVerificationService: class {
    public getUserEmails = getUserEmails;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import type { EasyClaMyCla, ResolvedClaIdentity } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { ClaService, claReturnUrl, claServiceBaseUrl, collectClaEmails, normalizeGithubId, toMyClaAgreement } from './cla.service';

const req = {} as unknown as Request;

/** Request stub exposing only what `claReturnUrl` reads. */
function reqWithHost(host: string | undefined, protocol = 'https'): Request {
  return { protocol, get: (name: string) => (name === 'host' ? host : undefined) } as unknown as Request;
}

/** Minimal ICLA record from `/v4/my-clas`. */
function icla(overrides: Partial<EasyClaMyCla> = {}): EasyClaMyCla {
  return {
    signatureID: 's-icla',
    claType: 'icla',
    approved: true,
    valid: true,
    status: 'valid',
    pdfAvailable: true,
    claGroupID: 'cg-1',
    signedOn: '2022-01-01',
    ...overrides,
  };
}

/** Minimal valid ECLA record from `/v4/my-clas`. */
function ecla(overrides: Partial<EasyClaMyCla> = {}): EasyClaMyCla {
  return {
    signatureID: 's-ecla',
    claType: 'ecla',
    approved: true,
    valid: true,
    status: 'valid',
    companyName: 'Acme',
    claGroupID: 'cg-2',
    signedOn: '2022-02-02',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but not return-value overrides — restore identity
  // helper defaults so a value set in one test does not leak into the next.
  getEffectiveUsername.mockReturnValue(null);
  getEffectiveEmail.mockReturnValue(null);
  getEffectiveSub.mockReturnValue(null);
  isImpersonating.mockReturnValue(false);
  getUserIdentities.mockResolvedValue([]);
  getUserEmails.mockResolvedValue(null);
  process.env['API_GW_AUDIENCE'] = 'https://api-gw.dev.example.org/';
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('claServiceBaseUrl', () => {
  it('derives the cla-service base url from API_GW_AUDIENCE, trimming trailing slashes', () => {
    expect(claServiceBaseUrl()).toBe('https://api-gw.dev.example.org/cla-service');
  });

  it('throws when API_GW_AUDIENCE is not configured', () => {
    delete process.env['API_GW_AUDIENCE'];
    expect(() => claServiceBaseUrl()).toThrow(MicroserviceError);
  });
});

describe('claReturnUrl', () => {
  it('builds an absolute URL to the CLAs view from the request origin', () => {
    expect(claReturnUrl(reqWithHost('app.dev.lfx.dev'))).toBe('https://app.dev.lfx.dev/profile/clas');
  });

  it('is absolute, never relative — the final hop is a redirect issued by the CLA API', () => {
    const url = claReturnUrl(reqWithHost('app.dev.lfx.dev'));

    expect(url.startsWith('https://')).toBe(true);
    expect(url.startsWith('/')).toBe(false);
  });

  it('uses the forwarded protocol rather than assuming https (trust proxy is set)', () => {
    expect(claReturnUrl(reqWithHost('localhost:4200', 'http'))).toBe('http://localhost:4200/profile/clas');
  });

  it('keeps a non-default port, so local and preview hosts stay reachable', () => {
    expect(claReturnUrl(reqWithHost('ui-pr-1440.dev.v2.cluster.linuxfound.info:8443'))).toBe(
      'https://ui-pr-1440.dev.v2.cluster.linuxfound.info:8443/profile/clas'
    );
  });

  it('throws rather than emitting a host-less URL when the Host header is missing', () => {
    expect(() => claReturnUrl(reqWithHost(undefined))).toThrow(MicroserviceError);
  });

  it('accepts the production origin', () => {
    expect(claReturnUrl(reqWithHost('app.lfx.dev'))).toBe('https://app.lfx.dev/profile/clas');
  });

  it('refuses a forged Host rather than handing EasyCLA a foreign origin', () => {
    // EasyCLA stores this value and later redirects to it verbatim, so an unchecked Host would
    // make a trusted hand-off into an open redirect.
    expect(() => claReturnUrl(reqWithHost('evil.example.com'))).toThrow(MicroserviceError);
  });

  it('refuses a look-alike host that merely contains a trusted one', () => {
    expect(() => claReturnUrl(reqWithHost('app.lfx.dev.evil.example.com'))).toThrow(MicroserviceError);
    expect(() => claReturnUrl(reqWithHost('notapp.lfx.dev'))).toThrow(MicroserviceError);
  });

  it('refuses a preview-shaped host on the wrong domain', () => {
    expect(() => claReturnUrl(reqWithHost('ui-pr-1440.dev.v2.cluster.evil.example.com'))).toThrow(MicroserviceError);
  });

  it('refuses a Host carrying userinfo that would resolve elsewhere', () => {
    expect(() => claReturnUrl(reqWithHost('app.lfx.dev@evil.example.com'))).toThrow(MicroserviceError);
  });

  it('refuses a protocol that is neither http nor https', () => {
    expect(() => claReturnUrl(reqWithHost('app.lfx.dev', 'javascript'))).toThrow(MicroserviceError);
  });
});

describe('normalizeGithubId', () => {
  it('accepts a bare numeric id', () => {
    expect(normalizeGithubId('13434323')).toBe('13434323');
  });

  it('strips a github| prefix', () => {
    expect(normalizeGithubId('github|13434323')).toBe('13434323');
  });

  it('rejects non-numeric values', () => {
    expect(normalizeGithubId('github|not-a-number')).toBeNull();
    expect(normalizeGithubId('octocat')).toBeNull();
  });
});

describe('collectClaEmails', () => {
  it('returns just the session primary when no other source is available', () => {
    expect(collectClaEmails('alice@x.org', null, [])).toEqual(['alice@x.org']);
  });

  it('returns an empty set when there is no email anywhere', () => {
    expect(collectClaEmails(null, null, [])).toEqual([]);
  });

  it('unions the session primary, the verified email list and linked-identity emails, deduped case-insensitively', () => {
    const emailData = {
      primary_email: 'alice@x.org',
      alternate_emails: [
        { email: 'alice@work.com', verified: true },
        { email: 'Alice@Work.com', verified: true }, // case-dup of the above
      ],
    };
    const identities = [
      { provider: 'github', user_id: 'github|1', connection: 'github', profileData: { email: 'octo@users.noreply.github.com' } },
      { provider: 'email', user_id: 'email|1', connection: 'email', profileData: { email: 'ALICE@x.org' } }, // dup of primary
    ];

    expect(collectClaEmails('alice@x.org', emailData as never, identities as never)).toEqual([
      'alice@x.org',
      'alice@work.com',
      'octo@users.noreply.github.com',
    ]);
  });

  it('excludes unverified alternate emails (verified !== true)', () => {
    const emailData = {
      primary_email: 'alice@x.org',
      alternate_emails: [
        { email: 'unverified@x.org', verified: false },
        { email: 'verified@x.org', verified: true },
      ],
    };

    expect(collectClaEmails('alice@x.org', emailData as never, [])).toEqual(['alice@x.org', 'verified@x.org']);
  });

  it('caps the set at the upstream 100-email limit, keeping the session primary first', () => {
    // 150 unique verified alternates would blow past `/v4/my-clas`'s maxItems:100 and 400 the request.
    const emailData = {
      primary_email: 'primary@x.org',
      alternate_emails: Array.from({ length: 150 }, (_, i) => ({ email: `alt${i}@x.org`, verified: true })),
    };

    const result = collectClaEmails('primary@x.org', emailData as never, []);

    expect(result).toHaveLength(100);
    expect(result[0]).toBe('primary@x.org'); // primary priority preserved
  });
});

describe('toMyClaAgreement', () => {
  it('maps an ICLA, trusting upstream valid=true ⇒ status valid, pdfAvailable', () => {
    const a = toMyClaAgreement(icla({ documentMajorVersion: 2, documentMinorVersion: 1 }));
    expect(a).toMatchObject({ id: 's-icla', kind: 'ICLA', pdfAvailable: true, status: 'valid', documentVersion: '2.1' });
  });

  it('copies status and statusReason from the producer', () => {
    expect(toMyClaAgreement(icla({ status: 'valid' })).status).toBe('valid');
    expect(toMyClaAgreement(icla({ status: 'invalidated', approved: false, valid: false })).status).toBe('invalidated');
    expect(toMyClaAgreement(ecla({ status: 'valid' })).status).toBe('valid');
    expect(toMyClaAgreement(ecla({ status: 'invalidated', approved: false, valid: false })).status).toBe('invalidated');

    const listMiss = toMyClaAgreement(ecla({ status: 'needs_attention', statusReason: 'not_on_approval_list', approved: true, valid: false }));
    expect(listMiss.status).toBe('needs_attention');
    expect(listMiss.statusReason).toBe('not_on_approval_list');

    const unknown = toMyClaAgreement(ecla({ status: 'unknown', statusReason: 'unknown', approved: true, valid: false }));
    expect(unknown.status).toBe('unknown');
    expect(unknown.statusReason).toBe('unknown');
  });

  it('never maps an ICLA to needs_attention, even if a spurious reason is present', () => {
    const spurious = toMyClaAgreement(icla({ status: 'needs_attention', statusReason: 'not_on_approval_list' }));
    expect(spurious.status).not.toBe('needs_attention');
    expect(spurious.statusReason).toBeUndefined();

    const unknown = toMyClaAgreement(icla({ status: 'unknown', statusReason: 'unknown', approved: false, valid: false }));
    expect(unknown.status).not.toBe('unknown');
    expect(unknown.status).not.toBe('needs_attention');
    expect(unknown.statusReason).toBeUndefined();
  });

  // The wire type declares the four producer values, so an out-of-contract status can only arrive
  // from a producer that broke the contract. It still has to be survivable: `claStatusLabel` and
  // `claStatusSeverity` are exhaustive switches with no default, so an unrecognised value reaching
  // the template renders a pill with no label and no severity.
  it('degrades an out-of-contract status to unknown and drops the reason it shipped with', () => {
    const bogus = toMyClaAgreement(ecla({ status: 'retired' as EasyClaMyCla['status'], statusReason: 'not_on_approval_list', approved: true, valid: false }));

    expect(bogus.status).toBe('unknown');
    // Otherwise the row pairs an em dash with a sentence explaining a coverage miss.
    expect(bogus.statusReason).toBeUndefined();
  });

  it('degrades an absent or empty status to unknown', () => {
    expect(toMyClaAgreement(ecla({ status: undefined as unknown as EasyClaMyCla['status'] })).status).toBe('unknown');
    expect(toMyClaAgreement(ecla({ status: '' as EasyClaMyCla['status'] })).status).toBe('unknown');
  });

  it('collapses an out-of-contract ICLA status to the binary ICLA standing', () => {
    expect(toMyClaAgreement(icla({ status: 'retired' as EasyClaMyCla['status'], approved: true })).status).toBe('valid');
    expect(toMyClaAgreement(icla({ status: 'retired' as EasyClaMyCla['status'], approved: false })).status).toBe('invalidated');
  });

  // Declared in ClaStatus but not produced today; accepted so the producer can ship it without a
  // consumer change, and specifically NOT degraded to unknown.
  it('passes superseded through untouched on an ECLA', () => {
    expect(toMyClaAgreement(ecla({ status: 'superseded' as EasyClaMyCla['status'] })).status).toBe('superseded');
  });

  it('maps an ECLA with company name and no pdf', () => {
    const a = toMyClaAgreement(ecla({ signingEntityName: 'Acme Inc' }));
    expect(a).toMatchObject({ kind: 'ECLA', companyName: 'Acme Inc', pdfAvailable: false });
  });

  it('prefers claGroupName, falling back to claGroupID', () => {
    expect(toMyClaAgreement(icla({ claGroupName: 'My Project', claGroupID: 'cg-1' })).claGroupName).toBe('My Project');
    expect(toMyClaAgreement(icla({ claGroupName: undefined, claGroupID: 'cg-1' })).claGroupName).toBe('cg-1');
  });

  it('surfaces the Salesforce projectName and projectLogo when upstream resolved them', () => {
    const a = toMyClaAgreement(icla({ projectName: 'Kubernetes', projectLogo: 'https://logos.example.org/k8s.png' }));
    expect(a.projectName).toBe('Kubernetes');
    expect(a.projectLogo).toBe('https://logos.example.org/k8s.png');
  });

  it('normalizes an unresolved (omitted or empty) projectName/projectLogo to undefined', () => {
    const omitted = toMyClaAgreement(icla({ projectName: undefined, projectLogo: undefined }));
    expect(omitted.projectName).toBeUndefined();
    expect(omitted.projectLogo).toBeUndefined();

    const empty = toMyClaAgreement(icla({ projectName: '', projectLogo: '' }));
    expect(empty.projectName).toBeUndefined();
    expect(empty.projectLogo).toBeUndefined();
  });

  it('never offers a PDF for an ICLA upstream marked pdfAvailable=false', () => {
    expect(toMyClaAgreement(icla({ pdfAvailable: false })).pdfAvailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

describe('ClaService.resolveIdentity', () => {
  it('resolves lfUsername, email and both GitHub id and username from the session', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|13434323', connection: 'github', profileData: { nickname: 'octocat' } }]);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity).toMatchObject({
      lfUsername: 'alice',
      emails: ['alice@x.org'],
      githubIds: ['13434323'],
      githubUsernames: ['octocat'],
      githubLinked: true,
    });
    // resolveIdentity does no upstream call of its own.
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('reports githubLinked=false and empty github keys when no GitHub identity is linked', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'google-oauth2', user_id: 'x', connection: 'google' }]);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.githubLinked).toBe(false);
    expect(identity.githubIds).toEqual([]);
    expect(identity.githubUsernames).toEqual([]);
  });

  it('drops a GitHub identity with a non-numeric id but keeps its username', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|nope', connection: 'github', profileData: { nickname: 'octocat' } }]);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.githubIds).toEqual([]);
    expect(identity.githubUsernames).toEqual(['octocat']);
    expect(identity.githubLinked).toBe(true);
  });

  it('degrades to username+email when the linked-identity lookup fails (e.g. NATS down)', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockRejectedValueOnce(new Error('NATS TIMEOUT'));

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity).toMatchObject({ lfUsername: 'alice', emails: ['alice@x.org'], githubIds: [], githubUsernames: [], githubLinked: false });
  });

  it('sends all verified emails: session primary + verified alternates + linked-identity emails, deduped (#1227)', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([
      { provider: 'github', user_id: 'github|13434323', connection: 'github', profileData: { nickname: 'octocat', email: 'octo@users.noreply.github.com' } },
    ]);
    getUserEmails.mockResolvedValueOnce({
      primary_email: 'alice@x.org',
      alternate_emails: [
        { email: 'alice@work.com', verified: true },
        { email: 'old@x.org', verified: false }, // unverified — dropped
      ],
    });

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.emails).toEqual(['alice@x.org', 'alice@work.com', 'octo@users.noreply.github.com']);
    expect(identity.githubIds).toEqual(['13434323']);
  });

  it('degrades to the session primary email only when the verified-email lookup returns null (auth-service down)', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([]);
    getUserEmails.mockResolvedValueOnce(null);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.emails).toEqual(['alice@x.org']);
  });
});

// ---------------------------------------------------------------------------
// getMyClas — /v4/my-clas passthrough
// ---------------------------------------------------------------------------

describe('ClaService.getMyClas', () => {
  it('passes the resolved identity keys to the /v4/my-clas query', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|13434323', connection: 'github', profileData: { nickname: 'octocat' } }]);
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'], clas: [] });

    await new ClaService().getMyClas(req);

    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    expect(calledUrl).toContain('/v4/my-clas?');
    expect(calledUrl).toContain('lfUsername=alice');
    expect(calledUrl).toContain('email=alice%40x.org');
    expect(calledUrl).toContain('githubId=13434323');
    expect(calledUrl).toContain('githubUsername=octocat');
  });

  it('FR-011 guard: a multi-email caller reaches the gateway with its GitHub keys present', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserEmails.mockResolvedValueOnce({
      primary_email: 'alice@x.org',
      alternate_emails: [
        { email: 'alice@work.com', verified: true },
        { email: 'alice@personal.com', verified: true },
      ],
    });
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|13434323', connection: 'github', profileData: { nickname: 'octocat' } }]);
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'], clas: [] });

    await new ClaService().getMyClas(req);

    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    const params = new URLSearchParams(calledUrl.slice(calledUrl.indexOf('?') + 1));
    expect(params.getAll('githubId')).toEqual(['13434323']);
    expect(params.getAll('githubUsername')).toEqual(['octocat']);
  });

  it('does not duplicate github keys on the single-email path (no-regression, FR-002)', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|13434323', connection: 'github', profileData: { nickname: 'octocat' } }]);
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'], clas: [] });

    await new ClaService().getMyClas(req);

    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    const params = new URLSearchParams(calledUrl.slice(calledUrl.indexOf('?') + 1));
    expect(params.getAll('email')).toEqual(['alice@x.org']);
    expect(params.getAll('githubId')).toEqual(['13434323']);
    expect(params.getAll('githubUsername')).toEqual(['octocat']);
  });

  it('under impersonation, forwards the TARGET user github keys with the target token (FR-009)', async () => {
    isImpersonating.mockReturnValue(true);
    // getEffective* return the *target* identity during impersonation.
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserEmails.mockResolvedValueOnce({
      primary_email: 'alice@x.org',
      alternate_emails: [
        { email: 'alice@work.com', verified: true },
        { email: 'alice@personal.com', verified: true },
      ],
    });
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|13434323', connection: 'github', profileData: { nickname: 'octocat' } }]);
    const imperReq = { bearerToken: 'target-token' } as unknown as Request;
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'], clas: [] });

    await new ClaService().getMyClas(imperReq);

    const [, calledUrl, opts] = gatewayFetch.mock.calls[0] as [unknown, string, { bearerToken?: string }];
    const params = new URLSearchParams(calledUrl.slice(calledUrl.indexOf('?') + 1));
    expect(params.getAll('githubId')).toContain('13434323');
    expect(params.getAll('githubUsername')).toContain('octocat');
    expect(opts.bearerToken).toBe('target-token'); // runs under the target's token, not the impersonator's
  });

  it('maps the upstream clas list and reports matched user ids', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1', 'u-2'], clas: [icla({ signatureID: 's1' }), ecla({ signatureID: 's2' })] });

    const result = await new ClaService().getMyClas(req);

    expect(result.agreements.map((a) => a.id)).toEqual(['s1', 's2']);
    expect(result.identity).toMatchObject({ matchedUserIds: 2, unmatched: false });
  });

  it('reports unmatched=true when upstream matches no user records', async () => {
    getEffectiveUsername.mockReturnValue('ghost');
    gatewayFetch.mockResolvedValueOnce({ userIds: [], clas: [] });

    const result = await new ClaService().getMyClas(req);

    expect(result.agreements).toEqual([]);
    expect(result.identity).toMatchObject({ matchedUserIds: 0, unmatched: true });
  });

  it('returns every row upstream sent, in order, including needs-attention and invalidated', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    gatewayFetch.mockResolvedValueOnce({
      userIds: ['u-1'],
      clas: [
        icla({ signatureID: 'valid-icla', approved: true, valid: true, status: 'valid' }),
        ecla({
          signatureID: 'needs-attn',
          approved: true,
          valid: false,
          status: 'needs_attention',
          statusReason: 'not_on_approval_list',
        }),
        icla({ signatureID: 'invalidated-icla', approved: false, valid: false, status: 'invalidated' }),
      ],
    });

    const result = await new ClaService().getMyClas(req);

    expect(result.agreements.map((a) => a.id)).toEqual(['valid-icla', 'needs-attn', 'invalidated-icla']);
    expect(result.agreements.map((a) => a.status)).toEqual(['valid', 'needs_attention', 'invalidated']);
  });

  it('authorizes with the target token during impersonation (not the impersonator apiGatewayToken)', async () => {
    getEffectiveUsername.mockReturnValue('target');
    isImpersonating.mockReturnValue(true);
    const imperReq = { bearerToken: 'target-token' } as unknown as Request;
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'], clas: [] });

    await new ClaService().getMyClas(imperReq);

    expect(gatewayFetch).toHaveBeenCalledWith(imperReq, expect.stringContaining('/v4/my-clas?'), expect.objectContaining({ bearerToken: 'target-token' }));
  });

  it('leaves the gateway token as default when not impersonating', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'], clas: [] });

    await new ClaService().getMyClas(req);

    expect(gatewayFetch).toHaveBeenCalledWith(req, expect.any(String), expect.objectContaining({ bearerToken: undefined }));
  });
});

// ---------------------------------------------------------------------------
// getPdfUrl — /v4/my-clas/{id}/pdf passthrough
// ---------------------------------------------------------------------------

describe('ClaService.getPdfUrl', () => {
  const identity: ResolvedClaIdentity = { lfUsername: 'alice', emails: [], githubIds: [], githubUsernames: [], githubLinked: false };

  it('returns the presigned url and TTL from upstream', async () => {
    gatewayFetch.mockResolvedValueOnce({ signatureID: 'sig-1', url: 'https://s3/signed.pdf', expiresInSeconds: 900 });

    const pdf = await new ClaService().getPdfUrl(req, 'sig-1', identity);

    expect(pdf).toEqual({ url: 'https://s3/signed.pdf', expiresInSeconds: 900 });
    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    expect(calledUrl).toContain('/v4/my-clas/sig-1/pdf?');
    expect(calledUrl).toContain('lfUsername=alice');
  });

  it('returns null on a 404 (unknown, not-owned or ECLA signature id)', async () => {
    gatewayFetch.mockRejectedValueOnce(new MicroserviceError('not found', 404, 'NOT_FOUND', { service: 'cla_service' }));

    expect(await new ClaService().getPdfUrl(req, 'sig-x', identity)).toBeNull();
  });

  it('returns null when upstream responds without a url', async () => {
    gatewayFetch.mockResolvedValueOnce({ signatureID: 'sig-1' });

    expect(await new ClaService().getPdfUrl(req, 'sig-1', identity)).toBeNull();
  });

  it('propagates non-404 upstream errors', async () => {
    gatewayFetch.mockRejectedValueOnce(new MicroserviceError('boom', 500, 'UPSTREAM_ERROR', { service: 'cla_service' }));

    await expect(new ClaService().getPdfUrl(req, 'sig-1', identity)).rejects.toThrow(MicroserviceError);
  });

  it('authorizes the ownership check with the target token during impersonation', async () => {
    isImpersonating.mockReturnValue(true);
    const imperReq = { bearerToken: 'target-token' } as unknown as Request;
    gatewayFetch.mockResolvedValueOnce({ signatureID: 'sig-1', url: 'https://s3/signed.pdf', expiresInSeconds: 900 });

    await new ClaService().getPdfUrl(imperReq, 'sig-1', identity);

    expect(gatewayFetch).toHaveBeenCalledWith(
      imperReq,
      expect.stringContaining('/v4/my-clas/sig-1/pdf?'),
      expect.objectContaining({ bearerToken: 'target-token' })
    );
  });
});


// ---------------------------------------------------------------------------
// listGithubAccounts — the picker's options (#1252)
// ---------------------------------------------------------------------------

describe('ClaService.listGithubAccounts', () => {
  beforeEach(() => {
    getEffectiveSub.mockReturnValue('auth0|abc');
  });

  it('returns the linked GitHub accounts with their numbers and handles', async () => {
    getUserIdentities.mockResolvedValueOnce([
      { provider: 'github', user_id: '12345', profileData: { nickname: 'octocat' } },
      { provider: 'github', user_id: 'github|67890', profileData: { nickname: 'hubot' } },
    ]);

    expect(await new ClaService().listGithubAccounts(req)).toEqual({
      accounts: [
        { githubId: '12345', githubUsername: 'octocat' },
        { githubId: '67890', githubUsername: 'hubot' },
      ],
    });
  });

  it('excludes identities from other providers', async () => {
    getUserIdentities.mockResolvedValueOnce([
      { provider: 'google-oauth2', user_id: '999', profileData: { nickname: 'someone' } },
      { provider: 'github', user_id: '12345', profileData: { nickname: 'octocat' } },
    ]);

    const { accounts } = await new ClaService().listGithubAccounts(req);

    expect(accounts).toEqual([{ githubId: '12345', githubUsername: 'octocat' }]);
  });

  it('returns an empty list when nothing is linked', async () => {
    getUserIdentities.mockResolvedValueOnce([]);

    // Genuinely none linked — the caller routes this into account-linking, which is only
    // correct because the failure case below is NOT reported this way.
    expect(await new ClaService().listGithubAccounts(req)).toEqual({ accounts: [] });
  });

  it('surfaces an identity-lookup failure instead of reporting zero accounts', async () => {
    getUserIdentities.mockRejectedValueOnce(new Error('auth service timed out'));

    // The read path degrades to "no GitHub keys" here and is right to. This path must not:
    // an empty list sends the contributor into account-linking, and doing that to someone
    // who has a linked account asks them to fix something that is not broken.
    await expect(new ClaService().listGithubAccounts(req)).rejects.toThrow();
  });

  it('drops an identity whose account number cannot be read', async () => {
    getUserIdentities.mockResolvedValueOnce([
      { provider: 'github', user_id: 'not-a-number', profileData: { nickname: 'ghost' } },
      { provider: 'github', user_id: '12345', profileData: { nickname: 'octocat' } },
    ]);

    // Dropped rather than refused: an unreadable number could never be selected anyway,
    // because the backend would not attest it either.
    const { accounts } = await new ClaService().listGithubAccounts(req);

    expect(accounts).toEqual([{ githubId: '12345', githubUsername: 'octocat' }]);
  });

  it('refuses when the session carries no identity subject', async () => {
    getEffectiveSub.mockReturnValue(null);

    await expect(new ClaService().listGithubAccounts(req)).rejects.toThrow(MicroserviceError);
  });
});

// ---------------------------------------------------------------------------
// bindSigningIdentity — recording the chosen account (#1252)
// ---------------------------------------------------------------------------

describe('ClaService.bindSigningIdentity', () => {
  const bindReq = reqWithHost('app.dev.lfx.dev');

  // The submitted account is matched against the session's linked accounts before anything is
  // sent upstream, so every test here needs a session that actually has the account it names.
  beforeEach(() => {
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValue([
      { provider: 'github', user_id: 'github|12345', connection: 'github', profileData: { nickname: 'octocat' } },
    ]);
  });

  it('refuses an account that is not linked to this session', async () => {
    // The upstream records what it is sent without re-deriving ownership, so this is the check
    // that keeps a caller from naming somebody else's account by calling the endpoint directly.
    await expect(new ClaService().bindSigningIdentity(bindReq, '99999')).rejects.toMatchObject({ code: 'CLA_ACCOUNT_NOT_LINKED' });

    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('refuses rather than proceeding when the linked accounts cannot be read', async () => {
    // A failure must not read as "no accounts", which would refuse every account including the
    // contributor's own — but more importantly must never fall through to recording one.
    getUserIdentities.mockRejectedValueOnce(new Error('NATS TIMEOUT'));

    await expect(new ClaService().bindSigningIdentity(bindReq, '12345')).rejects.toThrow();

    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('sends the handle from the session, not one supplied by the caller', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 12345 });

    await new ClaService().bindSigningIdentity(bindReq, '12345');

    expect(gatewayFetch).toHaveBeenCalledWith(
      bindReq,
      expect.stringContaining('/v4/my-clas/signing-identity'),
      expect.objectContaining({ body: { githubId: 12345, githubUsername: 'octocat' } })
    );
  });

  it('returns the recorded association and the return address together', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 12345, githubUsername: 'octocat', outcome: 'created' });

    expect(await new ClaService().bindSigningIdentity(bindReq, '12345')).toEqual({
      claUserId: 'u-1',
      githubId: '12345',
      githubUsername: 'octocat',
      // Both halves come back from the binding, so a hand-off URL cannot be assembled
      // before the association exists.
      redirectUrl: 'https://app.dev.lfx.dev/profile/clas',
    });
  });

  it('posts the account as a number to the signing-identity endpoint', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 12345 });

    await new ClaService().bindSigningIdentity(bindReq, '12345');

    expect(gatewayFetch).toHaveBeenCalledWith(
      bindReq,
      expect.stringContaining('/v4/my-clas/signing-identity'),
      expect.objectContaining({ method: 'POST', body: { githubId: 12345, githubUsername: 'octocat' } })
    );
  });

  it('omits the handle rather than sending an empty one', async () => {
    // A linked account the identity provider has no nickname for.
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|12345', connection: 'github', profileData: {} }]);
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 12345 });

    await new ClaService().bindSigningIdentity(bindReq, '12345');

    // An empty string would be recorded as the contributor's handle, replacing whatever the
    // record already held with nothing.
    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { body?: Record<string, unknown> }];
    expect(opts.body).not.toHaveProperty('githubUsername');
  });

  it('runs on the default gateway token, which is what identifies the caller upstream', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 12345 });

    await new ClaService().bindSigningIdentity(bindReq, '12345');

    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { bearerToken?: string }];
    expect(opts.bearerToken).toBeUndefined();
  });

  it('returns the account the backend recorded, not the one submitted', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 999, githubUsername: 'recorded' });

    // The caller checks this against what was chosen, so echoing the request back would
    // defeat the only check that what was recorded is what was picked.
    const result = await new ClaService().bindSigningIdentity(bindReq, '12345');

    expect(result.githubId).toBe('999');
  });

  it.each([
    'identity_unavailable',
    'identity_mismatch',
    'record_conflict',
    'record_unclaimed',
    'duplicate_github_id',
    'recorded_mismatch',
  ] as const)('keeps the %s refusal reason distinguishable to the caller', async (reason) => {
    gatewayFetch.mockRejectedValueOnce(
      new MicroserviceError(`refused: ${reason}`, 403, 'UPSTREAM_ERROR', { service: 'cla_service', errorBody: { error: reason } })
    );

    // Collapsing these into one failure would lose the only thing that tells the contributor
    // what to do next — sign in again, choose again, or contact support.
    await expect(new ClaService().bindSigningIdentity(bindReq, '12345')).rejects.toMatchObject({
      errorBody: { error: reason },
    });
  });

  it('resolves the account list again rather than trusting the caller to have used it', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 12345 });

    await new ClaService().bindSigningIdentity(bindReq, '12345');

    // The browser resolves the choice against the served list too, but nothing obliges a caller
    // to go through the browser. Skipping this to save a lookup would leave the account number
    // unchecked on the one path that records it.
    expect(getUserIdentities).toHaveBeenCalled();
  });

  it('refuses an upstream answer with no recorded identifier', async () => {
    gatewayFetch.mockResolvedValueOnce({ githubId: 12345 });

    await expect(new ClaService().bindSigningIdentity(bindReq, '12345')).rejects.toThrow(MicroserviceError);
  });

  it('refuses an upstream answer with no recorded account', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1' });

    await expect(new ClaService().bindSigningIdentity(bindReq, '12345')).rejects.toThrow(MicroserviceError);
  });

  it('does not write an association it could never hand off', async () => {
    gatewayFetch.mockResolvedValueOnce({ userId: 'u-1', githubId: 12345 });

    await expect(new ClaService().bindSigningIdentity(reqWithHost(undefined), '12345')).rejects.toThrow(MicroserviceError);
    // An unusable origin dead-ends the flow regardless, so the identity attribute must not
    // have been recorded on the way to finding that out.
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
