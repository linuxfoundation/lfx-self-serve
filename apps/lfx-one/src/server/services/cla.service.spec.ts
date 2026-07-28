// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runtime collaborators are mocked (the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config; cla.service imports only type-only symbols from it, which esbuild elides).
const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
const { getEffectiveEmail, getEffectiveSub, getEffectiveUsername } = vi.hoisted(() => ({
  getEffectiveEmail: vi.fn<() => string | null>(() => null),
  getEffectiveSub: vi.fn<() => string | null>(() => null),
  getEffectiveUsername: vi.fn<() => string | null>(() => null),
}));
const { getUserIdentities } = vi.hoisted(() => ({ getUserIdentities: vi.fn(async () => [] as unknown[]) }));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail, getEffectiveSub, getEffectiveUsername }));
vi.mock('./auth0.service', () => ({
  Auth0Service: class {
    public getUserIdentities = getUserIdentities;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import type { EasyClaSignature } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { buildAgreements, ClaService, deriveStatus, isEcla, isIcla, normalizeGithubId, toMyClaAgreement } from './cla.service';

const req = {} as unknown as Request;

/** Minimal signed ICLA record. */
function icla(overrides: Partial<EasyClaSignature> = {}): EasyClaSignature {
  return { signatureID: 's-icla', claType: 'icla', signatureSigned: true, signatureApproved: true, projectID: 'proj-1', signedOn: '2022-01-01', ...overrides };
}

/** Minimal signed, valid ECLA record. */
function ecla(overrides: Partial<EasyClaSignature> = {}): EasyClaSignature {
  return {
    signatureID: 's-ecla',
    claType: 'ecla',
    signatureSigned: true,
    signatureApproved: true,
    projectID: 'proj-2',
    companyName: 'Acme',
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
  getUserIdentities.mockResolvedValue([]);
  process.env['API_GW_AUDIENCE'] = 'https://api-gw.dev.example.org/';
});

// ---------------------------------------------------------------------------
// T013 — pure classification / status / merge
// ---------------------------------------------------------------------------

describe('classification (isIcla / isEcla)', () => {
  it('uses claType as the authoritative discriminator', () => {
    expect(isIcla(icla())).toBe(true);
    expect(isEcla(icla())).toBe(false);
    expect(isEcla(ecla())).toBe(true);
    expect(isIcla(ecla())).toBe(false);
  });

  it('excludes corporate CCLA records', () => {
    const ccla = icla({ claType: 'ccla' });
    expect(isIcla(ccla)).toBe(false);
    expect(isEcla(ccla)).toBe(false);
  });

  it('falls back to type+referenceType+companyName when claType is absent', () => {
    const iclaLike: EasyClaSignature = { signatureID: 'x', signatureType: 'cla', signatureReferenceType: 'user', signatureSigned: true };
    const eclaLike: EasyClaSignature = { signatureID: 'y', signatureType: 'cla', signatureReferenceType: 'user', companyName: 'Acme', signatureSigned: true };
    expect(isIcla(iclaLike)).toBe(true);
    expect(isEcla(eclaLike)).toBe(true);
  });
});

describe('deriveStatus (research R6)', () => {
  it('signed + approved ⇒ valid', () => {
    expect(deriveStatus(icla({ signatureApproved: true }))).toBe('valid');
  });

  it('signed + not approved ⇒ inactive', () => {
    expect(deriveStatus(icla({ signatureApproved: false }))).toBe('inactive');
  });

  it('older document major version ⇒ superseded (only when current version known)', () => {
    const sig = icla({ signatureDocumentMajorVersion: '1' });
    expect(deriveStatus(sig, 2)).toBe('superseded');
    // Without a known current version the superseded check is skipped.
    expect(deriveStatus(sig)).toBe('valid');
  });

  it('does not mark superseded when signed version is current or newer', () => {
    expect(deriveStatus(icla({ signatureDocumentMajorVersion: '2' }), 2)).toBe('valid');
  });
});

describe('toMyClaAgreement', () => {
  it('maps an ICLA with pdfAvailable=true', () => {
    const a = toMyClaAgreement(icla({ signatureDocumentMajorVersion: '2' }));
    expect(a).toMatchObject({ id: 's-icla', kind: 'ICLA', pdfAvailable: true, status: 'valid' });
  });

  it('maps an ECLA with company name and pdfAvailable=false', () => {
    const a = toMyClaAgreement(ecla());
    expect(a).toMatchObject({ kind: 'ECLA', companyName: 'Acme', pdfAvailable: false });
  });

  it('prefers the resolved projectName, falling back to projectID', () => {
    expect(toMyClaAgreement(icla({ projectName: 'My Project', projectID: 'pid-1' }))?.projectName).toBe('My Project');
    expect(toMyClaAgreement(icla({ projectName: undefined, projectID: 'pid-1' }))?.projectName).toBe('pid-1');
  });

  it('drops unsigned records', () => {
    expect(toMyClaAgreement(icla({ signatureSigned: false }))).toBeNull();
  });

  it('drops corporate CCLA records', () => {
    expect(toMyClaAgreement(icla({ claType: 'ccla' }))).toBeNull();
  });
});

describe('buildAgreements (merge / filter / dedupe / sort)', () => {
  it('keeps ICLAs regardless of status but filters invalid ECLAs (FR-001/FR-002)', () => {
    const result = buildAgreements([
      icla({ signatureID: 'i-valid', signatureApproved: true }),
      icla({ signatureID: 'i-inactive', signatureApproved: false }),
      ecla({ signatureID: 'e-valid', signatureApproved: true }),
      ecla({ signatureID: 'e-inactive', signatureApproved: false }),
    ]);
    const ids = result.map((a) => a.id);
    expect(ids).toContain('i-valid');
    expect(ids).toContain('i-inactive'); // ICLA kept with its status label
    expect(ids).toContain('e-valid');
    expect(ids).not.toContain('e-inactive'); // invalid ECLA filtered out
  });

  it('dedupes by signatureID', () => {
    const result = buildAgreements([icla({ signatureID: 'dup' }), icla({ signatureID: 'dup' })]);
    expect(result).toHaveLength(1);
  });

  it('sorts by signedOn descending', () => {
    const result = buildAgreements([
      icla({ signatureID: 'old', signedOn: '2020-01-01' }),
      icla({ signatureID: 'new', signedOn: '2024-01-01' }),
      icla({ signatureID: 'mid', signedOn: '2022-01-01' }),
    ]);
    expect(result.map((a) => a.id)).toEqual(['new', 'mid', 'old']);
  });
});

// ---------------------------------------------------------------------------
// T014 — identity resolution
// ---------------------------------------------------------------------------

describe('normalizeGithubId (T003 — prefixed vs bare)', () => {
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

describe('ClaService.resolveIdentity', () => {
  it('unions all user ids returned by the by-identity endpoint', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    // by-identity returns the union of records across keys.
    gatewayFetch.mockResolvedValueOnce([{ userID: 'u-1', lfUsername: 'alice' }, { userID: 'u-2' }]);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.easyclaUserIds.sort()).toEqual(['u-1', 'u-2']);
    expect(identity.lfUsername).toBe('alice');
  });

  it('passes lfUsername, emails and githubIds to the by-identity query', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveEmail.mockReturnValue('alice@x.org');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|13434323', connection: 'github' }]);
    gatewayFetch.mockResolvedValueOnce([{ userID: 'u-1' }]);

    await new ClaService().resolveIdentity(req);

    const calledUrl = gatewayFetch.mock.calls[0][1] as string;
    expect(calledUrl).toContain('/v4/users/by-identity');
    expect(calledUrl).toContain('lfUsername=alice');
    expect(calledUrl).toContain('email=alice%40x.org');
    expect(calledUrl).toContain('githubId=13434323');
  });

  it('resolves to no user ids when by-identity returns an empty array', async () => {
    getEffectiveUsername.mockReturnValue('ghost');
    gatewayFetch.mockResolvedValueOnce([]);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.easyclaUserIds).toEqual([]);
  });

  it('falls back to username-only resolution when by-identity 404s', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    gatewayFetch
      .mockRejectedValueOnce(new MicroserviceError('not found', 404, 'NOT_FOUND', { service: 'cla_service' })) // by-identity absent
      .mockResolvedValueOnce({ userID: 'u-legacy', lfUsername: 'alice' }); // username fallback

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.easyclaUserIds).toEqual(['u-legacy']);
    expect(gatewayFetch.mock.calls[1][1] as string).toContain('/v3/users/username/alice');
  });

  it('detects a linked GitHub identity and normalizes the numeric id', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'github', user_id: 'github|13434323', connection: 'github' }]);
    gatewayFetch.mockResolvedValueOnce([{ userID: 'u-1' }]);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.githubLinked).toBe(true);
    expect(identity.githubIds).toEqual(['13434323']);
  });

  it('reports githubLinked=false when no GitHub identity is linked', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    getEffectiveSub.mockReturnValue('auth0|abc');
    getUserIdentities.mockResolvedValueOnce([{ provider: 'google-oauth2', user_id: 'x', connection: 'google' }]);
    gatewayFetch.mockResolvedValueOnce([{ userID: 'u-1' }]);

    const identity = await new ClaService().resolveIdentity(req);

    expect(identity.githubLinked).toBe(false);
    expect(identity.githubIds).toEqual([]);
  });
});

describe('ClaService.getMyClas', () => {
  it('returns unmatched=true and no agreements when the identity resolves to no user ids', async () => {
    getEffectiveUsername.mockReturnValue(null);

    const result = await new ClaService().getMyClas(req);

    expect(result.agreements).toEqual([]);
    expect(result.identity).toMatchObject({ matchedUserIds: 0, unmatched: true, githubLinked: false });
    // No signatures call when there are no user ids.
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('aggregates signatures for the resolved user id', async () => {
    getEffectiveUsername.mockReturnValue('alice');
    gatewayFetch
      .mockResolvedValueOnce([{ userID: 'u-1' }]) // by-identity union
      .mockResolvedValueOnce({ signatures: [icla({ signatureID: 's1' }), ecla({ signatureID: 's2' })], lastKeyScanned: '' }); // signatures page

    const result = await new ClaService().getMyClas(req);

    expect(result.identity.matchedUserIds).toBe(1);
    expect(result.agreements.map((a) => a.id).sort()).toEqual(['s1', 's2']);
  });
});
