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
import {
  ClaService,
  claReturnUrl,
  claServiceBaseUrl,
  collectClaEmails,
  githubIdWasSkipped,
  normalizeGithubId,
  producerMessageFrom,
  recordedGithubIdentity,
  toClaGroupSearchResponse,
  toMyClaAgreement,
} from './cla.service';

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
    expect(a).toMatchObject({ id: 's-icla', kind: 'ICLA', pdfAvailable: true, status: 'valid', documentVersion: '2.1', claGroupId: 'cg-1' });
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

  // Sanctions screening is the only source of `revoked`, and it is the one status a contributor
  // must not see mislabelled: degrading it to `unknown` renders an em dash where the pill belongs,
  // and mapping it onto `invalidated` accuses everyone in that far larger bucket.
  it('passes revoked through untouched on an ECLA', () => {
    const revoked = toMyClaAgreement(ecla({ status: 'revoked', approved: true, valid: false }));

    expect(revoked.status).toBe('revoked');
  });

  it('pins claGroupId from the producer and omits a blank value', () => {
    expect(toMyClaAgreement(ecla()).claGroupId).toBe('cg-2');
    expect(toMyClaAgreement(ecla({ claGroupID: '  ' })).claGroupId).toBeUndefined();
    expect(toMyClaAgreement(ecla({ claGroupID: undefined })).claGroupId).toBeUndefined();
  });

  it('pins projectSfid and foundationSfid from the producer and omits blanks', () => {
    const row = toMyClaAgreement(ecla({ projectSFID: 'proj-sfid-1', foundationSFID: 'found-parent' }));
    expect(row.projectSfid).toBe('proj-sfid-1');
    expect(row.foundationSfid).toBe('found-parent');
    expect(toMyClaAgreement(ecla({ projectSFID: '  ', foundationSFID: '  ' })).projectSfid).toBeUndefined();
    expect(toMyClaAgreement(ecla()).foundationSfid).toBeUndefined();
  });

  it('carries the producer claManager flag through as a boolean, false when omitted', () => {
    expect(toMyClaAgreement(ecla({ claManager: true })).claManager).toBe(true);
    expect(toMyClaAgreement(ecla({ claManager: false })).claManager).toBe(false);
    expect(toMyClaAgreement(ecla()).claManager).toBe(false);
  });

  it('copies signedVia and signedAs from the producer', () => {
    const github = toMyClaAgreement(icla({ signedVia: 'github', signedAs: 'jellis' }));
    expect(github.signedVia).toBe('github');
    expect(github.signedAs).toBe('jellis');

    const gitlab = toMyClaAgreement(ecla({ signedVia: 'gitlab', signedAs: 'jellis' }));
    expect(gitlab.signedVia).toBe('gitlab');
    expect(gitlab.signedAs).toBe('jellis');

    const gerrit = toMyClaAgreement(icla({ signedVia: 'gerrit', signedAs: 'jellis@acme-motors.example' }));
    expect(gerrit.signedVia).toBe('gerrit');
    expect(gerrit.signedAs).toBe('jellis@acme-motors.example');
  });

  it('trims signedAs and drops a blank identity', () => {
    expect(toMyClaAgreement(icla({ signedVia: 'github', signedAs: '  jellis  ' })).signedAs).toBe('jellis');
    expect(toMyClaAgreement(icla({ signedVia: 'github', signedAs: '   ' })).signedAs).toBeUndefined();
    expect(toMyClaAgreement(icla({})).signedVia).toBeUndefined();
    expect(toMyClaAgreement(icla({})).signedAs).toBeUndefined();
  });

  it('drops an unrecognised signedVia and still keeps signedAs', () => {
    const row = toMyClaAgreement(icla({ signedVia: 'bitbucket' as EasyClaMyCla['signedVia'], signedAs: 'jellis' }));

    expect(row.signedVia).toBeUndefined();
    expect(row.signedAs).toBe('jellis');
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

  // The wire type declares the five producer values, so an out-of-contract status can only arrive
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

describe('recordedGithubIdentity', () => {
  it('reads the verified account number out of the producer identity keys', () => {
    expect(recordedGithubIdentity(['lfUsername:alice', 'github-id:26589865'])).toEqual({ githubId: '26589865' });
  });

  it('carries the handle alongside it when the producer verified one', () => {
    expect(recordedGithubIdentity(['github-id:26589865', 'github-username:octocat'])).toEqual({ githubId: '26589865', githubUsername: 'octocat' });
  });

  it('reports an identity with no account number as incomplete', () => {
    // The echo guard has nothing to compare against, so this cannot be treated as a success
    // for the chosen account — the hand-off would proceed on an unverified assumption.
    expect(recordedGithubIdentity(['lfUsername:alice', 'email:alice@example.org'])).toBeNull();
    expect(recordedGithubIdentity([])).toBeNull();
    expect(recordedGithubIdentity(undefined)).toBeNull();
  });

  it('does not accept a handle as the account the echo is checked against', () => {
    // Handles are renamed and reclaimed, so a handle-only answer names an account that may no
    // longer be the one the contributor picked.
    expect(recordedGithubIdentity(['github-username:octocat'])).toBeNull();
  });

  it('ignores a key whose account number is absent or unreadable', () => {
    expect(recordedGithubIdentity(['github-id:'])).toBeNull();
    expect(recordedGithubIdentity(['github-id:not-a-number'])).toBeNull();
  });
});

describe('githubIdWasSkipped', () => {
  it('reports the chosen account as skipped when the producer listed it', () => {
    // A 200 that skipped the pick verified something else; treating it as success would sign
    // against whichever identity the producer did apply.
    expect(githubIdWasSkipped(['github-id:26589865'], '26589865')).toBe(true);
  });

  it('does not report an account the producer skipped for somebody else', () => {
    expect(githubIdWasSkipped(['github-id:99999', 'email:alice@example.org'], '26589865')).toBe(false);
  });

  it('treats an absent or empty skipped list as nothing skipped', () => {
    expect(githubIdWasSkipped(undefined, '26589865')).toBe(false);
    expect(githubIdWasSkipped([], '26589865')).toBe(false);
  });

  it('does not match a skipped handle against the account number', () => {
    expect(githubIdWasSkipped(['github-username:26589865'], '26589865')).toBe(false);
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
// prepareSign — asking the CLA service to open the signing session (#1252)
// ---------------------------------------------------------------------------

describe('ClaService.prepareSign', () => {
  const prepareReq = reqWithHost('app.dev.lfx.dev');
  const CLA_GROUP_ID = '3fee6d72-0c80-4145-99c2-fb382b3a93fb';

  /** A prepare the producer answered for the account that was chosen. */
  function prepared(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      userId: 'u-1',
      signUrl: 'https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc',
      identity: ['github-id:12345', 'github-username:octocat'],
      skippedIdentities: [],
      ...overrides,
    };
  }

  // The chosen account is matched against the session's linked accounts before anything is sent
  // upstream, so every test here needs a session that actually has the account it names.
  beforeEach(() => {
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValue([{ provider: 'github', user_id: 'github|12345', connection: 'github', profileData: { nickname: 'octocat' } }]);
  });

  it('asks the self-serve prepare endpoint, not the retired binder', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared());

    await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID);

    expect(gatewayFetch).toHaveBeenCalledWith(prepareReq, `${claServiceBaseUrl()}/v4/self-serve/prepare-sign`, expect.objectContaining({ method: 'POST' }));
  });

  it('sends the group, the derived return address, and both identity keys', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared());

    await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID);

    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { body?: Record<string, unknown> }];
    expect(opts.body).toEqual({
      claGroupId: CLA_GROUP_ID,
      // Derived from the request, never accepted from the caller: EasyCLA stores it and later
      // redirects to it verbatim.
      returnUrl: 'https://app.dev.lfx.dev/profile/clas',
      // A number, as the endpoint's own model types it.
      githubId: 12345,
      // The producer cannot verify a first-time numeric id without the handle, so it rides along.
      githubUsername: 'octocat',
    });
  });

  it('takes the handle from the session, not from anything the caller could name', async () => {
    getUserIdentities.mockResolvedValue([
      { provider: 'github', user_id: 'github|12345', connection: 'github', profileData: { nickname: 'octocat' } },
      { provider: 'github', user_id: 'github|67890', connection: 'github', profileData: { nickname: 'hubot' } },
    ]);
    gatewayFetch.mockResolvedValueOnce(prepared({ identity: ['github-id:67890', 'github-username:hubot'] }));

    await new ClaService().prepareSign(prepareReq, '67890', CLA_GROUP_ID);

    // The producer resolves the handle live through GitHub and admits the number only if the two
    // agree, so a caller able to pair a number it owns with a handle it does not would be able
    // to have the session opened against somebody else's account.
    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { body?: Record<string, unknown> }];
    expect(opts.body).toMatchObject({ githubId: 67890, githubUsername: 'hubot' });
  });

  it('omits the handle rather than sending an empty one', async () => {
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|12345', connection: 'github', profileData: {} }]);
    gatewayFetch.mockResolvedValueOnce(prepared({ identity: ['github-id:12345'] }));

    await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID);

    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { body?: Record<string, unknown> }];
    expect(opts.body).not.toHaveProperty('githubUsername');
  });

  it('runs on the default gateway token, which is what identifies the caller upstream', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared());

    await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID);

    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { bearerToken?: string }];
    expect(opts.bearerToken).toBeUndefined();
  });

  it('returns the producer address and the verified account, and never a locally built URL', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared());

    expect(await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).toEqual({
      userId: 'u-1',
      signUrl: 'https://easycla.dev.communitybridge.org/#/cla/project/cg-1/user/u-1?redirect=enc',
      githubId: '12345',
      githubUsername: 'octocat',
      skippedIdentities: [],
    });
  });

  it('refuses an account that is not linked to this session, before asking upstream', async () => {
    await expect(new ClaService().prepareSign(prepareReq, '99999', CLA_GROUP_ID)).rejects.toMatchObject({ code: 'CLA_ACCOUNT_NOT_LINKED' });

    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('refuses rather than proceeding when the linked accounts cannot be read', async () => {
    getUserIdentities.mockRejectedValueOnce(new Error('NATS TIMEOUT'));

    await expect(new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).rejects.toThrow();

    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('never stands the first linked account in for one it cannot resolve', async () => {
    getUserIdentities.mockResolvedValue([
      { provider: 'github', user_id: 'github|12345', connection: 'github', profileData: { nickname: 'octocat' } },
      { provider: 'github', user_id: 'github|67890', connection: 'github', profileData: { nickname: 'hubot' } },
    ]);

    await expect(new ClaService().prepareSign(prepareReq, '99999', CLA_GROUP_ID)).rejects.toMatchObject({ code: 'CLA_ACCOUNT_NOT_LINKED' });

    // Falling back would open the session against an account the contributor never chose, which
    // every ownership check upstream would happily pass.
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('does not prepare a session it could never return the contributor from', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared());

    await expect(new ClaService().prepareSign(reqWithHost(undefined), '12345', CLA_GROUP_ID)).rejects.toThrow(MicroserviceError);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('refuses a success whose identity carries no account number', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared({ identity: ['lfUsername:alice'] }));

    // There is nothing to check the pick against, so this cannot be passed on as a success for
    // the chosen account — the hand-off would proceed on an unverified assumption.
    await expect(new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).rejects.toMatchObject({
      statusCode: 502,
      code: 'CLA_BINDING_INCOMPLETE',
    });
  });

  it.each([{ signUrl: '' }, { signUrl: '   ' }, { signUrl: undefined }, { userId: '' }, { userId: undefined }])(
    'refuses a success missing what the hand-off needs (%o)',
    async (missing) => {
      gatewayFetch.mockResolvedValueOnce(prepared(missing));

      await expect(new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).rejects.toMatchObject({ code: 'CLA_BINDING_INCOMPLETE' });
    }
  );

  it('refuses a success that skipped the chosen account', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared({ identity: ['github-id:67890'], skippedIdentities: ['github-id:12345'] }));

    // The 200 says a session was opened, not that it was opened for this account. Treating it as
    // success would gate the wrong commits.
    await expect(new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).rejects.toMatchObject({ code: 'CLA_BINDING_INCOMPLETE' });
  });

  it('carries the skipped keys through on a success, so the client can guard too', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared({ skippedIdentities: ['email:stale@example.org'] }));

    const result = await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID);

    expect(result.skippedIdentities).toEqual(['email:stale@example.org']);
  });

  it('returns the account the producer verified, not the one submitted', async () => {
    gatewayFetch.mockResolvedValueOnce(prepared({ identity: ['github-id:99999'] }));

    // The caller checks this against what was chosen, so echoing the request back would defeat
    // the only check that the session belongs to the account they picked.
    expect((await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).githubId).toBe('99999');
  });

  it('never picks the first linked account when the session has no accounts at all', async () => {
    getUserIdentities.mockResolvedValueOnce([]);

    await expect(new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).rejects.toMatchObject({ code: 'CLA_ACCOUNT_NOT_LINKED' });

    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("surfaces an ownership refusal in the producer's own words", async () => {
    const refusal = 'the provided identity does not belong to the authenticated user';
    gatewayFetch.mockRejectedValueOnce(
      new MicroserviceError('Failed to prepare the CLA signing session: 403 Forbidden', 403, 'FORBIDDEN', {
        service: 'cla_service',
        errorBody: JSON.stringify({ code: '403', message: refusal }),
      })
    );

    // The endpoint ships no reason code, so its prose is the only thing there is to say. Relaying
    // "403 Forbidden" instead would tell the contributor nothing they can act on.
    await expect(new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).rejects.toMatchObject({ statusCode: 403, message: refusal });
  });

  it('does not derive a reason code from the refusal prose', async () => {
    gatewayFetch.mockRejectedValueOnce(
      new MicroserviceError('Failed to prepare the CLA signing session: 403 Forbidden', 403, 'FORBIDDEN', {
        service: 'cla_service',
        // Prose that a substring search over the retired binder's reason set would have matched.
        errorBody: JSON.stringify({ message: 'record_conflict: the provided identity does not belong to the authenticated user' }),
      })
    );

    const error = await new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID).catch((thrown: MicroserviceError) => thrown);

    // Inventing a code here would invite per-code copy the producer never promised to keep stable.
    expect((error as MicroserviceError).errorBody).not.toMatchObject({ error: 'record_conflict' });
  });

  it.each([404, 400, 500])('leaves a %i as the gateway described it, not as a refusal message', async (statusCode) => {
    gatewayFetch.mockRejectedValueOnce(
      new MicroserviceError('Failed to prepare the CLA signing session: upstream said no', statusCode, 'UPSTREAM_ERROR', {
        service: 'cla_service',
        errorBody: JSON.stringify({ message: 'cla group not found' }),
      })
    );

    // Only a 403 body is a statement about the contributor's own identity. Repeating the prose of
    // a 500 would put upstream internals on screen for something they cannot act on.
    await expect(new ClaService().prepareSign(prepareReq, '12345', CLA_GROUP_ID)).rejects.toMatchObject({
      statusCode,
      message: 'Failed to prepare the CLA signing session: upstream said no',
    });
  });
});

