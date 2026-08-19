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

import type { EasyClaMyCla, EasyClaSearchResult, ResolvedClaIdentity } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { ClaService, claReturnUrl, claServiceBaseUrl, collectClaEmails, normalizeGithubId, toClaGroupSearchResponse, toMyClaAgreement } from './cla.service';

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
  // clearAllMocks drops call history but not queued `…Once` values, so a test that queues a
  // response it never consumes would hand it to whichever test calls the gateway next.
  gatewayFetch.mockReset();
  // clearAllMocks resets call history but not return-value overrides — restore identity
  // helper defaults so a value set in one test does not leak into the next.
  getEffectiveUsername.mockReturnValue(null);
  getEffectiveEmail.mockReturnValue(null);
  getEffectiveSub.mockReturnValue(null);
  isImpersonating.mockReturnValue(false);
  getUserIdentities.mockResolvedValue([]);
  getUserEmails.mockResolvedValue(null);
  process.env['API_GW_AUDIENCE'] = 'https://api-gw.dev.example.org/';
  // A developer pointing their laptop BFF at a local cla-backend-go exports this; leaving it set
  // would silently reroute every asserted upstream URL below.
  delete process.env['CLA_SERVICE_URL'];
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
// CLA-group search mapping (#1250)
// ---------------------------------------------------------------------------

