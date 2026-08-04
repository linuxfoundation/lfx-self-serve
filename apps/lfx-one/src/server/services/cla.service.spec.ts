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
import { ClaService, claServiceBaseUrl, collectClaEmails, normalizeGithubId, toMyClaAgreement } from './cla.service';

const req = {} as unknown as Request;

/** Minimal ICLA record from `/v4/my-clas`. */
function icla(overrides: Partial<EasyClaMyCla> = {}): EasyClaMyCla {
  return { signatureID: 's-icla', claType: 'icla', valid: true, pdfAvailable: true, claGroupID: 'cg-1', signedOn: '2022-01-01', ...overrides };
}

/** Minimal valid ECLA record from `/v4/my-clas`. */
function ecla(overrides: Partial<EasyClaMyCla> = {}): EasyClaMyCla {
  return { signatureID: 's-ecla', claType: 'ecla', valid: true, companyName: 'Acme', claGroupID: 'cg-2', signedOn: '2022-02-02', ...overrides };
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

  it('maps an invalidated record to status inactive', () => {
    expect(toMyClaAgreement(icla({ valid: false })).status).toBe('inactive');
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

  it('filters out invalid CLAs (valid !== true) — surfaces only currently-valid ICLAs/ECLAs', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    // The endpoint returns invalid rows too (valid=false) by design (#1158, docs/MY_CLAS_API.md);
    // the consumer drops them, so a valid record is kept and invalid ICLA/ECLA rows are removed.
    gatewayFetch.mockResolvedValueOnce({
      userIds: ['u-1'],
      clas: [icla({ signatureID: 'ok' }), icla({ signatureID: 'gone-icla', valid: false }), ecla({ signatureID: 'gone-ecla', valid: false })],
    });

    const result = await new ClaService().getMyClas(req);

    expect(result.agreements.map((a) => a.id)).toEqual(['ok']);
    expect(result.agreements.every((a) => a.status === 'valid')).toBe(true);
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