const MANAGER_SIG = '3fee6d72-0c80-4145-99c2-fb382b3a93fb';

describe('ClaService.getClaManagers', () => {
  const identity: ResolvedClaIdentity = { lfUsername: 'alice', emails: [], githubIds: [], githubUsernames: [], githubLinked: false };

  it('maps the producer list and forwards the session identity query', async () => {
    gatewayFetch.mockResolvedValueOnce({
      signatureID: MANAGER_SIG,
      managers: [
        { lfUsername: 'jdoe', name: 'Jane Doe', email: 'j@example.org' },
        { lfUsername: '  ', name: 'Dropped' },
      ],
      resultCount: 2,
    });

    const list = await new ClaService().getClaManagers(req, MANAGER_SIG, identity);

    expect(list).toEqual({
      signatureId: MANAGER_SIG,
      managers: [{ lfUsername: 'jdoe', name: 'Jane Doe', email: 'j@example.org' }],
      resultCount: 1,
    });
    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    expect(calledUrl).toContain(`/v4/my-clas/${MANAGER_SIG}/cla-managers?`);
    expect(calledUrl).toContain('lfUsername=alice');
  });

  it('returns null on a 404 rather than an empty manager list', async () => {
    gatewayFetch.mockRejectedValueOnce(new MicroserviceError('not found', 404, 'NOT_FOUND', { service: 'cla_service' }));

    expect(await new ClaService().getClaManagers(req, MANAGER_SIG, identity)).toBeNull();
  });

  it('authorizes the ownership check with the target token during impersonation', async () => {
    isImpersonating.mockReturnValue(true);
    const imperReq = { bearerToken: 'target-token' } as unknown as Request;
    gatewayFetch.mockResolvedValueOnce({ signatureID: MANAGER_SIG, managers: [], resultCount: 0 });

    await new ClaService().getClaManagers(imperReq, MANAGER_SIG, identity);

    expect(gatewayFetch).toHaveBeenCalledWith(
      imperReq,
      expect.stringContaining(`/v4/my-clas/${MANAGER_SIG}/cla-managers?`),
      expect.objectContaining({ bearerToken: 'target-token' })
    );
  });
});