describe('toClaGroupSearchResponse', () => {
  /** Minimal producer result from `/v4/cla-group/search` (`#/definitions/cla-search-result`). */
  function result(overrides: Partial<EasyClaSearchResult> = {}): EasyClaSearchResult {
    return {
      claGroupID: 'cg-1',
      claGroupName: 'CNCF ICLA',
      projectName: 'CNCF',
      matchTypes: ['project'],
      organizations: [{ name: 'cncf', source: 'github', url: 'https://github.com/cncf' }],
      ...overrides,
    };
  }

  it('renames the producer claGroupID to the claGroupId the hand-off already reads', () => {
    const mapped = toClaGroupSearchResponse({ searchTerm: 'cncf', resultCount: 1, truncated: false, results: [result()] });

    // Forking a second identifier spelling into Angular is what this mapping exists to prevent.
    expect(mapped.results[0]?.claGroupId).toBe('cg-1');
    expect(mapped.results[0]).not.toHaveProperty('claGroupID');
  });

  it('carries the set-level envelope through, including truncated', () => {
    const mapped = toClaGroupSearchResponse({ searchTerm: 'cn', resultCount: 20, truncated: true, results: [result()] });

    expect(mapped).toMatchObject({ searchTerm: 'cn', resultCount: 20, truncated: true });
    expect(mapped.results).toHaveLength(1);
  });

  it('keeps a result whose projectName the producer omitted (multi-project, no foundation marker)', () => {
    const mapped = toClaGroupSearchResponse({
      searchTerm: 'cncf',
      resultCount: 1,
      truncated: false,
      results: [result({ projectName: undefined, claGroupName: undefined })],
    });

    // Both names can be absent upstream; dropping such a row would hide a signable group.
    expect(mapped.results).toHaveLength(1);
    expect(mapped.results[0]?.projectName).toBeUndefined();
    expect(mapped.results[0]?.claGroupName).toBeUndefined();
  });

  it('normalizes an absent organizations/matchTypes list to an empty array, never undefined', () => {
    const mapped = toClaGroupSearchResponse({
      searchTerm: 'cncf',
      resultCount: 1,
      truncated: false,
      results: [result({ organizations: undefined, matchTypes: undefined })],
    });

    // The picker iterates both; a missing array and an empty one must render identically.
    expect(mapped.results[0]?.organizations).toEqual([]);
    expect(mapped.results[0]?.matchTypes).toEqual([]);
  });

  it('keeps a linked organization the producer named only by URL', () => {
    const mapped = toClaGroupSearchResponse({
      searchTerm: 'cncf',
      resultCount: 1,
      truncated: false,
      results: [result({ organizations: [{ source: 'gitlab', url: 'https://gitlab.com/cla_dev_automationgroup' }] })],
    });

    // Live 2026-08-19: two of the GitLab groups on a CNCF hit carry a URL and no name. Dropping
    // them would undercount "N linked orgs" and hide the only GitLab provenance on the result.
    expect(mapped.results[0]?.organizations).toEqual([
      { name: 'https://gitlab.com/cla_dev_automationgroup', source: 'gitlab', url: 'https://gitlab.com/cla_dev_automationgroup' },
    ]);
  });

  it('carries the resolved repository through for a pasted-URL match', () => {
    const mapped = toClaGroupSearchResponse({
      searchTerm: 'https://github.com/cncf/foo',
      resultCount: 1,
      truncated: false,
      results: [result({ matchTypes: ['repository'], matchedRepositoryName: 'cncf/foo', matchedRepositoryURL: 'https://github.com/cncf/foo' })],
    });

    expect(mapped.results[0]).toMatchObject({ matchedRepositoryName: 'cncf/foo', matchedRepositoryURL: 'https://github.com/cncf/foo' });
  });

  it('drops the producer fields the modal has no use for', () => {
    const mapped = toClaGroupSearchResponse({
      searchTerm: 'cncf',
      resultCount: 1,
      truncated: false,
      results: [result({ projectSFID: 'a09', foundationSFID: 'a09f', projectExternalID: 'ext', iclaEnabled: true, cclaEnabled: false })],
    });

    // Passing these on would invite a later consumer to branch on signing configuration the
    // picker never asked for and cannot honour.
    expect(mapped.results[0]).not.toHaveProperty('projectSFID');
    expect(mapped.results[0]).not.toHaveProperty('iclaEnabled');
    expect(mapped.results[0]).not.toHaveProperty('cclaEnabled');
  });

  it('answers an absent upstream body with an empty, non-truncated set for the term', () => {
    expect(toClaGroupSearchResponse(null, 'cncf')).toEqual({ searchTerm: 'cncf', resultCount: 0, truncated: false, results: [] });
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
// searchClaGroups — /v4/cla-group/search
// ---------------------------------------------------------------------------

describe('ClaService.searchClaGroups', () => {
  const upstream = {
    searchTerm: 'cncf',
    resultCount: 1,
    truncated: false,
    results: [{ claGroupID: 'cg-1', projectName: 'CNCF', matchTypes: ['project'], organizations: [] }],
  };

  it('queries the four-source search with the term as searchTerm', async () => {
    gatewayFetch.mockResolvedValueOnce(upstream);

    await new ClaService().searchClaGroups(req, 'cncf');

    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    expect(calledUrl).toBe('https://api-gw.dev.example.org/cla-service/v4/cla-group/search?searchTerm=cncf');
  });

  it('encodes a pasted repository URL rather than splicing it into the query string', async () => {
    gatewayFetch.mockResolvedValueOnce(upstream);

    await new ClaService().searchClaGroups(req, 'https://github.com/cncf/foo');

    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    const params = new URLSearchParams(calledUrl.slice(calledUrl.indexOf('?') + 1));
    expect(params.get('searchTerm')).toBe('https://github.com/cncf/foo');
  });

  it('runs on the default gateway token, even while impersonating', async () => {
    isImpersonating.mockReturnValue(true);
    const imperReq = { bearerToken: 'target-token' } as unknown as Request;
    gatewayFetch.mockResolvedValueOnce(upstream);

    await new ClaService().searchClaGroups(imperReq, 'cncf');

    // Search carries no identity: it asks which CLA Groups exist, not which are the caller's. The
    // PDF path's token-juggle is there because that call is scoped to a user — this one is not.
    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { bearerToken?: string }];
    expect(opts.bearerToken).toBeUndefined();
  });

  it('maps the upstream body onto the SS envelope, renaming the identifier', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstream, truncated: true, resultCount: 20 });

    const envelope = await new ClaService().searchClaGroups(req, 'cncf');

    expect(envelope).toMatchObject({ searchTerm: 'cncf', resultCount: 20, truncated: true });
    expect(envelope.results[0]?.claGroupId).toBe('cg-1');
  });

  it('answers an empty body with an empty set for the term rather than throwing', async () => {
    gatewayFetch.mockResolvedValueOnce(null);

    expect(await new ClaService().searchClaGroups(req, 'cncf')).toEqual({ searchTerm: 'cncf', resultCount: 0, truncated: false, results: [] });
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
// resolveContributorId — userIds from /v4/my-clas (Sign CLA hand-off, #1251)
// ---------------------------------------------------------------------------

describe('ClaService.resolveContributorId', () => {
  /** Rejects the /v2/user-from-token probe so the userIds bridge behind it is exercised. */
  function probeUnavailable(): void {
    gatewayFetch.mockRejectedValueOnce(new MicroserviceError('probe rejected', 401, 'UPSTREAM_ERROR', { service: 'cla_service' }));
  }

  it('prefers the resolve-or-create endpoint when it accepts our token', async () => {
    gatewayFetch.mockResolvedValueOnce({ user_id: 'u-created' });

    // Preferred because it mints a record for a first-time signer, which the bridge cannot.
    expect(await new ClaService().resolveContributorId(req)).toBe('u-created');
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('reads the snake_case user_id the legacy backend returns', async () => {
    // /v2 returns the raw DynamoDB item, not v4's camelCase model — userID would read as absent.
    gatewayFetch.mockResolvedValueOnce({ userID: 'wrong-case' });
    gatewayFetch.mockResolvedValueOnce({ userIds: ['from-bridge'] });

    expect(await new ClaService().resolveContributorId(req)).toBe('from-bridge');
  });

  it('falls back to the bridge when the probe is rejected', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: ['from-bridge'] });

    // A rejected probe must not break the hand-off for a contributor who already has a record.
    expect(await new ClaService().resolveContributorId(req)).toBe('from-bridge');
  });

  it('resolves the EasyCLA user UUID from the identity search', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: ['40dc8def-e014-11ec-8750-4225fa2d71d7'] });

    expect(await new ClaService().resolveContributorId(req)).toBe('40dc8def-e014-11ec-8750-4225fa2d71d7');
  });

  it('reads the fallback from /v4/my-clas, never /v4/user-from-token', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'] });

    await new ClaService().resolveContributorId(req);

    // The v4 namesake is an unauthenticated passthrough on the gateway, so it never receives the
    // X-ACL header the CLA backend's security scheme is keyed on and always 401s.
    const urls = gatewayFetch.mock.calls.map((call) => (call as [unknown, string])[1]);
    expect(urls.some((url) => url.includes('/v4/my-clas'))).toBe(true);
    expect(urls.some((url) => url.includes('/v4/user-from-token'))).toBe(false);
  });

  it('runs on the default gateway token', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1'] });

    await new ClaService().resolveContributorId(req);

    // apiGatewayToken already carries the signed-in contributor (their own refresh token
    // exchanged for the gateway audience). Overriding it would resolve someone else.
    for (const call of gatewayFetch.mock.calls) {
      const [, , opts] = call as [unknown, string, { bearerToken?: string }];
      expect(opts.bearerToken).toBeUndefined();
    }
  });

  it('refuses to hand off when no record matches the session', async () => {
    // A first-time signer has no EasyCLA record yet, and with the probe unavailable there is
    // nothing to mint one. The Console renders "invalid user ID in the URL" for an absent id, so
    // this must fail here rather than dead-end there (FR-009).
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: [] });

    await expect(new ClaService().resolveContributorId(req)).rejects.toThrow(MicroserviceError);
  });

  it('refuses when the field is missing entirely', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ resultCount: 0 });

    await expect(new ClaService().resolveContributorId(req)).rejects.toThrow(MicroserviceError);
  });

  it('refuses when the upstream returns no body', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce(null);

    await expect(new ClaService().resolveContributorId(req)).rejects.toThrow(MicroserviceError);
  });

  it('ignores blank identifiers rather than handing one off', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: ['  ', ''] });

    await expect(new ClaService().resolveContributorId(req)).rejects.toThrow(MicroserviceError);
  });

  it('trims a padded identifier', async () => {
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: ['  u-1  '] });

    expect(await new ClaService().resolveContributorId(req)).toBe('u-1');
  });

  it('takes the first of several matched records rather than failing', async () => {
    // An identity can match several EasyCLA records and nothing here can tell which one a
    // signature belongs against. Refusing a returning contributor helps nobody; the ambiguity is
    // logged instead, and the resolve-or-create endpoint returns one record.
    probeUnavailable();
    gatewayFetch.mockResolvedValueOnce({ userIds: ['u-1', 'u-2', 'u-3'] });

    expect(await new ClaService().resolveContributorId(req)).toBe('u-1');
  });

  it('propagates a failure of the fallback itself', async () => {
    probeUnavailable();
    gatewayFetch.mockRejectedValueOnce(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));

    await expect(new ClaService().resolveContributorId(req)).rejects.toThrow(MicroserviceError);
  });
});

// ---------------------------------------------------------------------------
// getSignHandoff — server-owned halves of the Console URL (#1251)
// ---------------------------------------------------------------------------

describe('ClaService.getSignHandoff', () => {
  const handoffReq = { protocol: 'https', get: (n: string) => (n === 'host' ? 'app.dev.lfx.dev' : undefined) } as unknown as Request;

  it('returns the resolved identifier and an absolute return URL', async () => {
    gatewayFetch.mockResolvedValueOnce({ user_id: 'u-1' });

    expect(await new ClaService().getSignHandoff(handoffReq)).toEqual({
      claUserId: 'u-1',
      redirectUrl: 'https://app.dev.lfx.dev/profile/clas',
    });
  });

  it('does not resolve an identifier when the return URL cannot be derived', async () => {
    const hostless = { protocol: 'https', get: () => undefined } as unknown as Request;

    await expect(new ClaService().getSignHandoff(hostless)).rejects.toThrow(MicroserviceError);
  });
});
