// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.route.spec.ts: validation.helper's import graph transitively reaches
// Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const { getMyClas, resolveIdentity, getPdfUrl, listGithubAccounts, bindSigningIdentity } = vi.hoisted(() => ({
  getMyClas: vi.fn(),
  resolveIdentity: vi.fn(),
  getPdfUrl: vi.fn(),
  listGithubAccounts: vi.fn(),
  bindSigningIdentity: vi.fn(),
}));
const { listClaGroupOptions } = vi.hoisted(() => ({ listClaGroupOptions: vi.fn() }));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/cla-group-search.stub', () => ({ listClaGroupOptions }));
vi.mock('../services/cla.service', () => ({
  ClaService: class {
    public getMyClas = getMyClas;
    public resolveIdentity = resolveIdentity;
    public getPdfUrl = getPdfUrl;
    public listGithubAccounts = listGithubAccounts;
    public bindSigningIdentity = bindSigningIdentity;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { AuthenticationError, MicroserviceError } from '../errors';
import { ClasController } from './clas.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;
}

const iclaAgreement = { id: 'sig-icla', kind: 'ICLA', projectName: 'p', signedOn: '2022-01-01', status: 'valid', pdfAvailable: true };
const resolvedIdentity = { lfUsername: 'alice', emails: [], githubIds: [], githubUsernames: [], githubLinked: false };

beforeEach(() => {
  vi.clearAllMocks();
  getUsernameFromAuth.mockResolvedValue('alice');
  resolveIdentity.mockResolvedValue(resolvedIdentity);
});

describe('ClasController.getMyClas', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().getMyClas({ params: {} } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('never passes request-supplied identity to the service (session-derived only)', async () => {
    const response = { agreements: [iclaAgreement], identity: { matchedUserIds: 1, unmatched: false, githubLinked: true } };
    getMyClas.mockResolvedValue(response);
    const res = buildRes();
    // A malicious body/query attempting to select another user's data.
    const req = { params: {}, body: { userId: 'someone-else' }, query: { userID: 'someone-else' } } as any;

    await new ClasController().getMyClas(req, res, vi.fn());

    // The service is called with only (req); the controller passes no identity argument.
    expect(getMyClas).toHaveBeenCalledWith(req);
    expect(getMyClas).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(response);
  });

  it('forwards upstream failures to the error handler', async () => {
    getMyClas.mockRejectedValue(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const next = vi.fn();

    await new ClasController().getMyClas({ params: {} } as any, buildRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
  });
});

describe('ClasController.getPdfUrl', () => {
  it('returns the presigned URL for an owned ICLA', async () => {
    getPdfUrl.mockResolvedValue({ url: 'https://s3/signed.pdf', expiresInSeconds: 900 });
    const res = buildRes();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, res, vi.fn());

    expect(getPdfUrl).toHaveBeenCalledWith(expect.anything(), 'sig-icla', resolvedIdentity);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://s3/signed.pdf', expiresInSeconds: 900 });
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('returns 404 (never 403) when the endpoint reports no owned PDF (unknown / not-owned / ECLA)', async () => {
    // Ownership + ICLA-eligibility is enforced upstream; the service returns null on the endpoint's 404.
    getPdfUrl.mockResolvedValue(null);
    const res = buildRes();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-x' } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('forwards non-404 upstream failures to the error handler', async () => {
    getPdfUrl.mockRejectedValue(new MicroserviceError('boom', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const next = vi.fn();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getPdfUrl({ params: { signatureId: 'sig-icla' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });
});

describe('ClasController.getClaGroupOptions', () => {
  it('returns the stubbed selection options', async () => {
    listClaGroupOptions.mockReturnValue([{ claGroupId: 'cg-1', projectName: 'Venus test' }]);
    const res = buildRes();

    await new ClasController().getClaGroupOptions({ params: {}, query: {} } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith([{ claGroupId: 'cg-1', projectName: 'Venus test' }]);
  });

  it('forwards the picker query to the search', async () => {
    listClaGroupOptions.mockReturnValue([]);

    await new ClasController().getClaGroupOptions({ params: {}, query: { q: 'venus' } } as any, buildRes(), vi.fn());

    // The query has to survive the route for #1250 to be a drop-in replacement of the search
    // alone. If the controller dropped it, the picker would silently list everything.
    expect(listClaGroupOptions).toHaveBeenCalledWith('venus');
  });

  it('treats a repeated or malformed q as an empty query rather than failing', async () => {
    listClaGroupOptions.mockReturnValue([]);

    // Express parses a repeated ?q=&q= into an array; it must not reach the search as one.
    await new ClasController().getClaGroupOptions({ params: {}, query: { q: ['a', 'b'] } } as any, buildRes(), vi.fn());

    expect(listClaGroupOptions).toHaveBeenCalledWith('');
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getClaGroupOptions({ params: {}, query: {} } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
  });
});

// ---------------------------------------------------------------------------
// GitHub account selection and binding (#1252)
// ---------------------------------------------------------------------------

describe('ClasController.getGithubAccounts', () => {
  const options = { accounts: [{ githubId: '12345', githubUsername: 'octocat' }] };

  it('returns the linked accounts for the picker', async () => {
    listGithubAccounts.mockResolvedValue(options);
    const res = buildRes();

    await new ClasController().getGithubAccounts({ params: {}, query: {} } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(options);
  });

  it('forwards a lookup failure instead of answering with zero accounts', async () => {
    listGithubAccounts.mockRejectedValue(new MicroserviceError('identity lookup failed', 502, 'UPSTREAM_ERROR', { service: 'cla_service' }));
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().getGithubAccounts({ params: {}, query: {} } as any, res, next);

    // An empty list routes the contributor into account-linking. A failure reported that way
    // would send someone who already linked an account to go fix nothing.
    expect(next.mock.calls[0][0]).toBeInstanceOf(MicroserviceError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().getGithubAccounts({ params: {}, query: {} } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(listGithubAccounts).not.toHaveBeenCalled();
  });
});

describe('ClasController.bindSigningIdentity', () => {
  const bound = { claUserId: 'u-1', githubId: '12345', githubUsername: 'octocat', redirectUrl: 'https://app.dev.lfx.dev/profile/clas' };

  it('returns the recorded association and the return address', async () => {
    bindSigningIdentity.mockResolvedValue(bound);
    const res = buildRes();

    await new ClasController().bindSigningIdentity({ params: {}, query: {}, body: { githubId: '12345' } } as any, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(bound);
  });

  it('takes the record identifier from the upstream answer, never from the request', async () => {
    bindSigningIdentity.mockResolvedValue(bound);
    const res = buildRes();
    // An attempt to have the association land on someone else's EasyCLA record.
    const req = { params: {}, query: { claUserId: 'someone-else' }, body: { githubId: '12345', claUserId: 'someone-else' } } as any;

    await new ClasController().bindSigningIdentity(req, res, vi.fn());

    // Only the chosen account number crosses the boundary. The record identifier is resolved
    // upstream from the authenticated caller and is never client input.
    expect(bindSigningIdentity).toHaveBeenCalledWith(req, '12345');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ claUserId: 'u-1' }));
  });

  it('ignores a handle sent alongside the account number', async () => {
    bindSigningIdentity.mockResolvedValue(bound);

    // The service reads the handle from the session's own accounts. Accepting one here would
    // let a caller pair an account number they own with a handle they do not.
    const withHandle = { params: {}, query: {}, body: { githubId: '12345', githubUsername: 'someone-else' } } as any;
    await new ClasController().bindSigningIdentity(withHandle, buildRes(), vi.fn());

    expect(bindSigningIdentity).toHaveBeenCalledWith(withHandle, '12345');
  });

  it.each([undefined, '', '   ', 'abc', '12a', '-1', '0', '1.5'])('rejects %p as an account number', async (githubId) => {
    const res = buildRes();

    await new ClasController().bindSigningIdentity({ params: {}, query: {}, body: { githubId } } as any, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(bindSigningIdentity).not.toHaveBeenCalled();
  });

  it.each([
    'identity_unavailable',
    'identity_mismatch',
    'record_conflict',
    'record_unclaimed',
    'duplicate_github_id',
    'recorded_mismatch',
  ] as const)('forwards the %s refusal rather than falling back', async (reason) => {
    bindSigningIdentity.mockRejectedValue(
      new MicroserviceError(`refused: ${reason}`, 403, 'UPSTREAM_ERROR', { service: 'cla_service', errorBody: { error: reason } })
    );
    const res = buildRes();
    const next = vi.fn();

    await new ClasController().bindSigningIdentity({ params: {}, query: {}, body: { githubId: '12345' } } as any, res, next);

    // No alternative account is chosen on the contributor's behalf. Silently signing as a
    // different account than the one picked is exactly the outcome this feature removes.
    expect(next.mock.calls[0][0]).toMatchObject({ errorBody: { error: reason } });
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 401 (via next) when unauthenticated', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const next = vi.fn();

    await new ClasController().bindSigningIdentity({ params: {}, query: {}, body: { githubId: '12345' } } as any, buildRes(), next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(bindSigningIdentity).not.toHaveBeenCalled();
  });
});