describe('ClaService.createClaManagerRequest', () => {
  const identity: ResolvedClaIdentity = { lfUsername: 'alice', emails: [], githubIds: [], githubUsernames: [], githubLinked: false };

  it('posts approval/removal to the producer with identity query and no impersonation token override', async () => {
    gatewayFetch.mockResolvedValueOnce({
      requestID: 'r-1',
      signatureID: MANAGER_SIG,
      requestType: 'removal',
      status: 'sent',
      recipients: ['jdoe'],
    });

    const result = await new ClaService().createClaManagerRequest(req, MANAGER_SIG, identity, {
      requestType: 'removal',
      recipients: ['jdoe'],
      message: 'please',
    });

    expect(result).toEqual({
      requestId: 'r-1',
      signatureId: MANAGER_SIG,
      requestType: 'removal',
      status: 'sent',
      recipients: ['jdoe'],
    });
    const [, url, opts] = gatewayFetch.mock.calls[0] as [unknown, string, { method?: string; body?: Record<string, unknown>; bearerToken?: string }];
    expect(url).toContain(`/v4/my-clas/${MANAGER_SIG}/cla-manager-requests?`);
    expect(url).toContain('lfUsername=alice');
    expect(opts.method).toBe('POST');
    expect(opts.bearerToken).toBeUndefined();
    expect(opts.body).toEqual({ requestType: 'removal', recipients: ['jdoe'], message: 'please' });
  });

  it('omits a blank message rather than sending an empty string', async () => {
    gatewayFetch.mockResolvedValueOnce({
      requestID: 'r-1',
      signatureID: MANAGER_SIG,
      requestType: 'approval',
      status: 'recorded',
      recipients: ['jdoe'],
    });

    await new ClaService().createClaManagerRequest(req, MANAGER_SIG, identity, { requestType: 'approval', recipients: ['jdoe'] });

    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { body?: Record<string, unknown> }];
    expect(opts.body).toEqual({ requestType: 'approval', recipients: ['jdoe'] });
  });

  it('posts contact with its message and returns the contact receipt', async () => {
    gatewayFetch.mockResolvedValueOnce({
      requestID: 'r-2',
      signatureID: MANAGER_SIG,
      requestType: 'contact',
      status: 'sent',
      recipients: ['jdoe'],
    });

    const result = await new ClaService().createClaManagerRequest(req, MANAGER_SIG, identity, {
      requestType: 'contact',
      recipients: ['jdoe'],
      message: 'who owns our approved list?',
    });

    expect(result).toEqual({
      requestId: 'r-2',
      signatureId: MANAGER_SIG,
      requestType: 'contact',
      status: 'sent',
      recipients: ['jdoe'],
    });
    const [, , opts] = gatewayFetch.mock.calls[0] as [unknown, string, { body?: Record<string, unknown>; bearerToken?: string }];
    expect(opts.body).toEqual({ requestType: 'contact', recipients: ['jdoe'], message: 'who owns our approved list?' });
    expect(opts.bearerToken).toBeUndefined();
  });

  it('refuses a receipt naming a request type outside the producer enum', async () => {
    gatewayFetch.mockResolvedValueOnce({
      requestID: 'r-3',
      signatureID: MANAGER_SIG,
      requestType: 'nudge',
      status: 'sent',
      recipients: ['jdoe'],
    });

    await expect(
      new ClaService().createClaManagerRequest(req, MANAGER_SIG, identity, { requestType: 'contact', recipients: ['jdoe'], message: 'hi' })
    ).rejects.toThrow('Upstream recorded no usable CLA manager request');
  });

  it('refuses a receipt for a different request type than the one sent', async () => {
    gatewayFetch.mockResolvedValueOnce({
      requestID: 'r-4',
      signatureID: MANAGER_SIG,
      requestType: 'approval',
      status: 'sent',
      recipients: ['jdoe'],
    });

    // An approval receipt for a contact request would otherwise be forwarded as success, and the
    // modal picks its copy from the mode it asked for, hiding the mismatch from the contributor.
    await expect(
      new ClaService().createClaManagerRequest(req, MANAGER_SIG, identity, { requestType: 'contact', recipients: ['jdoe'], message: 'hi' })
    ).rejects.toThrow('Upstream recorded no usable CLA manager request');
  });

  it('returns null on a 404', async () => {
    gatewayFetch.mockRejectedValueOnce(new MicroserviceError('not found', 404, 'NOT_FOUND', { service: 'cla_service' }));

    expect(await new ClaService().createClaManagerRequest(req, MANAGER_SIG, identity, { requestType: 'approval', recipients: ['jdoe'] })).toBeNull();
  });
});

describe('producerMessageFrom', () => {
  it('reads the message out of the shared CLA error shape', () => {
    expect(producerMessageFrom(JSON.stringify({ code: '403', message: '  not yours  ' }))).toBe('not yours');
  });

  it('falls back to plain text, which some refusals ahead of the CLA service answer with', () => {
    expect(producerMessageFrom('no token provided')).toBe('no token provided');
  });

  it('treats markup as no message at all', () => {
    // An error page rendered into a toast is noise; the generic failure copy reads better.
    expect(producerMessageFrom('<html><body>403 Forbidden</body></html>')).toBeNull();
  });

  it('answers null for a body with nothing to say', () => {
    expect(producerMessageFrom(undefined)).toBeNull();
    expect(producerMessageFrom('')).toBeNull();
    expect(producerMessageFrom('   ')).toBeNull();
    expect(producerMessageFrom(JSON.stringify({ code: '403' }))).toBeNull();
    expect(producerMessageFrom(JSON.stringify({ message: '   ' }))).toBeNull();
    expect(producerMessageFrom({ message: 'an object, not the raw text gatewayFetch carries' })).toBeNull();
  });
});
